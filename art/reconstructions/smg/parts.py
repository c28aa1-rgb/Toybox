"""Buzzbox (smg). Traced in the 500 px preview (panel x offset removed); 0.65 m long; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, blob, build_gun_model, cyl_z, material, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.65 / 430, (100, 240))
T = 0.14

BODY_T = T

PARTS = [
    slab(F, 'body', rounded_rect(45, 125, 410, 240, 24), T, 'sky', importance=1.0),
    slab(F, 'top-hump', rounded_rect(95, 98, 220, 140, 16), 0.1, 'sky', level='meso', importance=0.6),
    slab(F, 'rear-sight', rounded_rect(340, 115, 390, 135, 8), 0.08, 'sky', level='micro', importance=0.4),
    slab(F, 'grip', [(70, 238), (160, 238), (146, 330), (136, 392), (116, 406), (42, 402), (30, 372), (50, 300)],
         0.12, 'grape', importance=0.9, role='grip'),
    slab(F, 'magazine', rounded_rect(290, 250, 370, 425, 14), 0.1, 'grape', importance=0.85),
    cyl_z(F, 'muzzle', 400, 475, 187, 38, 'grape', importance=0.85),
    cyl_z(F, 'bore', 468, 478, 187, 18, 'ink', level='micro', importance=0.4, role='pipe'),
    ring_z(F, 'trigger-guard', 225, 268, 48, 32, 0.04, 'sky', facing='x', importance=0.6),
    slab(F, 'trigger', [(180, 240), (225, 245), (232, 285), (215, 300), (195, 292), (182, 265)], 0.05, 'yellow', level='micro', importance=0.6),
    blob(F, 'button', 358, 190, 22, 22, 0.03, 'yellow', x=-(T / 2 + 0.005), importance=0.6),
    slab(F, 'side-panel', rounded_rect(115, 160, 315, 212, 26), BODY_T + 0.024, 'sky-light', level='micro', importance=0.4),
]

MATERIALS = [
    material('sky', '#4FB3FF', 'zone-r1c1 body flank'),
    material('grape', '#5B2A86', 'zone-r2c0 grip, zone-r2c2 magazine'),
    material('yellow', '#FFE45C', 'zone-r1c2 button'),
    material('sky-light', '#7FCBFF', 'zone-r1c1 side panel'),
    material('ink', '#2B1F45', 'zone-r1c2 bore'),
]

DETAILS = [
    {'id': 'magazine', 'kind': 'contour', 'description': 'tall straight violet magazine in front of the grip', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'magazine'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
    {'id': 'muzzle', 'kind': 'contour', 'description': 'short fat violet muzzle with a dark bore', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'muzzle'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.85},
    {'id': 'yellow-button', 'kind': 'fastener', 'description': 'round yellow button on the side', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'button'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.8},
    {'id': 'side-panel', 'kind': 'bevel', 'description': 'raised lighter panel on the side', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'side-panel'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.75},
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'sky'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'grape-grip', 'kind': 'contour', 'description': 'raked violet grip', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'grip'}, 'evidenceRef': 'detail-inventory/zone-r2c0.png', 'confidence': 0.85},
    {'id': 'dark-bore', 'kind': 'hole', 'description': 'dark bore in the muzzle', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'bore'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.75},
    {'id': 'top-hump', 'kind': 'contour', 'description': 'raised hump on the body top', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'top-hump'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.7},
]

MODEL = build_gun_model(
    name='Buzzbox', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'mag-and-muzzle', 'name': 'Straight magazine, stubby muzzle, yellow button', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['magazine', 'muzzle', 'button'], 'evidenceRefs': ['full-object']},
    palette='Sky-blue body, grape grip/magazine/muzzle, yellow button and trigger', shape='boxy body, grip and magazine hanging below, short muzzle',
    blockout_ids=['body', 'grip', 'magazine', 'muzzle', 'top-hump'], length_m=0.56,
    assumptions=['Body thickness 0.14 m.'],
)
