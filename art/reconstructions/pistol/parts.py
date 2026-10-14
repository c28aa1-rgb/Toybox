"""Pea Shooter (pistol). Traced in the 500 px preview; 0.55 m long; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, blob, build_gun_model, cyl_z, material, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.55 / 430, (150, 260))
T = 0.15  # body thickness across the gun

BODY_T = T

PARTS = [
    slab(F, 'body', rounded_rect(70, 125, 390, 268, 30), T, 'orange', importance=1.0),
    slab(F, 'top-hump', rounded_rect(130, 98, 235, 150, 20), 0.11, 'orange', level='meso', importance=0.6),
    slab(F, 'grip', [(130, 255), (195, 262), (178, 330), (168, 398), (150, 420), (72, 425), (45, 398), (55, 345), (95, 290)],
         0.12, 'grape', importance=0.9, role='grip'),
    cyl_z(F, 'barrel', 380, 445, 200, 52, 'orange', importance=0.8),
    ring_z(F, 'muzzle-ring', 428, 200, 75, 40, 0.085, 'yellow', importance=0.95),
    cyl_z(F, 'bore', 440, 452, 200, 34, 'ink', level='micro', importance=0.5, role='pipe'),
    ring_z(F, 'trigger-guard', 238, 300, 55, 38, 0.04, 'orange', facing='x', importance=0.6),
    slab(F, 'trigger', [(200, 262), (245, 268), (252, 305), (238, 328), (215, 322), (200, 292)], 0.05, 'yellow',
         level='micro', importance=0.6),
    slab(F, 'side-panel', rounded_rect(135, 165, 335, 235, 30), BODY_T + 0.024, 'orange-light', level='micro', importance=0.4),
]

MATERIALS = [
    material('orange', '#FF8A1F', 'zone-r1c0 body flank'),
    material('grape', '#5B2A86', 'zone-r2c0 grip'),
    material('yellow', '#FFE45C', 'zone-r1c2 muzzle ring'),
    material('orange-light', '#FFA247', 'zone-r1c1 side panel'),
    material('ink', '#2B1F45', 'zone-r1c2 bore'),
]

DETAILS = [
    {'id': 'muzzle-ring', 'kind': 'ridge', 'description': 'fat yellow ring around the muzzle', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'muzzle-ring'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.9},
    {'id': 'grape-grip', 'kind': 'contour', 'description': 'raked violet grip', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'grip'}, 'evidenceRef': 'detail-inventory/zone-r2c0.png', 'confidence': 0.85},
    {'id': 'side-panel', 'kind': 'bevel', 'description': 'raised lighter oval panel on the body side', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'side-panel'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.75},
    {'id': 'trigger', 'kind': 'contour', 'description': 'yellow trigger inside an orange guard', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'trigger'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.8},
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'orange'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'trigger-guard', 'kind': 'contour', 'description': 'orange ring guarding the trigger', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'trigger-guard'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.75},
    {'id': 'dark-bore', 'kind': 'hole', 'description': 'dark bore inside the muzzle ring', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'bore'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.75},
]

MODEL = build_gun_model(
    name='Pea Shooter', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'muzzle-ring-signature', 'name': 'Yellow muzzle ring on a stubby body', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['muzzle-ring', 'body'], 'evidenceRefs': ['full-object']},
    palette='Orange body, grape grip, yellow ring and trigger', shape='stubby rounded body, fat ring at the muzzle, raked grip',
    blockout_ids=['body', 'grip', 'barrel', 'muzzle-ring', 'top-hump'], length_m=0.38,
    assumptions=['Body thickness 0.15 m, grip 0.12 m.'],
)
