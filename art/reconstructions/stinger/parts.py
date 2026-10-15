"""Stinger (dart pistol). Traced in the 500 px preview; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, blob, build_gun_model, cyl_z, material, nose_z, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.42 / 400, (105, 192))
T = 0.11

PARTS = [
    slab(F, 'body', rounded_rect(25, 108, 362, 192, 32), T, 'yellow', importance=1.0),
    slab(F, 'stripe-rear', rounded_rect(234, 112, 266, 193, 5), T + 0.02, 'grape', level='meso', importance=0.75),
    slab(F, 'stripe-front', rounded_rect(290, 112, 320, 193, 5), T + 0.02, 'grape', level='meso', importance=0.75),
    blob(F, 'rear-disc', 52, 155, 24, 24, 0.14, 'grape', level='meso', importance=0.55),
    cyl_z(F, 'needle', 358, 446, 150, 9, 'grape', importance=0.85),
    cyl_z(F, 'needle-collar', 440, 455, 150, 14, 'grape', level='micro', importance=0.5),
    nose_z(F, 'dart-tip', 452, 492, 149, 9, 'yellow'),
    cyl_z(F, 'canister', 98, 258, 87, 25, 'mint', importance=0.8),
    cyl_z(F, 'canister-band-rear', 110, 134, 87, 29, 'yellow', level='micro', importance=0.5),
    cyl_z(F, 'canister-band-front', 208, 232, 87, 29, 'yellow', level='micro', importance=0.5),
    cyl_z(F, 'canister-cap', 75, 100, 87, 15, 'grape', level='micro', importance=0.45),
    slab(F, 'grip', [(75, 190), (135, 190), (140, 215), (120, 235), (105, 285), (85, 310), (55, 310), (25, 290), (25, 265), (55, 225)], 0.1, 'grape', importance=0.9, role='grip'),
    ring_z(F, 'trigger-guard', 180, 212, 36, 25, 0.035, 'yellow', facing='x', importance=0.6),
    slab(F, 'trigger', [(150, 190), (170, 190), (178, 225), (165, 228), (155, 210)], 0.04, 'grape', level='micro', importance=0.55),
    slab(F, 'side-panel', rounded_rect(100, 140, 250, 165, 12), T + 0.014, 'yellow-dark', level='micro', importance=0.4),
]

MATERIALS = [
    material('yellow', '#FFE45C', 'zone-r1c1 body'),
    material('grape', '#6A2FA0', 'zone-r1c1 stripes, zone-r2c0 grip'),
    material('mint', '#4FE0B8', 'zone-r0c1 canister'),
    material('yellow-dark', '#F2D23F', 'zone-r1c1 side panel'),
]

def _d(i, kind, desc, ref, zone, scale='micro', affects='identity', conf=0.8):
    return {'id': i, 'kind': kind, 'description': desc, 'scale': scale, 'affects': affects,
            'mapsTo': {'type': 'component', 'ref': ref}, 'evidenceRef': f'detail-inventory/{zone}.png', 'confidence': conf}

DETAILS = [
    _d('bee-stripes', 'groove', 'two violet bee stripes round the body', 'stripe-rear', 'zone-r1c1', 'meso'),
    _d('needle', 'contour', 'thin violet needle barrel', 'needle', 'zone-r1c2', 'meso', 'silhouette'),
    _d('dart-tip', 'contour', 'pointed yellow dart tip', 'dart-tip', 'zone-r1c2'),
    _d('canister', 'contour', 'mint canister strapped on top', 'canister', 'zone-r0c1', 'meso', 'silhouette'),
    _d('rear-disc', 'bevel', 'violet disc on the back of the body', 'rear-disc', 'zone-r1c0'),
    _d('trigger', 'contour', 'violet trigger in a yellow guard', 'trigger', 'zone-r2c1'),
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'yellow'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
]

MODEL = build_gun_model(
    name='Stinger', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'stinger-signature', 'name': 'Bee stripes, needle barrel, canister on top', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['stripe-rear', 'needle', 'canister'], 'evidenceRefs': ['full-object']},
    palette='Yellow body, grape stripes and grip, mint canister', shape='slim bee-striped dart pistol',
    blockout_ids=['body', 'needle', 'canister', 'grip', 'stripe-rear', 'stripe-front'], length_m=0.4,
    assumptions=['Body thickness 0.11 m.'],
)
