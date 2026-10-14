import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Boomstick'
ANALYSIS = analysis(NAME, '- `stock`: caramel wedge stock with a raised side panel. `receiver`: orange band.\n- `barrel-top` + `barrel-bottom`: two fat violet barrels stacked. `fore-grip`: caramel under the barrels. Yellow `trigger` in an orange guard.', '1. Stacked double barrel. 2. Orange receiver band. 3. Caramel wedge stock.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('double-barrel shotgun')
REASONING = ['Profile slabs for body/stock/grip, cylinders along the barrel axis, rings and small details.', 'Two side panels form one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (200, 600, 30, 30)}
ZONES = {'zone-r0c0': ('contour', 'background above the stock', 'macro', 'silhouette', '', 0.9), 'zone-r0c1': ('seam', 'top of the orange band and barrel breech', 'meso', 'identity', 'receiver', 0.8), 'zone-r0c2': ('contour', 'top barrel', 'macro', 'identity', 'barrel-top', 0.85), 'zone-r1c0': ('bevel', 'stock with raised panel', 'macro', 'silhouette', 'stock', 0.85), 'zone-r1c1': ('seam', 'orange band; trigger', 'meso', 'identity', 'receiver', 0.85), 'zone-r1c2': ('contour', 'barrels and fore-grip', 'macro', 'identity', 'barrel-bottom', 0.85), 'zone-r2c0': ('contour', 'stock butt', 'macro', 'silhouette', 'stock', 0.8), 'zone-r2c1': ('contour', 'background below', 'macro', 'silhouette', '', 0.9), 'zone-r2c2': ('contour', 'background below the barrels', 'macro', 'silhouette', '', 0.9)}
