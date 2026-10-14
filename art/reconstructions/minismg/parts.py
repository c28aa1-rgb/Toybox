"""Mini Buzz (machine pistol sidearm). Traced in the 500 px preview; 0.5 m long; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, blob, build_gun_model, cyl_z, material, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.5 / 450, (110, 240))
T = 0.12
BODY_T = T

PARTS = [
    slab(F, 'body', rounded_rect(55, 125, 420, 245, 22), T, 'sky', importance=1.0),
    slab(F, 'top-hump', rounded_rect(100, 100, 180, 135, 14), 0.09, 'sky', level='meso', importance=0.5),
    slab(F, 'rear-sight', rounded_rect(355, 108, 405, 130, 8), 0.07, 'sky', level='micro', importance=0.4),
    slab(F, 'grip', [(65, 240), (165, 240), (150, 345), (125, 395), (40, 390), (30, 355), (70, 290)], 0.1, 'grape', importance=0.9, role='grip'),
    slab(F, 'magazine', rounded_rect(300, 255, 372, 388, 12), 0.08, 'grape', importance=0.8),
    cyl_z(F, 'muzzle', 410, 480, 205, 37, 'grape', importance=0.85),
    cyl_z(F, 'bore', 472, 482, 205, 18, 'ink', level='micro', importance=0.4, role='pipe'),
    ring_z(F, 'trigger-guard', 228, 262, 48, 32, 0.035, 'sky', facing='x', importance=0.6),
    slab(F, 'trigger', [(185, 248), (232, 252), (240, 292), (222, 305), (198, 296), (186, 272)], 0.04, 'yellow', level='micro', importance=0.6),
    blob(F, 'button', 122, 205, 22, 22, 0.03, 'yellow', x=-(T / 2 + 0.005), importance=0.6),
    slab(F, 'side-panel', rounded_rect(160, 172, 330, 225, 24), BODY_T + 0.024, 'sky-light', level='micro', importance=0.4),
]

MATERIALS = [
    material('sky', '#6FC4FF', 'zone-r1c1 body'),
    material('grape', '#5B2A86', 'zone-r2c0 grip, zone-r2c1 magazine'),
    material('yellow', '#FFE45C', 'zone-r1c0 button'),
    material('sky-light', '#9AD6FF', 'zone-r1c1 side panel'),
    material('ink', '#2B1F45', 'zone-r1c2 bore'),
]

def _d(i, kind, desc, ref, zone, scale='micro', affects='identity', conf=0.8):
    return {'id': i, 'kind': kind, 'description': desc, 'scale': scale, 'affects': affects,
            'mapsTo': {'type': 'component', 'ref': ref}, 'evidenceRef': f'detail-inventory/{zone}.png', 'confidence': conf}

DETAILS = [
    _d('magazine', 'contour', 'short violet magazine in front of the grip', 'magazine', 'zone-r2c1', 'macro', 'silhouette'),
    _d('muzzle', 'contour', 'stubby violet muzzle with a dark bore', 'muzzle', 'zone-r1c2', 'meso'),
    _d('yellow-button', 'fastener', 'round yellow button at the rear of the body', 'button', 'zone-r1c0'),
    _d('side-panel', 'bevel', 'raised lighter panel on the side', 'side-panel', 'zone-r1c1'),
    _d('grip', 'contour', 'raked violet grip', 'grip', 'zone-r2c0', 'macro', 'silhouette'),
    _d('trigger', 'contour', 'yellow trigger in a guard', 'trigger', 'zone-r1c1'),
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'sky'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
]

MODEL = build_gun_model(
    name='Mini Buzz', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'mini-buzz-signature', 'name': 'Tiny boxy body, short magazine, stubby muzzle', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['body', 'magazine', 'muzzle'], 'evidenceRefs': ['full-object']},
    palette='Light sky body, grape grip/magazine/muzzle, yellow button and trigger', shape='compact boxy machine pistol',
    blockout_ids=['body', 'grip', 'magazine', 'muzzle', 'top-hump'], length_m=0.41,
    assumptions=['Body thickness 0.12 m.'],
)
