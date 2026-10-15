import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Tri-Pop'
ANALYSIS = analysis(NAME, '- `body`: long mint rounded box with a taller front housing. Three yellow `barrels` in a triangle. Violet `stock`, `grip`, curved `magazine`; mint trigger guard; recessed side panels.', '1. Triple yellow barrels. 2. Curved magazine. 3. Rounded violet stock.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('burst rifle')
REASONING = ['Profile slabs, barrel-axis cylinders, rings and small details.']
SAMPLE_REGIONS = {'body-plastic': (579, 405, 30, 20)}
ZONES = {f'zone-r{r}c{c}': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7) for r in range(3) for c in range(3)}
