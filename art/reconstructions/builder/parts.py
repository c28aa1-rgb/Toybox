"""Brick (builder hero): orange egg with a yellow hard hat and a tool belt holding a toy brick."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import HALF_PI, belly_region, build_hero_model  # noqa: E402

BELT_Y = -0.3  # body-local; 0.74 of body height from the crown

HAT_PROFILE = [[0.47, -0.5], [0.55, -0.48], [0.56, -0.44], [0.5, -0.36], [0.47, -0.1], [0.41, 0.14], [0.3, 0.33], [0.16, 0.45], [0.0, 0.5]]

PARTS = [
    {'id': 'hard-hat', 'level': 'macro', 'role': 'detail', 'parent': 'body', 'primitive': 'lathe', 'material': 'hat-yellow',
     'dims': [0.9, 0.44, 0.84], 'pos': [0, 0.72, -0.03], 'rot': [0.06, 0, 0], 'importance': 0.95,
     'descriptor': {'latheProfile': {'points': HAT_PROFILE, 'segments': 36}},
     'topologyClass': 'open-shell', 'topologyRationale': 'Hard hat dome, open underneath where it sits over the crown.',
     'localFeatures': [{'id': 'hat-ridges', 'kind': 'ridge', 'description': 'raised ridges running front to back over the dome', 'evidenceRef': 'detail-inventory/zone-r0c1.png'}]},
    {'id': 'hat-ridge', 'level': 'micro', 'role': 'detail', 'parent': 'hard-hat', 'primitive': 'box', 'material': 'hat-yellow',
     'dims': [0.12, 0.1, 0.5], 'pos': [0, 0.19, 0.0], 'rot': [0.0, 0, 0], 'importance': 0.5},
    {'id': 'hat-peak', 'level': 'meso', 'role': 'detail', 'parent': 'hard-hat', 'primitive': 'ellipsoid', 'material': 'hat-yellow',
     'dims': [0.66, 0.06, 0.34], 'pos': [0, -0.19, 0.44], 'rot': [-0.3, 0, 0], 'importance': 0.7},
    # Tool belt: a flattened torus around the lower body with a toy brick as the buckle.
    {'id': 'belt', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'torus', 'material': 'belt-ink',
     'dims': [1.0, 0.86, 0.75], 'pos': [0, BELT_Y, 0.0], 'rot': [HALF_PI, 0, 0], 'importance': 0.85,
     'descriptor': {'torusTubeRatio': 0.13},
     'topologyRationale': 'Strap around the body: torus scaled to the body cross-section.'},
    {'id': 'buckle-brick', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'box', 'material': 'brick-orange',
     'dims': [0.26, 0.14, 0.12], 'pos': [-0.12, BELT_Y + 0.02, 0.46], 'rot': [0, -0.3, 0], 'importance': 0.8},
    {'id': 'brick-stud-a', 'level': 'micro', 'role': 'detail', 'parent': 'buckle-brick', 'primitive': 'ellipsoid', 'material': 'brick-orange',
     'dims': [0.07, 0.05, 0.07], 'pos': [-0.06, 0.08, 0], 'importance': 0.4},
    {'id': 'brick-stud-b', 'level': 'micro', 'role': 'detail', 'parent': 'buckle-brick', 'primitive': 'ellipsoid', 'material': 'brick-orange',
     'dims': [0.07, 0.05, 0.07], 'pos': [0.06, 0.08, 0], 'importance': 0.4},
]

MATERIALS = [
    {'id': 'hat-yellow', 'color': '#FFE45C', 'roughness': 0.22, 'doubleSided': True, 'evidence': 'zone-r0c1 hat dome'},
    {'id': 'belt-ink', 'color': '#4A3A66', 'roughness': 0.35, 'evidence': 'zone-r2c1 belt'},
    {'id': 'brick-orange', 'color': '#FF8A1F', 'roughness': 0.25, 'evidence': 'zone-r2c0 brick buckle'},
]

DETAILS = [
    {'id': 'hard-hat', 'kind': 'contour', 'description': 'yellow ribbed hard hat with a front peak', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'hard-hat'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.85},
    {'id': 'tool-belt', 'kind': 'seam', 'description': 'dark strap around the lower body', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'belt'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.85},
    {'id': 'brick-buckle', 'kind': 'fastener', 'description': 'orange toy brick with two studs clipped to the belt', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'buckle-brick'}, 'evidenceRef': 'detail-inventory/zone-r2c0.png', 'confidence': 0.8},
    {'id': 'belly-patch', 'kind': 'decal', 'description': 'cream ellipse on the lower front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/belly-seam'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
]

MODEL = build_hero_model(
    name='Brick',
    body_color='#FF8A1F',
    body_evidence='albedo-samples.json body flank median; prompt palette #FF8A1F',
    paint_regions=[belly_region(-0.24, (0.31, 0.36, 0.25))],
    body_features=[{'id': 'belly-seam', 'kind': 'seam', 'description': 'flush colour boundary of the cream belly', 'evidenceRef': 'detail-inventory/zone-r2c1.png'}],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'hat-and-belt', 'name': 'Yellow hard hat and tool belt with brick', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['hard-hat', 'belt', 'buckle-brick'], 'evidenceRefs': ['full-object']},
    palette_name='Orange body, cream belly, yellow hat, ink belt, orange brick, violet feet',
    silhouette_shape='egg under a wide dome hat, belt around the waist, two side mitts, two feet',
    assumptions=['Hat dome is open underneath and sits over the crown.', 'Belt wraps fully around the back.'],
)
