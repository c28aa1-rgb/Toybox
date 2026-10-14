"""Switch (swap hero): pink egg with a sky-blue belt band and two opposing arrow fins on top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import HALF_PI, attach, belly_region, build_hero_model  # noqa: E402

PARTS = [
    # Band sits just under the eyes (0.43 of body height from the crown in the reference).
    {'id': 'band', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'lathe',
     'dims': [1.04, 0.13, 0.9], 'pos': [0, 0.05, 0.0], 'material': 'band-blue', 'importance': 0.9,
     'descriptor': {'latheProfile': {'points': [[0.43, -0.5], [0.48, -0.5], [0.5, -0.35], [0.5, 0.35], [0.48, 0.5], [0.43, 0.5]], 'segments': 48}},
     'topologyClass': 'open-shell', 'topologyRationale': 'Flat moulded ring around the body: a lathe band whose inner edge is hidden inside the body.',
     'localFeatures': [{'id': 'band-ring', 'kind': 'ridge', 'description': 'rounded ring standing ~0.06 m proud of the body', 'evidenceRef': 'detail-inventory/zone-r1c1.png'}]},
    # Fins: cones built as attachment cylinders tapering to a point (generator convention).
    {'id': 'fin-white', 'level': 'meso', 'role': 'horn', 'parent': 'body', 'primitive': 'cone', 'material': 'fin-white',
     'dims': [0.26, 0.36, 0.26], 'importance': 0.9, 'animationRole': 'wobble', 'pivotMode': 'base',
     'topologyRationale': 'Arrow fin: a cone from the crown side pointing up and out to character-right.',
     'attachment': {**attach('body', 'crown-r', [-0.26, 0.46, 0.0], [-0.46, 0.7, 0.0], 'socket', 0.04), 'baseRadius': 0.17, 'endRadius': 0.004}},
    {'id': 'fin-blue', 'level': 'meso', 'role': 'horn', 'parent': 'body', 'primitive': 'cone', 'material': 'band-blue',
     'dims': [0.26, 0.36, 0.26], 'importance': 0.9, 'animationRole': 'wobble', 'pivotMode': 'base',
     'topologyRationale': 'Arrow fin: a cone from the crown side pointing out to character-left, roughly horizontal.',
     'attachment': {**attach('body', 'crown-l', [0.26, 0.48, 0.0], [0.57, 0.55, 0.0], 'socket', 0.04), 'baseRadius': 0.17, 'endRadius': 0.004}},
]

MATERIALS = [
    {'id': 'band-blue', 'color': '#4FB3FF', 'roughness': 0.25, 'doubleSided': True, 'evidence': 'zone-r1c1 band, zone-r0c2 blue fin'},
    {'id': 'fin-white', 'color': '#F4F2EE', 'roughness': 0.25, 'evidence': 'zone-r0c0 / r0c1 white fin'},
]

DETAILS = [
    {'id': 'band', 'kind': 'ridge', 'description': 'sky-blue ring around the body under the eyes', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'band'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'opposing-fins', 'kind': 'contour', 'description': 'white fin up-right, blue fin out-left, like swap arrows', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'fin-white'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.75},
    {'id': 'belly-patch', 'kind': 'decal', 'description': 'large cream ellipse on the lower front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/belly-seam'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
]

MODEL = build_hero_model(
    name='Switch',
    body_color='#FF5FA2',
    body_evidence='albedo-samples.json body flank median; prompt palette #FF5FA2',
    paint_regions=[belly_region(-0.33, (0.33, 0.36, 0.25))],
    body_features=[{'id': 'belly-seam', 'kind': 'seam', 'description': 'flush colour boundary of the cream belly', 'evidenceRef': 'detail-inventory/zone-r2c1.png'}],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'swap-fins-band', 'name': 'Blue band and opposing white/blue arrow fins', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['band', 'fin-white', 'fin-blue'], 'evidenceRefs': ['full-object']},
    palette_name='Pink body, cream belly, sky-blue band, white and blue fins, violet feet',
    silhouette_shape='egg with a ring under the eyes, two side mitts, two feet, and two cone fins splayed from the crown',
    assumptions=['Band wraps fully around the back.', 'Fins are round cones; the reference shows a flat base collar that is not modelled.'],
)
