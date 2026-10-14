import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Mini Buzz'
ANALYSIS = analysis(NAME, '- `body`: compact light-blue box with hump and rear sight. `grip` + short `magazine` below. Stubby violet `muzzle`, yellow `button`, yellow `trigger`, lighter side panel.', '1. Tiny boxy body. 2. Short magazine. 3. Yellow side button.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('machine pistol')
REASONING = ['Profile slabs, barrel-axis cylinders, rings and small details.']
SAMPLE_REGIONS = {'body-plastic': (250, 470, 30, 20)}
ZONES = {'zone-r0c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7)}
