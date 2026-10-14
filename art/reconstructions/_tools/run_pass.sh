#!/bin/zsh
# One img2threejs build/review cycle for a model, up to (not including) the AI review.
# Usage: run_pass.sh <model-id> <FactoryName> <pass-id> [--force]
# Example: run_pass.sh blink Flicker structural-pass
set -u
ID=$1; NAME=$2; PASS=$3; FORCE=${4:-}
ROOT="/Users/c28aa1/Desktop/Gun Game"
R="$ROOT/art/reconstructions/$ID"
SP="$R/object-sculpt-spec.json"; ST="$R/.img2threejs/state.json"
REF="$ROOT/art/concepts/$ID.png"; B="$R/renders/$PASS"
IG() { (cd ~/.claude/skills/img2threejs && ~/.local/bin/uv run --quiet --python 3.12 python3 "$@"); }
mark() { IG forge/state.py mark "$@" --state "$ST" >/dev/null; }

(cd "$R" && ~/.local/bin/uv run --quiet --python 3.12 python3 ../_tools/spec_builder.py . >/dev/null) || exit 1
IG forge/stage2_spec/validate_sculpt_spec.py "$SP" --strict-quality > "$R/strict-validation.txt" 2>&1
echo "strict: $(tail -1 "$R/strict-validation.txt")"
grep -q '^PASS' "$R/strict-validation.txt" || { cat "$R/strict-validation.txt" | tail -15; exit 1; }

mkdir -p "$R/src" "$B"
IG forge/stage3_build/generate_threejs_factory.py "$SP" --out "$R/src/create${NAME}Model.ts" --pass-id "$PASS" $FORCE > "$B/generate.txt" 2>&1 || { tail -5 "$B/generate.txt"; exit 1; }
mark build-current-pass --evidence "$R/src/create${NAME}Model.ts"

(cd "$R" && node ../_tools/capture.mjs "$ID" "$B" >/dev/null) || { echo capture failed; exit 1; }
mark render-capture --evidence "$B/ref.png" --evidence "$B/front.png" --evidence "$B/right.png" --evidence "$B/rear.png" --evidence "$B/left.png"
mark review-contract-read --evidence "$HOME/.claude/skills/img2threejs/grimoire/review/gates_reference.md" --evidence "$HOME/.claude/skills/img2threejs/grimoire/review/self_correction.md"

IG forge/stage4_review/diagnose_render.py --reference "$REF" --render "$B/ref.png" --map-stripped-render "$B/ref.png" --spec "$SP" --pass-id "$PASS" --in-place > "$B/tier1.json" 2>&1
echo "tier1 failures:"; ~/.local/bin/uv run --quiet --python 3.12 python3 -c "
import json,re,sys
t=open('$B/tier1.json').read(); i=t.find('{'); d=json.loads(t[i:]) if i>=0 else {}
print('  ', d.get('failures', 'n/a'))" 2>/dev/null || tail -5 "$B/tier1.json"
mark tier1-diagnostics --evidence "$B/tier1.json"

IG forge/stage4_review/diagnose_render_multi_angle.py --reference "$B/ref.png" --orbit "$B/right.png" --orbit "$B/rear.png" > "$B/multi-angle.json" 2>&1
echo "multi-angle: $(tail -1 "$B/multi-angle.json")"
mark multi-angle-review --evidence "$B/multi-angle.json"

IG forge/stage3_build/orchestrate_passes.py check "$SP" --pass-id "$PASS" > "$B/pass-check.txt" 2>&1
echo "pass-check: $(tail -1 "$B/pass-check.txt")"
mark pass-gate-check --evidence "$B/pass-check.txt"

IG forge/stage4_review/make_comparison_sheet.py --reference "$REF" --render "$B/ref.png" --out "$B/cmp.png" --json > /dev/null 2>&1
# Turntable strip for 3D review alongside the 2D sheet.
~/.local/bin/uv run --quiet --python 3.12 --with pillow python3 -c "
from PIL import Image
names=['ref','front','right','rear','left']
ims=[Image.open('$B/'+n+'.png').resize((300,300)) for n in names]
s=Image.new('RGB',(300*5,300),'white')
[s.paste(im,(300*i,0)) for i,im in enumerate(ims)]
s.save('$B/turntable.png')"
echo "sheet: $B/cmp.png"; echo "turntable: $B/turntable.png"
