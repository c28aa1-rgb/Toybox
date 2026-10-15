"""Bouncer (ricochet pistol). Traced in the 500 px preview; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, blob, build_gun_model, cyl_z, material, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.42 / 400, (135, 197))
T = 0.12

PARTS = [
    slab(F, 'body', rounded_rect(55, 100, 370, 197, 26), T, 'pink', importance=1.0),
    blob(F, 'rear-boss', 80, 150, 27, 30, 0.15, 'pink', level='meso', importance=0.6),
    slab(F, 'rear-post', rounded_rect(115, 60, 165, 106, 12), 0.1, 'pink', level='meso', importance=0.6),
    slab(F, 'front-post', rounded_rect(335, 58, 375, 106, 12), 0.1, 'pink', level='meso', importance=0.6),
    *[ring_z(F, f'coil-{i}', x, 82, 23, 9, 0.03, 'grape', facing='z', level='meso', importance=0.7) for i, x in enumerate([180, 210, 240, 270, 300, 325])],
    cyl_z(F, 'muzzle', 365, 445, 150, 60, 'pink', importance=0.9),
    blob(F, 'ball', 448, 150, 34, 44, 0.09, 'yellow', level='meso', importance=0.9),
    slab(F, 'grip', [(95, 195), (175, 195), (165, 215), (150, 240), (140, 300), (120, 325), (90, 325), (50, 300), (50, 275), (70, 245)], 0.11, 'grape', importance=0.9, role='grip'),
    ring_z(F, 'trigger-guard', 220, 225, 36, 25, 0.04, 'grape', facing='x', importance=0.6),
    slab(F, 'trigger', [(182, 205), (200, 200), (215, 232), (205, 236), (190, 222)], 0.04, 'grape', level='micro', importance=0.55),
    slab(F, 'side-panel', rounded_rect(128, 135, 338, 165, 15), T + 0.016, 'pink-dark', level='micro', importance=0.45),
]

MATERIALS = [
    material('pink', '#FF5FA2', 'zone-r1c1 body'),
    material('grape', '#6A2FA0', 'zone-r0c1 spring, zone-r2c0 grip'),
    material('yellow', '#FFE45C', 'zone-r1c2 ball'),
    material('pink-dark', '#F04B90', 'zone-r1c1 side panel'),
]

def _d(i, kind, desc, ref, zone, scale='micro', affects='identity', conf=0.8):
    return {'id': i, 'kind': kind, 'description': desc, 'scale': scale, 'affects': affects,
            'mapsTo': {'type': 'component', 'ref': ref}, 'evidenceRef': f'detail-inventory/{zone}.png', 'confidence': conf}

DETAILS = [
    _d('ball', 'contour', 'yellow rubber ball in the muzzle', 'ball', 'zone-r1c2', 'meso', 'silhouette'),
    _d('spring', 'contour', 'violet coil spring along the top', 'coil-2', 'zone-r0c1', 'meso', 'silhouette'),
    _d('rear-boss', 'bevel', 'round boss at the back of the body', 'rear-boss', 'zone-r1c0'),
    _d('muzzle', 'contour', 'wide pink muzzle collar', 'muzzle', 'zone-r1c2', 'meso'),
    _d('side-panel', 'groove', 'recessed panel along the side', 'side-panel', 'zone-r1c1'),
    _d('trigger', 'contour', 'violet trigger in a violet guard', 'trigger', 'zone-r2c1'),
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'pink'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
]

MODEL = build_gun_model(
    name='Bouncer', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'bouncer-signature', 'name': 'Ball in the muzzle and coil spring on top', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['ball', 'coil-2', 'muzzle'], 'evidenceRefs': ['full-object']},
    palette='Pink body, grape spring and grip, yellow ball', shape='chunky ball-firing pistol',
    blockout_ids=['body', 'muzzle', 'ball', 'grip', 'rear-post', 'front-post'], length_m=0.36,
    assumptions=['Body thickness 0.12 m.'],
)
