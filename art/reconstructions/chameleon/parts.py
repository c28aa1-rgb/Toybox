"""Chameleon (hide-and-seek hero): mint egg with eye turrets, a crown crest, spots and a coiled tail."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import attach, belly_region, body_half_extent, build_hero_model, mirror  # noqa: E402

SPOT = '#8FF0D2'


def spot(i: int, y: float, angle: float, r: float = 0.09) -> dict:
    """A lighter-mint spot painted on the body surface at body-local height y, `angle` from the front (+X is positive)."""
    hw, hd = body_half_extent(y)
    return {'id': f'spot-{i}', 'kind': 'ellipsoid', 'color': SPOT, 'softness': 0.01,
            'center': [round(hw * math.sin(angle), 3), y, round(hd * math.cos(angle), 3)], 'radii': [r, r, r]}


# The coil: a big ring, a smaller ring inside it and a ball at the centre, all in one plane that
# faces forward-left so the spiral reads face-on from the 3/4 view. Coil centre, body-local:
TAIL_C = [0.58, -0.12, -0.16]
TAIL_ROT = [0.0, 0.9, 0.0]


EYE_TURRET_L = {'id': 'eye-turret-l', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'ellipsoid',
                'material': 'body-plastic', 'dims': [0.4, 0.42, 0.18], 'pos': [0.17, 0.25, 0.31], 'rot': [-0.12, 0.38, 0.0],
                'importance': 0.85, 'topologyRationale': 'Mint turret bulge the eye sits in, proud of the head.',
                'attachment': attach('body', 'face-l', [0.13, 0.25, 0.2], [0.17, 0.25, 0.31], 'embed', 0.06),
                'localFeatures': [{'id': 'turret-rim', 'kind': 'bevel', 'description': 'rounded lip around the eye', 'evidenceRef': 'detail-inventory/zone-r1c1.png'}]}

PARTS = [
    EYE_TURRET_L,
    {**mirror(EYE_TURRET_L), 'id': 'eye-turret-r',
     'attachment': attach('body', 'face-r', [-0.13, 0.25, 0.2], [-0.17, 0.25, 0.31], 'embed', 0.06)},
    # Crest: a rounded cone on the crown leaning back, with a smaller bump behind it.
    {'id': 'crest', 'level': 'meso', 'role': 'horn', 'parent': 'body', 'primitive': 'cone', 'material': 'body-plastic',
     'dims': [0.24, 0.3, 0.24], 'importance': 0.85, 'animationRole': 'wobble', 'pivotMode': 'base',
     'topologyRationale': 'Crown crest: a soft cone from the crown leaning back.',
     'attachment': {**attach('body', 'crown', [0.0, 0.52, 0.02], [0.0, 0.78, -0.12], 'socket', 0.04), 'baseRadius': 0.15, 'endRadius': 0.045}},
    {'id': 'crest-2', 'level': 'micro', 'role': 'horn', 'parent': 'body', 'primitive': 'cone', 'material': 'body-plastic',
     'dims': [0.16, 0.16, 0.16], 'importance': 0.5,
     'topologyRationale': 'Second, smaller crest bump behind the first.',
     'attachment': {**attach('body', 'crown-back', [0.0, 0.48, -0.17], [0.0, 0.62, -0.3], 'socket', 0.03), 'baseRadius': 0.09, 'endRadius': 0.025}},
    # Tail: a tapered root from the lower back into the bottom of the coil, then the coil itself.
    {'id': 'tail-root', 'level': 'meso', 'role': 'tail', 'parent': 'body', 'primitive': 'cone', 'material': 'body-plastic',
     'dims': [0.2, 0.3, 0.2], 'importance': 0.7,
     'topologyRationale': 'Tail root: a tapered cylinder from the lower back to the bottom of the coil.',
     'attachment': {**attach('body', 'lower-back', [0.2, -0.36, -0.28], [0.55, -0.42, -0.2], 'embed', 0.05), 'baseRadius': 0.1, 'endRadius': 0.09}},
    {'id': 'tail', 'level': 'macro', 'role': 'tail', 'parent': 'body', 'primitive': 'torus', 'material': 'body-plastic',
     'dims': [0.64, 0.64, 0.19], 'pos': TAIL_C, 'rot': TAIL_ROT, 'importance': 0.9, 'animationRole': 'wobble',
     'descriptor': {'torusTubeRatio': 0.33},
     'attachment': attach('body', 'lower-back', [0.55, -0.42, -0.2], TAIL_C, 'overlap', 0.04),
     'topologyRationale': 'Outer coil of the tail: a fat torus in the coil plane.',
     'localFeatures': [{'id': 'tail-curl', 'kind': 'contour', 'description': 'tail winds inward toward the centre', 'evidenceRef': 'detail-inventory/zone-r1c2.png'}]},
    {'id': 'tail-curl', 'level': 'meso', 'role': 'tail', 'parent': 'tail', 'primitive': 'torus', 'material': 'body-plastic',
     'dims': [0.26, 0.26, 0.11], 'pos': [0.03, 0.02, 0.02], 'importance': 0.7,
     'descriptor': {'torusTubeRatio': 0.3},
     'attachment': attach('tail', 'coil-inner', [0.0, -0.2, 0.0], [0.03, 0.02, 0.02], 'overlap', 0.03),
     'topologyRationale': 'Inner turn of the coil.'},
    {'id': 'tail-tip', 'level': 'micro', 'role': 'tail', 'parent': 'tail-curl', 'primitive': 'sphere', 'material': 'body-plastic',
     'dims': [0.09, 0.09, 0.09], 'pos': [0.0, 0.0, 0.02], 'importance': 0.5,
     'attachment': attach('tail-curl', 'coil-centre', [0.0, -0.1, 0.0], [0.0, 0.0, 0.02], 'overlap', 0.02)},
]

MATERIALS = []

DETAILS = [
    {'id': 'eye-turrets', 'kind': 'contour', 'description': 'mint bulges around each eye', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'eye-turret-l'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'crest', 'kind': 'contour', 'description': 'rounded crest fin on the crown', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'crest'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.85},
    {'id': 'spiral-tail', 'kind': 'contour', 'description': 'thick tail coiled into a flat spiral beside the body', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'tail'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.85},
    {'id': 'spots', 'kind': 'decal', 'description': 'lighter-mint round spots on crown and flanks', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/spot-paint'}, 'evidenceRef': 'detail-inventory/zone-r0c2.png', 'confidence': 0.75},
    {'id': 'belly-patch', 'kind': 'decal', 'description': 'large cream ellipse on the lower front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/belly-seam'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
]

SPOTS = [spot(i, y, a) for i, (y, a) in enumerate([
    (0.44, 0.9), (0.3, 1.55), (0.06, 1.75), (-0.2, 1.72), (-0.42, 1.45), (0.5, -0.35),
    (0.12, -1.7), (-0.3, -1.65), (0.36, 2.4), (0.0, 2.55), (0.5, 3.05), (-0.25, 2.9),
])]

MODEL = build_hero_model(
    name='Chameleon',
    body_color='#3DDBB4',
    body_evidence='albedo-samples.json body flank median; prompt palette #3DDBB4',
    paint_regions=[belly_region(-0.3, (0.33, 0.37, 0.25)), *SPOTS],
    body_features=[
        {'id': 'belly-seam', 'kind': 'seam', 'description': 'flush colour boundary of the cream belly', 'evidenceRef': 'detail-inventory/zone-r2c1.png'},
        {'id': 'spot-paint', 'kind': 'decal', 'description': 'round lighter-mint spots', 'evidenceRef': 'detail-inventory/zone-r0c2.png'},
    ],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'chameleon-tail-eyes', 'name': 'Spiral tail, eye turrets and crest', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['tail', 'tail-curl', 'eye-turret-l', 'eye-turret-r', 'crest'], 'evidenceRefs': ['full-object']},
    palette_name='Mint body with lighter spots, cream belly, violet feet',
    silhouette_shape='egg with eye bulges, a crest on the crown, two side mitts, two feet, and a spiral tail on the left side',
    assumptions=['Tail joins the lower back behind the hanging mitt.', 'Spots on the hidden back are placed symmetrically to the visible ones.'],
)

# The eyes sit forward in their turrets and run a little bigger and further apart than the base.
for _p in MODEL['parts']:
    if _p['id'] in ('eye-l', 'eye-r'):
        side = 1 if _p['id'] == 'eye-l' else -1
        _p['dims'] = [0.31, 0.34, 0.1]
        _p['pos'] = [0.17 * side, 0.25, 0.4]
