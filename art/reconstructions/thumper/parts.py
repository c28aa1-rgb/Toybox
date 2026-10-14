"""Thumper (hand cannon sidearm). Traced in the 500 px preview (panel x offset removed); 0.5 m long; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, build_gun_model, cyl_z, material, ring_z, rounded_rect, slab  # noqa: E402

F = Frame(0.5 / 445, (170, 240))

PARTS = [
    slab(F, 'frame', rounded_rect(125, 118, 340, 262, 30), 0.13, 'orange', importance=1.0),
    cyl_z(F, 'barrel', 320, 470, 192, 52, 'orange', importance=0.95),
    cyl_z(F, 'bore', 462, 474, 192, 28, 'ink', level='micro', importance=0.4, role='pipe'),
    cyl_z(F, 'drum', 200, 312, 195, 70, 'grape', importance=0.95),
    slab(F, 'front-sight', rounded_rect(400, 108, 440, 140, 8), 0.05, 'orange', level='micro', importance=0.4),
    slab(F, 'hammer', [(100, 145), (150, 128), (172, 168), (132, 192)], 0.06, 'yellow', level='micro', importance=0.6),
    slab(F, 'grip', [(160, 225), (215, 245), (185, 330), (160, 392), (80, 398), (25, 360), (60, 290), (110, 240)], 0.11, 'grape', importance=0.9, role='grip'),
    ring_z(F, 'trigger-guard', 228, 298, 50, 34, 0.04, 'orange', facing='x', importance=0.6),
    slab(F, 'trigger', [(196, 275), (238, 280), (244, 320), (226, 332), (204, 320)], 0.04, 'yellow', level='micro', importance=0.6),
]

MATERIALS = [
    material('orange', '#FF8A1F', 'zone-r1c1 frame and barrel'),
    material('grape', '#6A2FA0', 'zone-r1c1 drum, zone-r2c0 grip'),
    material('yellow', '#FFE45C', 'zone-r0c0 hammer'),
    material('ink', '#2B1F45', 'zone-r1c2 bore'),
]

def _d(i, kind, desc, ref, zone, scale='micro', affects='identity', conf=0.8):
    return {'id': i, 'kind': kind, 'description': desc, 'scale': scale, 'affects': affects,
            'mapsTo': {'type': 'component', 'ref': ref}, 'evidenceRef': f'detail-inventory/{zone}.png', 'confidence': conf}

DETAILS = [
    _d('drum', 'contour', 'big round violet cylinder drum', 'drum', 'zone-r1c1', 'macro', 'identity'),
    _d('fat-barrel', 'contour', 'fat orange barrel with a dark bore', 'barrel', 'zone-r1c2', 'macro', 'silhouette'),
    _d('hammer', 'contour', 'yellow hammer at the back', 'hammer', 'zone-r0c0'),
    _d('grip', 'contour', 'curved violet grip', 'grip', 'zone-r2c0', 'macro', 'silhouette'),
    _d('trigger', 'contour', 'yellow trigger in an orange guard', 'trigger', 'zone-r1c1'),
    _d('front-sight', 'ridge', 'small orange sight on the barrel', 'front-sight', 'zone-r0c2'),
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'orange'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
]

MODEL = build_gun_model(
    name='Thumper', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'thumper-signature', 'name': 'Violet drum and fat orange barrel', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['drum', 'barrel', 'frame'], 'evidenceRefs': ['full-object']},
    palette='Orange frame and barrel, violet drum and grip, yellow hammer and trigger', shape='chunky revolver',
    blockout_ids=['frame', 'barrel', 'drum', 'grip', 'hammer'], length_m=0.34,
    assumptions=['Frame thickness 0.13 m; drum is a cylinder along the barrel axis.'],
)
