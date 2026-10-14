import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Party Popper'
ANALYSIS = analysis(NAME, '- `tube`: fat pink cylinder with sky-blue `ring-rear` and `ring-front`. `nose`: yellow bullet nose poking out of the front.\n- Violet `grip` and `stock` hang below; yellow `trigger`.', '1. Pink tube with blue end rings. 2. Yellow rocket nose. 3. Violet grip and stock.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('rocket launcher')
REASONING = ['Profile slabs for body/stock/grip, cylinders along the barrel axis, rings and small details.', 'Two side panels form one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (450, 560, 40, 20)}
ZONES = {'zone-r0c0': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r0c1': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r0c2': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r1c0': ('ridge', 'rear blue ring and stock', 'meso', 'identity', 'ring-rear', 0.85), 'zone-r1c1': ('contour', 'pink tube', 'macro', 'silhouette', 'tube', 0.9), 'zone-r1c2': ('contour', 'front ring and yellow nose', 'meso', 'identity', 'nose', 0.85), 'zone-r2c0': ('contour', 'stock bottom', 'macro', 'silhouette', 'stock', 0.75), 'zone-r2c1': ('contour', 'grip and trigger', 'macro', 'silhouette', 'grip', 0.8), 'zone-r2c2': ('contour', 'background', 'macro', 'silhouette', '', 0.9)}
