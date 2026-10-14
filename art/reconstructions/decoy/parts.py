"""Mirage (decoy hero): lavender egg with a dark domino-mask band and a grape top hat."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import HALF_PI, attach, belly_region, build_hero_model  # noqa: E402

PARTS = [
    # Top hat tilted toward character-left: crown cylinder plus a fat torus brim.
    {'id': 'hat-crown', 'level': 'meso', 'role': 'support', 'parent': 'body', 'primitive': 'cylinder', 'material': 'hat-grape',
     'dims': [0.42, 0.34, 0.42], 'importance': 0.9, 'animationRole': 'wobble', 'pivotMode': 'base',
     'topologyRationale': 'Top hat crown: a short cylinder flaring slightly toward the top, built from the crown point.',
     'attachment': {**attach('body', 'crown', [0.06, 0.56, 0.0], [0.14, 0.9, 0.0], 'embed', 0.05), 'baseRadius': 0.19, 'endRadius': 0.21}},
    {'id': 'hat-brim', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'torus', 'material': 'hat-grape',
     'dims': [0.62, 0.58, 0.5], 'pos': [0.07, 0.58, 0.0], 'rot': [HALF_PI, 0, 0.0], 'importance': 0.85,
     'descriptor': {'torusTubeRatio': 0.2},
     'topologyRationale': 'Rolled hat brim: a fat torus lying flat around the base of the crown.'},
]

MATERIALS = [
    {'id': 'hat-grape', 'color': '#5B2A86', 'roughness': 0.3, 'evidence': 'zone-r0c1 / r0c2 hat'},
]

DETAILS = [
    {'id': 'domino-mask', 'kind': 'decal', 'description': 'dark ink band across the eyes wrapping around the head', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/mask-band'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
    {'id': 'top-hat', 'kind': 'contour', 'description': 'short grape top hat with a rolled brim, tilted', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'hat-crown'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.85},
    {'id': 'belly-patch', 'kind': 'decal', 'description': 'cream ellipse on the lower front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/belly-seam'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
]

MASK = {'id': 'mask', 'kind': 'axis-band', 'axis': 'y', 'min': 0.12, 'max': 0.33, 'color': '#2B1F45', 'softness': 0.02}

MODEL = build_hero_model(
    name='Mirage',
    body_color='#B48CFF',
    body_evidence='albedo-samples.json body flank median; prompt palette #B48CFF',
    paint_regions=[MASK, belly_region()],
    body_features=[
        {'id': 'mask-band', 'kind': 'seam', 'description': 'hard colour boundary of the domino mask band', 'evidenceRef': 'detail-inventory/zone-r1c1.png'},
        {'id': 'belly-seam', 'kind': 'seam', 'description': 'flush colour boundary of the cream belly', 'evidenceRef': 'detail-inventory/zone-r2c1.png'},
    ],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'mask-and-hat', 'name': 'Domino mask band and tilted top hat', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['body', 'hat-crown', 'hat-brim'], 'evidenceRefs': ['full-object']},
    palette_name='Lavender body, ink mask band, cream belly, grape hat, violet feet',
    silhouette_shape='egg with a small top hat perched on the crown, two side mitts, two feet',
    assumptions=['Mask band wraps fully around the head at eye height.'],
)
