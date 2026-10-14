import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Buzzbox'
ANALYSIS = analysis(NAME, '- `body`: boxy sky-blue body with a hump and rear sight on top. `grip` and tall `magazine` hang below.\n- `muzzle`: short fat violet tube with a dark bore. Yellow `button` on the side, yellow `trigger` in a guard, lighter side panel.', '1. Straight magazine in front of the grip. 2. Stubby violet muzzle. 3. Yellow side button.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('submachine gun')
REASONING = ['Profile slabs for body/stock/grip, cylinders along the barrel axis, rings and small details.', 'Two side panels form one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (300, 500, 30, 30)}
ZONES = {'zone-r0c0': ('contour', 'rear top of the body', 'macro', 'silhouette', 'body', 0.8), 'zone-r0c1': ('contour', 'top hump', 'meso', 'silhouette', 'top-hump', 0.75), 'zone-r0c2': ('contour', 'rear sight and muzzle top', 'micro', 'silhouette', 'rear-sight', 0.6), 'zone-r1c0': ('contour', 'body rear; grip root', 'macro', 'silhouette', 'body', 0.8), 'zone-r1c1': ('bevel', 'side panel; trigger guard', 'micro', 'identity', 'panel-l', 0.75), 'zone-r1c2': ('fastener', 'yellow button and violet muzzle', 'micro', 'identity', 'button', 0.8), 'zone-r2c0': ('contour', 'violet grip', 'macro', 'silhouette', 'grip', 0.85), 'zone-r2c1': ('contour', 'top of the magazine', 'macro', 'silhouette', 'magazine', 0.85), 'zone-r2c2': ('contour', 'magazine base', 'macro', 'silhouette', 'magazine', 0.8)}
