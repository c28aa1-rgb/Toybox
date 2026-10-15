import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Bouncer'
ANALYSIS = analysis(NAME, '- `body`: pink rounded box with a round rear boss. Violet coil `spring` on top between two posts. Wide pink `muzzle` collar holding a yellow `ball`. Violet grip, guard and trigger.', '1. Yellow ball in the muzzle. 2. Violet coil spring on top. 3. Round rear boss.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('toy pistol')
REASONING = ['Profile slabs, barrel-axis cylinders, rings and small details.']
SAMPLE_REGIONS = {'body-plastic': (579, 507, 30, 20)}
ZONES = {f'zone-r{r}c{c}': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7) for r in range(3) for c in range(3)}
