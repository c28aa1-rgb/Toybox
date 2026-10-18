"""Snag (grapple hero): pink egg with a yellow climbing helmet and headlamp, a rope sash and a grappling hook."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import HALF_PI, attach, belly_region, build_hero_model, mirror  # noqa: E402

# Body-local metres: centre of the egg at 0, crown at +0.625, +X is the character's left (image right).

HELMET = {'id': 'helmet', 'level': 'meso', 'role': 'ornament', 'parent': 'body', 'primitive': 'lathe', 'material': 'helmet-yellow',
          'dims': [1.0, 0.5, 0.9], 'pos': [0.0, 0.6, 0.0], 'importance': 0.95,
          'animationRole': 'wobble', 'pivotMode': 'base',
          'descriptor': {'latheProfile': {'points': [[0.0, -0.5], [0.5, -0.5], [0.5, -0.36], [0.47, -0.08], [0.4, 0.18], [0.28, 0.38], [0.12, 0.48], [0.0, 0.5]], 'segments': 32}},
          'topologyClass': 'open-shell', 'topologyRationale': 'Climbing helmet: a domed lathe sitting over the crown, wider than the head.',
          'localFeatures': [{'id': 'helmet-brim', 'kind': 'bevel', 'description': 'rolled lower edge of the helmet', 'evidenceRef': 'detail-inventory/zone-r0c1.png'}]}
VENT_L = {'id': 'vent-l', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'ellipsoid', 'material': 'vent-grey',
          'dims': [0.05, 0.13, 0.2], 'pos': [0.39, 0.62, 0.2], 'rot': [0.0, 1.0, 0.0], 'importance': 0.5}
LAMP = {'id': 'lamp-housing', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'vent-grey',
        'dims': [0.26, 0.1, 0.26], 'importance': 0.85,
        'topologyRationale': 'Round headlamp housing on the helmet front, facing forward.',
        'attachment': {**attach('body', 'brow', [0.0, 0.66, 0.34], [0.0, 0.66, 0.45], 'embed', 0.03), 'baseRadius': 0.12, 'endRadius': 0.12}}
LENS = {'id': 'lamp-lens', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'lamp-cream',
        'dims': [0.18, 0.02, 0.18], 'importance': 0.7,
        'topologyRationale': 'Cream lens set into the lamp housing.',
        'attachment': {**attach('body', 'lamp-face', [0.0, 0.66, 0.44], [0.0, 0.66, 0.465], 'embed', 0.01), 'baseRadius': 0.085, 'endRadius': 0.085}}

# Rope sash: a thick ring round the body, laid flat then tilted so it rises toward the character-left shoulder.
ROPE = {'id': 'rope', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'torus', 'material': 'rope-grape',
        'dims': [1.1, 1.0, 1.1], 'pos': [0.0, -0.14, 0.02], 'rot': [HALF_PI, 0.58, 0.0], 'importance': 0.9,
        'descriptor': {'torusTubeRatio': 0.13},
        'topologyRationale': 'Coiled rope worn as a sash: a torus around the egg, tilted across the chest.',
        'localFeatures': [{'id': 'rope-twist', 'kind': 'groove', 'description': 'twisted strands along the rope', 'evidenceRef': 'detail-inventory/zone-r1c2.png'}]}
ROPE_COIL = {**ROPE, 'id': 'rope-coil', 'dims': [1.06, 0.96, 1.1], 'pos': [0.0, -0.22, 0.03], 'importance': 0.6, 'localFeatures': []}

# Grappling hook in the character-right mitt (image left): a shaft up from the mitt, a hub, three prongs with curled tips.
HUB = [-0.36, 0.22, 0.26]


def prong(pid, end, tip, importance=0.7):
    shaft = {'id': pid, 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'cone', 'material': 'hook-steel',
             'dims': [0.1, 0.36, 0.1], 'importance': importance,
             'topologyRationale': 'Hook prong: a tapered spike out of the hub.',
             'attachment': {**attach('body', 'hook-hub', HUB, end, 'socket', 0.02), 'baseRadius': 0.05, 'endRadius': 0.038}}
    curl = {'id': pid + '-tip', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'cone', 'material': 'hook-steel',
            'dims': [0.08, 0.16, 0.08], 'importance': importance * 0.7,
            'topologyRationale': 'Curled barb at the end of a prong.',
            'attachment': {**attach('body', pid + '-end', end, tip, 'socket', 0.01), 'baseRadius': 0.04, 'endRadius': 0.01}}
    return [shaft, curl]


HOOK = [
    {'id': 'hook-shaft', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'hook-steel',
     'dims': [0.08, 0.3, 0.08], 'importance': 0.85,
     'topologyRationale': 'Short hook shaft rising out of the mitt.',
     'attachment': {**attach('body', 'mitt-r-top', [-0.46, -0.1, 0.24], HUB, 'socket', 0.02), 'baseRadius': 0.05, 'endRadius': 0.05}},
    {'id': 'hook-hub', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'sphere', 'material': 'hook-steel',
     'dims': [0.17, 0.17, 0.17], 'pos': HUB, 'importance': 0.7},
    *prong('prong-up', [-0.44, 0.64, 0.26], [-0.3, 0.62, 0.26]),
    *prong('prong-out', [-0.76, 0.36, 0.26], [-0.8, 0.2, 0.26]),
    *prong('prong-in', [-0.04, 0.38, 0.26], [0.0, 0.22, 0.26]),
]

PARTS = [HELMET, VENT_L, {**mirror(VENT_L), 'id': 'vent-r'}, LAMP, LENS, ROPE, ROPE_COIL, *HOOK]

MATERIALS = [
    {'id': 'helmet-yellow', 'color': '#FFE04A', 'roughness': 0.25, 'doubleSided': True, 'evidence': 'albedo-samples.json helmet-yellow; prompt #FFE45C'},
    {'id': 'vent-grey', 'color': '#4A4A55', 'roughness': 0.3, 'evidence': 'zone-r0c0 vents and lamp ring'},
    {'id': 'lamp-cream', 'color': '#FFF2D6', 'roughness': 0.15, 'emissive': '#FFE9B8', 'emissiveIntensity': 0.5, 'evidence': 'zone-r0c1 lamp lens'},
    {'id': 'rope-grape', 'color': '#5B2A86', 'roughness': 0.35, 'evidence': 'albedo-samples.json rope-grape'},
    {'id': 'hook-steel', 'color': '#B9BEC8', 'roughness': 0.2, 'evidence': 'zone-r1c0 hook'},
]

DETAILS = [
    {'id': 'helmet', 'kind': 'contour', 'description': 'yellow climbing helmet over the crown', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'helmet'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.9},
    {'id': 'headlamp', 'kind': 'contour', 'description': 'round headlamp on the helmet front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'lamp-housing'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.85},
    {'id': 'rope-sash', 'kind': 'contour', 'description': 'thick violet rope slung diagonally across the body', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'rope'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.8},
    {'id': 'grappling-hook', 'kind': 'contour', 'description': 'silver three-pronged hook held up in a mitt', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'hook-shaft'}, 'evidenceRef': 'detail-inventory/zone-r1c0.png', 'confidence': 0.8},
    {'id': 'belly-patch', 'kind': 'decal', 'description': 'large cream ellipse on the lower front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/belly-seam'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
]

MODEL = build_hero_model(
    name='Snag',
    body_color='#FF5FA2',
    body_evidence='albedo-samples.json body; prompt palette #FF5FA2',
    paint_regions=[belly_region(-0.26, (0.33, 0.38, 0.27))],
    body_features=[{'id': 'belly-seam', 'kind': 'seam', 'description': 'flush colour boundary of the cream belly', 'evidenceRef': 'detail-inventory/zone-r2c1.png'}],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'snag-helmet-rope-hook', 'name': 'Helmet with headlamp, rope sash and grappling hook', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['helmet', 'lamp-housing', 'rope', 'hook-shaft'], 'evidenceRefs': ['full-object']},
    palette_name='Pink body, cream belly, yellow helmet, violet rope and feet, silver hook',
    silhouette_shape='egg under a wide domed helmet, a rope ring tilted across the body, a three-pronged hook held up on the right, two feet',
    assumptions=['The rope wraps round the back of the body.', 'The helmet strap is hidden under the helmet rim.'],
)
