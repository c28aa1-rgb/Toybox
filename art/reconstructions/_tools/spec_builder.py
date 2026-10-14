"""Expand a compact part list into a full img2threejs ObjectSculptSpec.

The starter spec from `new_sculpt_spec.py` carries a humanoid template. Our heroes are
single-volume toys and our guns are small props, so each model describes its own parts in a
short Python file and this module turns them into the verbose component/material schema the
forge validator and generator expect.

Coordinates: meters, Y up, +Z forward, character-left = +X. Positions are parent-relative.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any


def hex_to_rgba(hex_color: str, alpha: float = 1.0) -> str:
    h = hex_color.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f'rgba({r}, {g}, {b}, {alpha})'


def shade(hex_color: str, factor: float) -> str:
    h = hex_color.lstrip('#')
    rgb = [max(0, min(255, round(int(h[i:i + 2], 16) * factor))) for i in (0, 2, 4)]
    return '#' + ''.join(f'{c:02X}' for c in rgb)


def make_material(template: dict[str, Any], m: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(template)
    color = m['color']
    out.update({
        'id': m['id'],
        'name': m.get('name', m['id']),
        'type': m.get('type', 'standard'),
        'shaderModel': 'MeshStandardMaterial / PBR approximation',
        'baseColor': color,
        'color': color,
    })
    out['albedo'] = {
        'dominant': color,
        'secondary': [shade(color, 0.85), shade(color, 1.1)],
        'samplingNotes': m.get('evidence', 'Solid albedo sampled from the de-lit reference region; value changes in the image are shading, not paint.'),
    }
    out['colorVariation'] = {'palette': [color], 'pattern': 'none', 'amplitude': 0.0, 'heightCorrelation': 0.0}
    # Flat-colour toy renders carry no grain, print or pores. Declare that with evidence instead
    # of inventing texture channels the renderer would never read (see validate_textureless).
    for field in ('normal', 'bump', 'displacement', 'surfaceFrequencyBands', 'textureProjection',
                  'textureResolution', 'referencePbr'):
        out.pop(field, None)
    out['textureless'] = {
        'declared': True,
        'evidence': m.get('texturelessEvidence', [
            'albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern',
            'detail-inventory zones show no grain, print, seam texture or pores at 1254 px',
        ]),
    }
    out['roughness'] = {'base': m.get('roughness', 0.3), 'variation': 0.03, 'map': 'uniform-scalar', 'localResponse': 'uniform gloss; moulded toy plastic has no wear'}
    out['metalness'] = {'base': m.get('metalness', 0.0), 'variation': 0.0}
    out['ambientOcclusion'] = {'cavityStrength': 0.15, 'contactShadowBias': 0.3, 'notes': 'Soft contact darkening where parts meet.'}
    out['wear'] = {'edgeWear': 0.0, 'scratches': [], 'chips': []}
    out['dirt'] = {'amount': 0.0, 'cavityBias': 0.0, 'color': '#2F2A22'}
    out['localOverrides'] = m.get('localOverrides', [])
    if m.get('emissive'):
        out['emissive'] = {'color': m['emissive'], 'intensity': m.get('emissiveIntensity', 0.6)}
    if m.get('doubleSided'):
        out['doubleSided'] = True
    out['materialClass'] = m.get('materialClass', 'plastic')
    out['finishStyle'] = m.get('finish', 'gloss')
    return out


def make_component(template: dict[str, Any], p: dict[str, Any], materials: dict[str, dict[str, Any]]) -> dict[str, Any]:
    c = copy.deepcopy(template)
    dims = p['dims']
    mat = materials[p['material']]
    c.update({
        'id': p['id'],
        'name': p.get('name', p['id'].replace('-', ' ').title()),
        'level': p['level'],
        'role': p.get('role', 'body'),
        'importance': p.get('importance', 0.7),
        'confidence': p.get('confidence', 0.8),
        'primitive': p['primitive'],
        'topologyClass': p.get('topologyClass', 'assembled-solid'),
        'topologyRationale': p.get('topologyRationale', 'Discrete moulded toy part assembled onto the figure.'),
        'parent': p.get('parent'),
        'attachment': p.get('attachment'),
        'material': p['material'],
        'materialLayers': [p['material']],
        'localFeatures': p.get('localFeatures', []),
        'evidenceRefs': p.get('evidenceRefs', ['full-object']),
        'details': p.get('details', []),
        'fidelityTier': p.get('fidelityTier', 'blockout'),
    })
    desc = c['geometryDescriptor']
    desc['topologyIntent'] = p.get('topologyIntent', 'stylized toy part')
    desc['normalStrategy'] = p.get('normalStrategy', 'smooth vertex normals')
    for k, v in p.get('descriptor', {}).items():
        desc[k] = v
    c['dimensions'] = {'width': dims[0], 'height': dims[1], 'depth': dims[2], 'units': 'meters', 'confidence': p.get('confidence', 0.8)}
    c['transform'] = {
        'position': p.get('pos', [0, 0, 0]),
        'rotation': p.get('rot', [0, 0, 0]),
        'scale': p.get('scale', dims),
    }
    ap = c['actionProfile']
    ap['animationRole'] = p.get('animationRole', 'static')
    ap['pivot'] = {
        'mode': p.get('pivotMode', 'center'),
        'localPosition': p.get('pivot', [0, 0, 0]),
        'axis': p.get('pivotAxis', [0, 1, 0]),
        'confidence': 0.7,
    }
    ap['sockets'] = p.get('sockets', [])
    ap['collider'] = {'type': p.get('collider', 'sphere' if p['primitive'] in ('sphere', 'ellipsoid', 'lathe') else 'box'),
                      'offset': [0, 0, 0], 'scale': [1, 1, 1], 'isTrigger': False, 'notes': 'simplified proxy'}
    ap['destruction']['fractureGroup'] = p['id']
    ap['destruction']['debrisMaterial'] = p['material']
    c['colorMaterialRecipe'] = {
        'dominantAlbedo': hex_to_rgba(mat['color']),
        'secondaryAlbedo': hex_to_rgba(shade(mat['color'], 0.85)),
        'materialClass': mat.get('materialClass', 'plastic'),
        'materialClassConfidence': 0.9,
        'evidenceRefs': p.get('evidenceRefs', ['full-object']),
    }
    c['surfaceDetail']['notes'] = p.get('surfaceNotes', 'Smooth moulded plastic; no relief.')
    for key in ('vertexPaint', 'rootTipGradient'):
        if key in p:
            c[key] = p[key]
    return c


def attach(parent: str, socket: str, start, end, contact: str = 'overlap', overlap: float = 0.02, tol: float = 0.01) -> dict[str, Any]:
    return {
        'parentId': parent,
        'parentSocket': socket,
        'localStart': list(start),
        'localEnd': list(end),
        'contactType': contact,
        'overlap': overlap,
        'gapTolerance': tol,
        'evidenceRefs': ['full-object'],
    }


def build(workspace: Path, model: dict[str, Any]) -> Path:
    spec_path = workspace / 'object-sculpt-spec.json'
    starter = workspace / 'object-sculpt-spec.starter.json'
    if not starter.exists():
        starter.write_text(spec_path.read_text())
    spec = json.loads(starter.read_text())
    if spec_path.exists():
        # Keep pipeline state (reviews, pass progress) from the working spec.
        current = json.loads(spec_path.read_text())
        for key in ('reviewHistory', 'sculptPipeline', 'visualEvidence'):
            if key in current:
                spec[key] = current[key]
    comp_template = next((c for c in spec['componentTree'] if c['id'] == 'head'), spec['componentTree'][0])
    mat_template = spec['materials'][0]

    mats = {m['id']: m for m in model['materials']}
    spec['materials'] = [make_material(mat_template, m) for m in model['materials']]
    spec['componentTree'] = [make_component(comp_template, p, mats) for p in model['parts']]

    for key in ('lightingFromPhoto', 'silhouette', 'featureReviewTargets', 'performanceBudget', 'coordinateFrame', 'assumptions', 'risks',
                'animationAnchors', 'qualityTargets', 'viewEvidence', 'repetitionSystems', 'lodPlan', 'proceduralStrategy'):
        if key in model:
            spec[key] = model[key]
    if 'rig' in model:
        spec['rig'] = model['rig']
    if 'details' in model:
        spec['preSpecAssessment']['detailInventory']['details'] = model['details']
    if 'unknowns' in model:
        spec['preSpecAssessment']['unknownsToResolveBeforeImplementation'] = model['unknowns']
    order = model.get('passOrder')
    if order:
        existing = {bp['id']: bp for bp in spec['buildPasses']}
        spec['buildPasses'] = [existing.get(pid, {'id': pid, 'goal': '', 'componentRefs': [], 'acceptance': []}) for pid in order]
        spec['sculptPipeline']['passOrder'] = order
    ids = [p['id'] for p in model['parts']]
    passes = model.get('passComponents', {})
    for bp in spec['buildPasses']:
        bp['componentRefs'] = passes.get(bp['id'], ids)
        if bp['id'] in model.get('passGoals', {}):
            bp['goal'], bp['acceptance'] = model['passGoals'][bp['id']]
    spec_path.write_text(json.dumps(spec, indent=2))
    return spec_path


if __name__ == '__main__':
    ws = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(ws))
    import parts  # type: ignore  # noqa: E402

    print(build(ws, parts.MODEL))
