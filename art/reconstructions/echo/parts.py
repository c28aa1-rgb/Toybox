"""Echo (sonar hero): orange bat egg with radar-dish ears, blue headphones and small bat wings."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import HALF_PI, attach, belly_region, build_hero_model, mirror  # noqa: E402

# Dish: a shallow bowl, open at +Y before it is turned to face forward. Unit profile [radius, y].
# The last points roll back over the rim so the lip reads thick, like the moulded rim in the reference.
DISH_PROFILE = [[0.0, -0.5], [0.2, -0.45], [0.34, -0.3], [0.43, -0.1], [0.48, 0.15], [0.5, 0.36], [0.53, 0.45], [0.5, 0.5], [0.45, 0.46]]
DISH_DIMS = [0.6, 0.22, 0.6]

DISH_L = {'id': 'dish-l', 'level': 'meso', 'role': 'ornament', 'parent': 'body', 'primitive': 'lathe', 'material': 'dish-orange',
          'dims': DISH_DIMS, 'pos': [0.42, 0.56, 0.0], 'rot': [HALF_PI, 0.0, -0.35], 'importance': 0.95,
          'animationRole': 'wobble', 'pivotMode': 'base',
          'descriptor': {'latheProfile': {'points': DISH_PROFILE, 'segments': 28}},
          'attachment': attach('body', 'crown-l', [0.25, 0.5, 0.0], [0.42, 0.56, 0.0], 'overlap', 0.04),
          'topologyClass': 'open-shell', 'topologyRationale': 'Radar-dish ear: a shallow lathe bowl, open toward the front.',
          'localFeatures': [{'id': 'dish-lip', 'kind': 'bevel', 'description': 'rolled rim around the dish', 'evidenceRef': 'detail-inventory/zone-r0c2.png'}]}
DISH_FACE_L = {'id': 'dish-face-l', 'level': 'micro', 'role': 'detail', 'parent': 'dish-l', 'primitive': 'cylinder', 'material': 'dish-cream',
               'dims': [0.54, 0.02, 0.54], 'importance': 0.7,
               'topologyRationale': 'Cream inner face of the dish: a thin disc set into the bowl.',
               'attachment': {**attach('dish-l', 'dish-floor', [0.0, 0.05, 0.0], [0.0, 0.07, 0.0], 'embed', 0.01), 'baseRadius': 0.27, 'endRadius': 0.27}}
ANTENNA_L = {'id': 'antenna-l', 'level': 'micro', 'role': 'detail', 'parent': 'dish-l', 'primitive': 'cylinder', 'material': 'dish-orange',
             'dims': [0.04, 0.16, 0.04], 'importance': 0.6,
             'topologyRationale': 'Antenna stalk standing out of the dish centre.',
             'attachment': {**attach('dish-l', 'dish-centre', [0.0, 0.05, 0.0], [0.0, 0.2, 0.0], 'socket', 0.02), 'baseRadius': 0.022, 'endRadius': 0.02}}
ANTENNA_TIP_L = {'id': 'antenna-tip-l', 'level': 'micro', 'role': 'detail', 'parent': 'dish-l', 'primitive': 'sphere', 'material': 'dish-orange',
                 'dims': [0.09, 0.09, 0.09], 'pos': [0.0, 0.21, 0.0], 'importance': 0.55}

# Headphones: a ring set back so it hides inside the head at the front and shows round the back.
BAND = {'id': 'phones-band', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'torus', 'material': 'phone-blue',
        'dims': [0.98, 0.84, 0.09], 'pos': [0.0, 0.02, -0.08], 'rot': [HALF_PI, 0.0, 0.0], 'importance': 0.7,
        'descriptor': {'torusTubeRatio': 0.13},
        'topologyRationale': 'Headphone band around the back of the neck; its front half is buried in the head.'}
# Cups and caps are cylinders built between two points along the cup axis, which points out of the
# cheek and a little forward.
CUP_AXIS = (0.92, 0.0, 0.39)
CUP_C = (0.44, 0.04, 0.15)


def along(t: float) -> list[float]:
    return [round(c + t * a, 3) for c, a in zip(CUP_C, CUP_AXIS)]


CUP_L = {'id': 'cup-l', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'phone-blue',
         'dims': [0.25, 0.12, 0.25], 'importance': 0.85,
         'topologyRationale': 'Round headphone cup on the cheek, facing out and a little forward.',
         'attachment': {**attach('body', 'cheek-l', along(-0.06), along(0.06), 'embed', 0.04), 'baseRadius': 0.125, 'endRadius': 0.125}}
CAP_L = {'id': 'cap-l', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'phone-dark',
         'dims': [0.14, 0.03, 0.14], 'importance': 0.6,
         'topologyRationale': 'Darker blue cap on the outside of the cup.',
         'attachment': {**attach('body', 'cheek-l', along(0.05), along(0.075), 'embed', 0.01), 'baseRadius': 0.075, 'endRadius': 0.075}}

# Wing: an extruded bat-wing outline (scalloped lower edge) behind the hanging mitt.
WING_POINTS = [[-0.5, 0.15], [0.0, 0.35], [0.5, 0.5], [0.42, 0.1], [0.3, -0.2], [0.2, -0.5], [0.05, -0.2],
               [-0.12, -0.35], [-0.28, -0.1], [-0.5, -0.25]]
WING_L = {'id': 'wing-l', 'level': 'meso', 'role': 'wing', 'parent': 'body', 'primitive': 'extrude', 'material': 'wing-cream',
          'dims': [0.38, 0.42, 0.03], 'pos': [0.6, -0.04, -0.2], 'rot': [0.0, -0.3, 0.0], 'importance': 0.8,
          'animationRole': 'flap', 'pivotMode': 'base',
          'descriptor': {'profile2D': {'points': WING_POINTS, 'depth': 1.0}},
          'attachment': attach('body', 'back-l', [0.36, -0.04, -0.2], [0.6, -0.04, -0.2], 'overlap', 0.03),
          'topologyRationale': 'Thin bat-wing membrane: an extruded outline with a scalloped trailing edge.'}
BONE_L = {'id': 'wing-bone-l', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'cone', 'material': 'dish-orange',
          'dims': [0.06, 0.48, 0.06], 'importance': 0.6,
          'topologyRationale': 'Wing bone along the top edge of the membrane.',
          'attachment': {**attach('body', 'back-l', [0.4, 0.02, -0.18], [0.76, 0.17, -0.27], 'socket', 0.02), 'baseRadius': 0.035, 'endRadius': 0.018}}


def mirrored(p: dict, **extra) -> dict:
    """The character-right twin of a left part: reflect position, rotation and attachment across X."""
    q = {**(mirror(p) if 'pos' in p else dict(p)), 'id': p['id'][:-1] + 'r', **extra}
    if 'attachment' in p:
        a = dict(p['attachment'])
        a['localStart'] = [-a['localStart'][0], *a['localStart'][1:]]
        a['localEnd'] = [-a['localEnd'][0], *a['localEnd'][1:]]
        a['parentSocket'] = a['parentSocket'].replace('-l', '-r')
        q['attachment'] = a
    return q


PARTS = [
    DISH_L, mirrored(DISH_L),
    DISH_FACE_L, {**DISH_FACE_L, 'id': 'dish-face-r', 'parent': 'dish-r', 'attachment': {**DISH_FACE_L['attachment'], 'parentId': 'dish-r'}},
    ANTENNA_L, {**ANTENNA_L, 'id': 'antenna-r', 'parent': 'dish-r', 'attachment': {**ANTENNA_L['attachment'], 'parentId': 'dish-r'}},
    ANTENNA_TIP_L, {**ANTENNA_TIP_L, 'id': 'antenna-tip-r', 'parent': 'dish-r'},
    BAND,
    CUP_L, mirrored(CUP_L),
    CAP_L, mirrored(CAP_L),
    WING_L, mirrored(WING_L, descriptor={'profile2D': {'points': [[-x, y] for x, y in reversed(WING_POINTS)], 'depth': 1.0}}),
    BONE_L, mirrored(BONE_L),
]

MATERIALS = [
    {'id': 'dish-orange', 'color': '#FF8A1F', 'roughness': 0.25, 'doubleSided': True, 'evidence': 'zone-r0c0 / r0c2 dish rims'},
    {'id': 'dish-cream', 'color': '#F3E3CC', 'roughness': 0.25, 'evidence': 'zone-r0c0 dish inner face'},
    {'id': 'phone-blue', 'color': '#6FB0F0', 'roughness': 0.25, 'evidence': 'zone-r1c0 headphone cup'},
    {'id': 'phone-dark', 'color': '#3F7FDB', 'roughness': 0.25, 'evidence': 'zone-r1c2 headphone cap'},
    {'id': 'wing-cream', 'color': '#F2DEC4', 'roughness': 0.3, 'doubleSided': True, 'evidence': 'zone-r1c2 wing membrane'},
]

DETAILS = [
    {'id': 'dish-ears', 'kind': 'contour', 'description': 'two big radar-dish ears with cream faces and antenna stalks', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'dish-l'}, 'evidenceRef': 'detail-inventory/zone-r0c2.png', 'confidence': 0.85},
    {'id': 'headphones', 'kind': 'contour', 'description': 'light-blue headphone cups on the cheeks, band behind the neck', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'cup-l'}, 'evidenceRef': 'detail-inventory/zone-r1c0.png', 'confidence': 0.8},
    {'id': 'bat-wings', 'kind': 'contour', 'description': 'small cream bat wings with orange bones behind the mitts', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'wing-l'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.8},
    {'id': 'belly-patch', 'kind': 'decal', 'description': 'large cream ellipse on the lower front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/belly-seam'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
]

MODEL = build_hero_model(
    name='Echo',
    body_color='#FF8A1F',
    body_evidence='albedo-samples.json body forehead median; prompt palette #FF8A1F',
    paint_regions=[belly_region(-0.28, (0.34, 0.4, 0.26))],
    body_features=[{'id': 'belly-seam', 'kind': 'seam', 'description': 'flush colour boundary of the cream belly', 'evidenceRef': 'detail-inventory/zone-r2c1.png'}],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'echo-dishes-phones', 'name': 'Radar-dish ears, headphones and bat wings', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['dish-l', 'dish-r', 'cup-l', 'cup-r', 'wing-l', 'wing-r'], 'evidenceRefs': ['full-object']},
    palette_name='Orange body, cream belly and dish faces, light-blue headphones, cream wings, violet feet',
    silhouette_shape='egg with two big dish ears on the crown, headphone cups on the cheeks, small wings behind the mitts, and two feet',
    assumptions=['Headphone band wraps the back of the neck.', 'Wing roots join the back behind the mitts.'],
)
