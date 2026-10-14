"""Longshot (sniper). Traced in the 500 px preview (panel y offset removed); 1.3 m long; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, build_gun_model, cyl_z, material, rounded_rect, slab  # noqa: E402

F = Frame(1.3 / 476, (200, 262))

BODY_T = 0.09

PARTS = [
    slab(F, 'stock', [(12, 235), (95, 232), (132, 248), (332, 226), (332, 262), (142, 270), (126, 290), (86, 292), (42, 306), (15, 306)],
         0.09, 'mint', importance=1.0),
    cyl_z(F, 'barrel', 330, 452, 241, 9, 'grape', importance=0.9),
    cyl_z(F, 'muzzle', 446, 488, 241, 18, 'grape', importance=0.85),
    cyl_z(F, 'scope', 140, 300, 191, 14, 'grape', importance=0.85),
    cyl_z(F, 'scope-cap-rear', 117, 146, 191, 19, 'yellow', importance=0.7),
    cyl_z(F, 'scope-cap-front', 293, 318, 191, 19, 'yellow', importance=0.7),
    slab(F, 'scope-mount-a', rounded_rect(182, 186, 210, 228, 6), 0.05, 'mint', level='micro', importance=0.5),
    slab(F, 'scope-mount-b', rounded_rect(240, 188, 262, 226, 6), 0.05, 'mint', level='micro', importance=0.5),
    slab(F, 'grip', [(185, 262), (216, 262), (234, 302), (202, 310), (190, 282)], 0.07, 'grape', importance=0.8, role='grip'),
    slab(F, 'trigger', [(140, 262), (156, 262), (160, 280), (148, 286)], 0.03, 'yellow', level='micro', importance=0.5),
    slab(F, 'side-panel', rounded_rect(195, 236, 300, 256, 10), BODY_T + 0.024, 'mint-light', level='micro', importance=0.4),
]

MATERIALS = [
    material('mint', '#3DDBB4', 'zone-r1c0 stock'),
    material('grape', '#5B2A86', 'zone-r1c2 barrel, zone-r1c1 scope'),
    material('yellow', '#FFE45C', 'zone-r1c0 scope caps'),
    material('mint-light', '#6FE6C8', 'zone-r1c1 fore-end panel'),
]

DETAILS = [
    {'id': 'long-barrel', 'kind': 'contour', 'description': 'long thin violet barrel with a fat muzzle', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'barrel'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.9},
    {'id': 'scope', 'kind': 'contour', 'description': 'violet scope tube with yellow end caps', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'scope'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'scope-mounts', 'kind': 'fastener', 'description': 'two mint mounts under the scope', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'scope-mount-a'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.7},
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'mint'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'scope-caps', 'kind': 'ridge', 'description': 'yellow caps at both scope ends', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'scope-cap-front'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.75},
    {'id': 'grip', 'kind': 'contour', 'description': 'small violet pistol grip', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'grip'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.7},
    {'id': 'fat-muzzle', 'kind': 'contour', 'description': 'fat violet muzzle at the barrel end', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'muzzle'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.8},
]

MODEL = build_gun_model(
    name='Longshot', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'scope-and-barrel', 'name': 'Capped scope and long barrel', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['scope', 'barrel', 'muzzle'], 'evidenceRefs': ['full-object']},
    palette='Mint stock, grape barrel and scope, yellow caps', shape='long rifle: stock, thin barrel, scope on top',
    blockout_ids=['stock', 'barrel', 'muzzle', 'scope', 'grip'], length_m=0.79,
    assumptions=['Stock thickness 0.09 m.'],
)
