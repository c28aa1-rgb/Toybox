"""Party Popper (rocket launcher). Traced in the 500 px preview (panel offsets removed); 1.0 m long; origin at the grip top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import Frame, build_gun_model, cyl_z, material, nose_z, slab  # noqa: E402

F = Frame(1.0 / 470, (180, 268))

PARTS = [
    cyl_z(F, 'tube', 138, 372, 227, 47, 'pink', importance=1.0),
    cyl_z(F, 'ring-rear', 95, 142, 227, 54, 'sky', importance=0.85),
    cyl_z(F, 'ring-front', 368, 414, 227, 54, 'sky', importance=0.85),
    nose_z(F, 'nose', 412, 487, 227, 44, 'yellow'),
    slab(F, 'stock', [(15, 240), (98, 232), (98, 276), (58, 310), (40, 320), (20, 300)], 0.09, 'grape', importance=0.8, role='grip'),
    slab(F, 'grip', [(165, 268), (212, 268), (202, 330), (172, 346), (140, 336), (155, 300)], 0.09, 'grape', importance=0.85, role='grip'),
    slab(F, 'trigger', [(205, 272), (228, 274), (232, 296), (218, 304), (208, 292)], 0.04, 'yellow', level='micro', importance=0.5),
]

MATERIALS = [
    material('pink', '#FF5FA2', 'zone-r1c1 tube'),
    material('sky', '#4FB3FF', 'zone-r1c0 / r1c2 rings'),
    material('yellow', '#FFE45C', 'zone-r1c2 nose'),
    material('grape', '#5B2A86', 'zone-r2c0 grip and stock'),
]

DETAILS = [
    {'id': 'pink-tube', 'kind': 'contour', 'description': 'fat pink launch tube', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'tube'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.9},
    {'id': 'blue-rings', 'kind': 'ridge', 'description': 'sky-blue ring at each end of the tube', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'ring-rear'}, 'evidenceRef': 'detail-inventory/zone-r1c0.png', 'confidence': 0.85},
    {'id': 'yellow-nose', 'kind': 'contour', 'description': 'yellow rounded rocket nose poking out of the front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'nose'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.85},
    {'id': 'gloss', 'kind': 'gloss', 'description': 'glossy moulded plastic', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'pink'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'front-ring', 'kind': 'ridge', 'description': 'sky-blue ring at the tube mouth', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'ring-front'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.75},
    {'id': 'grip-and-stock', 'kind': 'contour', 'description': 'violet grip and shoulder stock below the tube', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'grip'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.8},
    {'id': 'trigger', 'kind': 'contour', 'description': 'small yellow trigger', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'trigger'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.75},
]

MODEL = build_gun_model(
    name='Party Popper', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'tube-rings-nose', 'name': 'Pink tube, blue end rings, yellow nose', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['tube', 'ring-front', 'nose'], 'evidenceRefs': ['full-object']},
    palette='Pink tube, sky rings, yellow nose, grape grip and stock', shape='fat tube with a bullet nose, grip and stock hanging below',
    blockout_ids=['tube', 'ring-rear', 'ring-front', 'nose', 'grip', 'stock'], length_m=0.65,
    assumptions=['Tube is a plain cylinder; the side panel on the tube is not modelled.'],
)
