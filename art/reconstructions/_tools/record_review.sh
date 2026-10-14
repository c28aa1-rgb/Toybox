#!/bin/zsh
# Record one AI-vision review for the current pass, then sync the pipeline and the local state.
# Usage: record_review.sh <model-id> <pass-id> <action> <score> <layers-json> <features-json-file> <summary> [matched] [mismatches] [fixes]
set -u
setopt null_glob
ID=$1; PASS=$2; ACTION=$3; SCORE=$4; LAYERS=$5; FEATURES=$6; SUMMARY=$7
MATCHED=${8:-}; MISMATCHES=${9:-}; FIXES=${10:-}
ROOT="/Users/c28aa1/Desktop/Gun Game"
R="$ROOT/art/reconstructions/$ID"; SP="$R/object-sculpt-spec.json"; ST="$R/.img2threejs/state.json"
REF="$ROOT/art/concepts/$ID.png"; B="$R/renders/$PASS"
IG() { (cd ~/.claude/skills/img2threejs && ~/.local/bin/uv run --quiet --python 3.12 python3 "$@"); }

N=$(ls "$B"/cmp-*.png 2>/dev/null | wc -l | tr -d ' '); N=$((N + 1))
cp "$B/cmp.png" "$B/cmp-$N.png"; cp "$B/ref.png" "$B/ref-$N.png"; cp "$FEATURES" "$B/features-$N.json"
IG forge/stage4_review/divine_eye.py --reference "$REF" --render "$B/ref.png" --json > "$B/divine-eye-$N.json" 2>&1

args=(--pass-id "$PASS" --fidelity "$SCORE" --action "$ACTION" --summary "$SUMMARY"
  --evidence "$B/divine-eye-$N.json;$B/tier1.json;$B/turntable.png"
  --reference-screenshot "$REF" --render-screenshot "$B/ref-$N.png" --comparison-image "$B/cmp-$N.png"
  --map-stripped-render "$B/ref-$N.png" --ai-vision-score "$SCORE" --layer-scores-json "$LAYERS"
  --feature-reviews-json "$B/features-$N.json" --camera-view "az25 el8" --in-place)
[[ -n $MATCHED ]] && args+=(--matched "$MATCHED")
[[ -n $MISMATCHES ]] && args+=(--mismatches "$MISMATCHES")
if [[ -n $FIXES ]]; then
  if [[ $ACTION == refine-code ]]; then args+=(--code-fixes "$FIXES"); else args+=(--spec-fixes "$FIXES"); fi
fi
IG forge/stage4_review/append_review.py "$SP" "${args[@]}" 2>&1 | grep -v "^/Users" | tail -3
IG forge/state.py mark ai-review-recorded --state "$ST" --evidence "$B/cmp-$N.png" --evidence "$B/features-$N.json" >/dev/null
IG forge/stage3_build/orchestrate_passes.py sync "$SP" --in-place 2>&1 | grep STATUS | tail -1
IG forge/state.py mark pipeline-sync --state "$ST" --evidence "$SP" >/dev/null
IG forge/next.py --state "$ST" "$SP" 2>&1 | head -1
