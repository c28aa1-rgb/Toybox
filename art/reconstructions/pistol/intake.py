import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, analysis, object_class, suitability  # noqa: E402,F401

NAME = 'Pea Shooter'
ANALYSIS = analysis(NAME, '- `body`: rounded orange box with a hump on top. `grip`: raked violet grip. `barrel` + `muzzle-ring`: short barrel inside a fat yellow ring.\n- `trigger-guard` ring with a yellow `trigger`; lighter side panel on the body.', '1. Fat yellow muzzle ring. 2. Raked violet grip. 3. Stubby rounded body.')
SUITABILITY = suitability(NAME)
OBJECT_CLASS = object_class('pistol')
REASONING = ['Profile slabs for body/stock/grip, cylinders along the barrel axis, rings and small details.', 'Two side panels form one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (300, 520, 30, 30)}
ZONES = {'zone-r0c0': ('contour', 'top-left of the body hump', 'meso', 'silhouette', 'top-hump', 0.7), 'zone-r0c1': ('contour', 'body top edge and hump', 'macro', 'silhouette', 'body', 0.8), 'zone-r0c2': ('ridge', 'top of the yellow muzzle ring', 'meso', 'identity', 'muzzle-ring', 0.8), 'zone-r1c0': ('contour', 'rear of the body; grip root', 'macro', 'silhouette', 'body', 0.8), 'zone-r1c1': ('bevel', 'side panel; trigger and guard', 'micro', 'identity', 'panel-l', 0.75), 'zone-r1c2': ('ridge', 'yellow muzzle ring around the barrel', 'meso', 'identity', 'muzzle-ring', 0.9), 'zone-r2c0': ('contour', 'violet grip', 'macro', 'silhouette', 'grip', 0.85), 'zone-r2c1': ('contour', 'bottom of the trigger guard', 'micro', 'silhouette', 'trigger-guard', 0.6), 'zone-r2c2': ('contour', 'background only', 'macro', 'silhouette', '', 0.9)}
