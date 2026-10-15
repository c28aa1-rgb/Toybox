import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Stinger'
ANALYSIS = analysis(NAME, '- `body`: yellow rounded box with two violet bee `stripes`. Thin violet `needle` barrel with a yellow dart tip. Mint `canister` on top with yellow straps. Violet grip, yellow guard.', '1. Bee stripes. 2. Needle barrel with dart tip. 3. Mint canister on top.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('dart pistol')
REASONING = ['Profile slabs, barrel-axis cylinders, rings and small details.']
SAMPLE_REGIONS = {'body-plastic': (434, 492, 30, 20)}
ZONES = {f'zone-r{r}c{c}': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7) for r in range(3) for c in range(3)}
