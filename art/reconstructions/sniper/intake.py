import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Longshot'
ANALYSIS = analysis(NAME, '- `stock`: long mint stock and fore-end with a lighter panel. `barrel`: long thin violet barrel ending in a fat `muzzle`.\n- `scope`: violet tube with yellow end caps on two mint mounts. Violet `grip`, small yellow `trigger`.', '1. Long thin barrel with fat muzzle. 2. Capped scope on top. 3. Mint stock.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('sniper rifle')
REASONING = ['Profile slabs for body/stock/grip, cylinders along the barrel axis, rings and small details.', 'Two side panels form one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (120, 940, 40, 20)}
ZONES = {'zone-r0c0': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r0c1': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r0c2': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r1c0': ('contour', 'stock and rear scope cap', 'macro', 'silhouette', 'stock', 0.85), 'zone-r1c1': ('fastener', 'scope tube, mounts, fore-end panel', 'meso', 'identity', 'scope', 0.85), 'zone-r1c2': ('contour', 'thin barrel and fat muzzle', 'macro', 'identity', 'barrel', 0.85), 'zone-r2c0': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r2c1': ('contour', 'background', 'macro', 'silhouette', '', 0.9), 'zone-r2c2': ('contour', 'background', 'macro', 'silhouette', '', 0.9)}
