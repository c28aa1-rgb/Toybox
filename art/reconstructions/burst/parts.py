"""Tri-Pop (burst rifle). Traced in the 500 px preview; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, blob, build_gun_model, cyl_z, material, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.6 / 480, (140, 190))
T = 0.13

PARTS = [
    slab(F, 'body', rounded_rect(80, 96, 440, 190, 22), T, 'mint', importance=1.0),
    slab(F, 'front-housing', rounded_rect(360, 84, 440, 202, 18), T + 0.02, 'mint', level='meso', importance=0.7),
    slab(F, 'stock', rounded_rect(10, 102, 55, 198, 18), 0.12, 'grape', importance=0.85),
    slab(F, 'stock-neck', rounded_rect(48, 120, 88, 170, 10), 0.07, 'grape', level='meso', importance=0.5),
    slab(F, 'grip', [(115, 185), (165, 185), (160, 215), (142, 255), (140, 275), (120, 282), (98, 280), (84, 262), (96, 238), (118, 212)], 0.1, 'grape', importance=0.9, role='grip'),
    slab(F, 'magazine', [(240, 193), (305, 193), (345, 265), (345, 276), (300, 305), (286, 300), (256, 232)], 0.08, 'grape', importance=0.85),
    cyl_z(F, 'barrel-top', 428, 486, 117, 22, 'yellow', importance=0.9),
    cyl_z(F, 'barrel-left', 425, 478, 160, 22, 'yellow', x=-0.028, importance=0.85),
    cyl_z(F, 'barrel-right', 425, 490, 160, 22, 'yellow', x=0.028, importance=0.85),
    cyl_z(F, 'bore', 482, 492, 117, 11, 'ink', level='micro', importance=0.4, role='pipe'),
    ring_z(F, 'trigger-guard', 185, 205, 30, 20, 0.035, 'mint', facing='x', importance=0.6),
    slab(F, 'trigger', [(166, 186), (184, 186), (188, 212), (176, 214)], 0.04, 'grape', level='micro', importance=0.55),
    slab(F, 'side-panel', rounded_rect(126, 130, 304, 156, 12), T + 0.016, 'mint-dark', level='micro', importance=0.45),
    slab(F, 'front-panel', rounded_rect(332, 134, 405, 172, 10), T + 0.036, 'mint-dark', level='micro', importance=0.4),
]

MATERIALS = [
    material('mint', '#3DDBB4', 'zone-r1c1 body'),
    material('grape', '#6A2FA0', 'zone-r1c0 stock, zone-r2c0 grip, zone-r2c1 magazine'),
    material('yellow', '#FFE45C', 'zone-r1c2 barrels'),
    material('mint-dark', '#2EC49E', 'zone-r1c1 recessed panels'),
    material('ink', '#2B1F45', 'zone-r1c2 bore'),
]

def _d(i, kind, desc, ref, zone, scale='micro', affects='identity', conf=0.8):
    return {'id': i, 'kind': kind, 'description': desc, 'scale': scale, 'affects': affects,
            'mapsTo': {'type': 'component', 'ref': ref}, 'evidenceRef': f'detail-inventory/{zone}.png', 'confidence': conf}

DETAILS = [
    _d('triple-barrels', 'contour', 'three yellow barrels stacked in a triangle', 'barrel-top', 'zone-r1c2', 'meso', 'silhouette'),
    _d('magazine', 'contour', 'curved violet magazine', 'magazine', 'zone-r2c1', 'macro', 'silhouette'),
    _d('stock', 'contour', 'rounded violet stock block', 'stock', 'zone-r1c0', 'macro', 'silhouette'),
    _d('side-panel', 'groove', 'long recessed panel on the side', 'side-panel', 'zone-r1c1'),
    _d('front-panel', 'groove', 'short raised panel on the front housing', 'front-panel', 'zone-r1c2'),
    _d('trigger', 'contour', 'violet trigger inside a mint guard', 'trigger', 'zone-r2c0'),
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'mint'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
]

MODEL = build_gun_model(
    name='Tri-Pop', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'tri-pop-signature', 'name': 'Triple barrels, curved magazine, round stock', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['barrel-top', 'magazine', 'stock'], 'evidenceRefs': ['full-object']},
    palette='Mint body, grape stock/grip/magazine, yellow barrels', shape='long boxy burst rifle',
    blockout_ids=['body', 'front-housing', 'stock', 'grip', 'magazine', 'barrel-top'], length_m=0.44,
    assumptions=['Body thickness 0.13 m.', 'The two lower barrels sit side by side.'],
)
