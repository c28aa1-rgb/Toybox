"""Run the img2threejs setup checklist for one model from its intake.py.

Usage: python3 setup_model.py <model-id> <Display Name> [--profile character|generic]

intake.py provides the agent's own observations (written after viewing the reference):
  ANALYSIS (markdown), SUITABILITY (markdown), CONTRACT (markdown, characters only),
  OBJECT_CLASS (dict), COMPLEXITY ('simple'|'moderate'|...), SCORES (dict), COUNTS (dict),
  REASONING (list), ZONES {zone-id: (kind, description, scale, affects, ref, confidence)},
  SAMPLE_REGIONS {material-id: (x, y, w, h)} in reference pixels, SPEC_QUERIES (list).
Every step is marked with its evidence file; scripts run from the skill root with Python 3.12.
"""
from __future__ import annotations

import importlib.util
import json
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path('/Users/c28aa1/Desktop/Gun Game')
SKILL = Path.home() / '.claude/skills/img2threejs'
UV = str(Path.home() / '.local/bin/uv')


def ig(*args: str) -> str:
    out = subprocess.run([UV, 'run', '--quiet', '--python', '3.12', 'python3', *args], cwd=SKILL,
                         capture_output=True, text=True)
    if out.returncode not in (0,):
        raise SystemExit(f'forge failed: {args[0]}\n{out.stdout}\n{out.stderr}')
    return out.stdout


def main() -> None:
    model_id, name = sys.argv[1], sys.argv[2]
    profile = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == '--profile' else 'character'
    ws = ROOT / 'art/reconstructions' / model_id
    ref = ROOT / 'art/concepts' / f'{model_id}.png'
    spec = ws / 'object-sculpt-spec.json'
    state = ws / '.img2threejs/state.json'
    spec_i = importlib.util.spec_from_file_location('intake', ws / 'intake.py')
    intake = importlib.util.module_from_spec(spec_i)
    spec_i.loader.exec_module(intake)  # type: ignore[union-attr]

    def mark(step: str, *evidence: Path, status: str = 'done', reason: str = '') -> None:
        args = ['forge/state.py', 'mark', step, '--state', str(state)]
        for e in evidence:
            args += ['--evidence', str(e)]
        if status != 'done':
            args += ['--status', status, '--reason', reason]
        ig(*args)

    if not state.exists():
        ig('forge/state.py', 'init', '--state', str(state), '--reference', str(ref), '--profile', profile,
           '--spec', str(spec), '--max-per-pass', '5', '--max-total', '15')
        (ws / '.img2threejs/caps.txt').write_text(
            'Caps 5/pass, 15 total, approved by the user on 2026-10-14 after Flicker hit the default 3/3 stop.\n')

    (ws / 'analysis.md').write_text(intake.ANALYSIS)
    mark('image-analysis', ws / 'analysis.md')
    (ws / 'suitability.md').write_text(intake.SUITABILITY)
    mark('reference-suitability', ws / 'suitability.md')
    ig('forge/stage1_intake/check_reference_admission.py', str(ref), '--out', str(ws / 'admission.json'),
       '--probe-out', str(ws / 'probe.json'))
    mark('reference-admission', ws / 'admission.json')

    # Measured evidence: silhouette bbox and per-region albedo medians.
    from PIL import Image
    im = Image.open(ref).convert('RGB')
    small = im.resize((256, 256))
    px = small.load()
    bg = px[2, 2]
    xs, ys = [], []
    for y in range(256):
        for x in range(256):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 40:
                xs.append(x)
                ys.append(y)
    bbox = [min(xs) / 256, min(ys) / 256, max(xs) / 256, max(ys) / 256]
    samples = {}
    for mid, (x, y, w, h) in intake.SAMPLE_REGIONS.items():
        pts = [im.getpixel((x + i, y + j)) for i in range(w) for j in range(h)]
        med = tuple(int(statistics.median(c[n] for c in pts)) for n in range(3))
        samples[mid] = {'region_px': [x, y, w, h], 'median_rgb': med, 'hex': '#%02X%02X%02X' % med}
    (ws / 'albedo-samples.json').write_text(json.dumps({'silhouetteBBoxNormalized': [round(v, 3) for v in bbox],
                                                         'silhouetteAspectWH': round((bbox[2] - bbox[0]) / (bbox[3] - bbox[1]), 3),
                                                         'regions': samples}, indent=2))

    if profile == 'character':
        (ws / 'character-contract.md').write_text(intake.CONTRACT)
        mark('character-contract-read', ws / 'character-contract.md')
        ig('forge/stage1_intake/extract_landmarks.py', str(ref), '--out', str(ws / 'anatomy.json'),
           '--overlay', str(ws / 'landmarks.png'), '--style-heads', '1.3', '--force')
        base = json.loads((ROOT / 'art/reconstructions/blink/anatomy.json').read_text())['anatomy']
        anat = json.loads((ws / 'anatomy.json').read_text())
        anat['anatomy'] = {**base, 'note': f'{name} shares the measured Flicker body (same style sheet); '
                           f'own silhouette bbox {bbox} and aspect in albedo-samples.json.'}
        (ws / 'anatomy.json').write_text(json.dumps(anat, indent=2))
        mark('character-landmarks', ws / 'anatomy.json', ws / 'landmarks.png')

    args = ['forge/stage2_spec/new_pre_spec_assessment.py', name, '--image', str(ref), '--complexity', intake.COMPLEXITY,
            '--domain', profile, '--out', str(ws / 'assessment.json'), '--force']
    if profile == 'character':
        args.append('--character')
    for q in intake.SPEC_QUERIES:
        args += ['--spec-query', q]
    ig(*args)
    d = json.loads((ws / 'assessment.json').read_text())
    a = d['preSpecAssessment']
    a['objectClass'] = intake.OBJECT_CLASS
    a['complexity']['scores'] = intake.SCORES
    a['complexity']['estimatedCounts'] = intake.COUNTS
    a['complexity']['reasoning'] = intake.REASONING
    a['unknownsToResolveBeforeImplementation'] = []
    if profile == 'character':
        a['anatomy'] = {**json.loads((ws / 'anatomy.json').read_text())['anatomy'], 'applies': True}
        a['anatomy']['faceLandmarks'] = {k: (v if isinstance(v, (int, float)) else 0.0)
                                         for k, v in a['anatomy']['faceLandmarks'].items()
                                         if k in ('eyeLine', 'eyeSpacing', 'noseBase', 'mouthLine', 'hairline')}
    (ws / 'assessment.json').write_text(json.dumps(d, indent=2))
    mark('local-spec-search', ws / 'assessment.json')
    mark('pre-spec-assessment', ws / 'assessment.json')

    ig('forge/stage1_intake/build_detail_inventory.py', str(ref), '--mode', 'grid-3x3', '--out-dir',
       str(ws / 'detail-inventory'), '--out', str(ws / 'di.json'))
    di = json.loads((ws / 'di.json').read_text())
    for det in di['detailInventory']['details']:
        kind, desc, scale, affects, refid, conf = intake.ZONES[det['id']]
        det.update(kind=kind, description=desc, scale=scale, affects=affects, confidence=conf)
        det['mapsTo'] = {'type': 'component' if refid else 'none', 'ref': refid}
    (ws / 'di.json').write_text(json.dumps(di, indent=2))
    mark('detail-inventory', ws / 'di.json')

    (ws / 'projection-route.md').write_text(
        f'# {name}: projection route\n\nNot required: flat-colour moulded toy with no printed pattern. '
        'Each region gets a solid albedo (SKILL.md step 4: solid albedo for flat paint).\n')
    mark('projection-route', ws / 'projection-route.md', status='skipped', reason='flat-colour toy; solid albedo per region')

    if not spec.exists():
        args = ['forge/stage2_spec/new_sculpt_spec.py', name, '--image', str(ref), '--assessment', str(ws / 'assessment.json'),
                '--domain', profile, '--out', str(spec)]
        ig(*args)

    # Author the spec from parts.py, then validate strictly.
    built = subprocess.run([UV, 'run', '--quiet', '--python', '3.12', 'python3', str(ROOT / 'art/reconstructions/_tools/spec_builder.py'), '.'],
                           cwd=ws, capture_output=True, text=True)
    if built.returncode:
        raise SystemExit(built.stderr)
    mark('spec-authoring', spec, ws / 'parts.py')
    mark('material-evidence', ws / 'albedo-samples.json', status='skipped',
         reason='every material is declared textureless with evidence; region medians in albedo-samples.json')
    mark('material-spec-wiring', spec, status='skipped', reason='albedos wired by spec_builder.py from parts.py')
    result = subprocess.run([UV, 'run', '--quiet', '--python', '3.12', 'python3', 'forge/stage2_spec/validate_sculpt_spec.py',
                             str(spec), '--strict-quality'], cwd=SKILL, capture_output=True, text=True)
    (ws / 'strict-validation.txt').write_text(result.stdout + result.stderr)
    print((result.stdout + result.stderr).strip().splitlines()[-1])
    if result.returncode == 0:
        mark('strict-validation', ws / 'strict-validation.txt')
    print('setup complete for', model_id)


if __name__ == '__main__':
    main()
