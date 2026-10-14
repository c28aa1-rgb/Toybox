"""Boomstick (shotgun). Traced in the 500 px preview (panel x offset removed); 0.85 m long; origin at the stock/receiver join."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, build_gun_model, cyl_z, material, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.85 / 465, (200, 235))

BODY_T = 0.13

PARTS = [
    slab(F, 'stock', [(20, 215), (150, 200), (210, 172), (262, 158), (262, 252), (232, 276), (172, 268), (142, 268), (62, 336), (30, 336), (15, 300)],
         0.13, 'caramel', importance=1.0),
    slab(F, 'receiver', rounded_rect(205, 150, 278, 300, 22), 0.15, 'orange', importance=0.85),
    cyl_z(F, 'barrel-top', 255, 480, 176, 27, 'grape', importance=0.9, x=0.0),
    cyl_z(F, 'barrel-bottom', 255, 480, 226, 27, 'grape', importance=0.9, x=0.0),
    cyl_z(F, 'bore-top', 474, 484, 176, 15, 'ink', level='micro', importance=0.4, role='pipe'),
    cyl_z(F, 'bore-bottom', 474, 484, 226, 15, 'ink', level='micro', importance=0.4, role='pipe'),
    slab(F, 'fore-grip', rounded_rect(270, 245, 445, 298, 24), 0.12, 'caramel', importance=0.8),
    ring_z(F, 'trigger-guard', 218, 282, 36, 24, 0.035, 'orange', facing='x', importance=0.6),
    slab(F, 'trigger', [(200, 262), (228, 266), (232, 292), (220, 304), (205, 296)], 0.04, 'yellow', level='micro', importance=0.6),
    slab(F, 'side-panel', rounded_rect(45, 222, 160, 300, 30), BODY_T + 0.024, 'caramel-light', level='micro', importance=0.4),
]

MATERIALS = [
    material('caramel', '#B5652B', 'zone-r1c0 stock'),
    material('orange', '#FF8A1F', 'zone-r1c1 receiver band'),
    material('grape', '#5B2A86', 'zone-r1c2 barrels'),
    material('yellow', '#FFE45C', 'zone-r1c1 trigger'),
    material('caramel-light', '#C97A3E', 'zone-r1c0 stock panel'),
    material('ink', '#2B1F45', 'zone-r1c2 bores'),
]

DETAILS = [
    {'id': 'double-barrel', 'kind': 'contour', 'description': 'two fat violet barrels stacked', 'scale': 'macro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'barrel-top'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.9},
    {'id': 'orange-band', 'kind': 'seam', 'description': 'orange receiver band between stock and barrels', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'receiver'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'fore-grip', 'kind': 'contour', 'description': 'caramel fore-grip under the barrels', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'fore-grip'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.8},
    {'id': 'stock-panel', 'kind': 'bevel', 'description': 'raised panel on the stock side', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'side-panel'}, 'evidenceRef': 'detail-inventory/zone-r1c0.png', 'confidence': 0.7},
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'caramel'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'trigger', 'kind': 'contour', 'description': 'yellow trigger in an orange guard', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'trigger'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.75},
    {'id': 'dark-bores', 'kind': 'hole', 'description': 'dark bores at both barrel ends', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'bore-top'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.75},
]

MODEL = build_gun_model(
    name='Boomstick', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'double-barrel-signature', 'name': 'Stacked double barrel with orange band', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['barrel-top', 'barrel-bottom', 'receiver'], 'evidenceRefs': ['full-object']},
    palette='Caramel stock and fore-grip, orange band, grape barrels, yellow trigger', shape='wedge stock, short receiver, two stacked barrels',
    blockout_ids=['stock', 'receiver', 'barrel-top', 'barrel-bottom', 'fore-grip'], length_m=0.51,
    assumptions=['Barrels side by side vertically as in the side view.'],
)
