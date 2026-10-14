import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Thumper'
ANALYSIS = analysis(NAME, '- Orange `frame` and fat `barrel`; big violet `drum`; yellow `hammer` and `trigger`; curved violet `grip`.', '1. Violet drum. 2. Fat orange barrel. 3. Yellow hammer.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('hand cannon revolver')
REASONING = ['Profile slabs, barrel-axis cylinders, rings and small details.']
SAMPLE_REGIONS = {'body-plastic': (1000, 440, 30, 20)}
ZONES = {'zone-r0c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7)}
