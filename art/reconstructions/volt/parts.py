"""Volt (overcharge hero): a yellow battery with a silver cap, a lightning bolt and a plug tail."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import attach, build_hero_model  # noqa: E402

# Battery body: a rounded cylinder. Narrower and taller than the shared egg (reference ~1.8:1).
BODY_W, BODY_H = 0.74, 1.3
TOP = BODY_H / 2
FRONT = 0.33  # body-local z of the front surface (round cross-section, radius 0.37 x 0.33)
# Dense rows on the straight sides: vertex paint (the purple band) only has a crisp edge where the
# lathe has rings to hold it.
BATTERY_PROFILE = ([[0.0, -0.5], [0.42, -0.5], [0.48, -0.47]]
                   + [[0.5, round(-0.42 + 0.04 * i, 2)] for i in range(22)]
                   + [[0.48, 0.48], [0.43, 0.5], [0.0, 0.5]])

BOLT_POINTS = [[0.05, 0.5], [-0.38, -0.02], [-0.04, -0.02], [-0.16, -0.5], [0.38, 0.1], [0.04, 0.1], [0.24, 0.5]]


def cable(i: int, start, end) -> dict:
    return {'id': f'cable-{i}', 'level': 'meso' if i == 2 else 'micro', 'role': 'tail', 'parent': 'body', 'primitive': 'capsule',
            'material': 'cable-cream', 'dims': [0.06, 0.2, 0.06], 'importance': 0.7,
            'topologyRationale': 'Charging cable segment: a capsule between two bend points so the joints stay round.',
            'attachment': {**attach('body', 'lower-back', start, end, 'overlap', 0.02), 'baseRadius': 0.032, 'endRadius': 0.032}}


CABLE = [(0.22, -0.3, -0.14), (0.52, -0.36, -0.09), (0.64, -0.2, -0.06), (0.63, -0.01, -0.05)]

PARTS = [
    {'id': 'cap-base', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'cap-silver',
     'dims': [0.5, 0.05, 0.5], 'importance': 0.8,
     'topologyRationale': 'Flat silver ring of the battery terminal on the crown.',
     'attachment': {**attach('body', 'crown', [0, TOP - 0.03, 0], [0, TOP + 0.03, 0], 'embed', 0.03), 'baseRadius': 0.25, 'endRadius': 0.25}},
    {'id': 'cap-button', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'cap-silver',
     'dims': [0.28, 0.12, 0.28], 'importance': 0.85,
     'topologyRationale': 'Raised plus-terminal button on the cap.',
     'attachment': {**attach('body', 'crown', [0, TOP + 0.02, 0], [0, TOP + 0.14, 0], 'socket', 0.01), 'baseRadius': 0.14, 'endRadius': 0.135}},
    {'id': 'bolt', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'extrude', 'material': 'bolt-white',
     'dims': [0.38, 0.44, 0.04], 'pos': [0.0, -0.06, FRONT - 0.04], 'importance': 0.9,
     'descriptor': {'profile2D': {'points': BOLT_POINTS, 'depth': 1.0}},
     'topologyRationale': 'Raised white lightning bolt: a thin extruded outline on the belly.',
     'localFeatures': [{'id': 'bolt-edge', 'kind': 'bevel', 'description': 'crisp raised edge of the bolt', 'evidenceRef': 'detail-inventory/zone-r2c1.png'}]},
    cable(1, CABLE[0], CABLE[1]),
    cable(2, CABLE[1], CABLE[2]),
    cable(3, CABLE[2], CABLE[3]),
    {'id': 'plug', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'box', 'material': 'violet-plastic',
     'dims': [0.16, 0.18, 0.13], 'pos': [0.67, 0.07, -0.05], 'rot': [0.0, 0.0, -0.5], 'importance': 0.85,
     'topologyRationale': 'Plug body at the end of the cable.'},
    {'id': 'prong-a', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'cap-silver',
     'dims': [0.03, 0.1, 0.03], 'importance': 0.6, 'topologyRationale': 'Silver plug prong.',
     'attachment': {**attach('body', 'plug-top', [0.687, 0.163, -0.05], [0.735, 0.251, -0.05], 'embed', 0.02), 'baseRadius': 0.016, 'endRadius': 0.016}},
    {'id': 'prong-b', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'cylinder', 'material': 'cap-silver',
     'dims': [0.03, 0.1, 0.03], 'importance': 0.6, 'topologyRationale': 'Silver plug prong.',
     'attachment': {**attach('body', 'plug-top', [0.739, 0.135, -0.05], [0.787, 0.223, -0.05], 'embed', 0.02), 'baseRadius': 0.016, 'endRadius': 0.016}},
]

MATERIALS = [
    {'id': 'cap-silver', 'color': '#D5D9DE', 'roughness': 0.2, 'evidence': 'zone-r0c1 cap; shiny silver read as light grey gloss, since the toon game shader has no environment map'},
    {'id': 'bolt-white', 'color': '#F4F0E6', 'roughness': 0.25, 'evidence': 'zone-r2c1 bolt'},
    {'id': 'cable-cream', 'color': '#F1E6CF', 'roughness': 0.3, 'evidence': 'zone-r2c2 cable'},
]

DETAILS = [
    {'id': 'battery-cap', 'kind': 'contour', 'description': 'silver plus-terminal cap on the flat top', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'cap-button'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.85},
    {'id': 'lightning-bolt', 'kind': 'decal', 'description': 'white lightning bolt on the belly', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'bolt'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
    {'id': 'plug-tail', 'kind': 'contour', 'description': 'cream cable curling out to a purple plug with two prongs', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'plug'}, 'evidenceRef': 'detail-inventory/zone-r1c2.png', 'confidence': 0.85},
    {'id': 'wrapper-band', 'kind': 'decal', 'description': 'purple band round the lower quarter of the body', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'body/band-seam'}, 'evidenceRef': 'detail-inventory/zone-r2c0.png', 'confidence': 0.85},
]

MODEL = build_hero_model(
    name='Volt',
    body_color='#FFE45C',
    body_evidence='albedo-samples.json body flank median; prompt palette #FFE45C',
    paint_regions=[{'id': 'wrapper-band', 'kind': 'ellipsoid', 'color': '#4A2F78', 'softness': 0.01,
                    'center': [0.0, -0.75, 0.0], 'radii': [1.2, 0.46, 1.2]}],
    body_features=[{'id': 'band-seam', 'kind': 'seam', 'description': 'flush colour boundary of the purple wrapper band', 'evidenceRef': 'detail-inventory/zone-r2c0.png'}],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'volt-battery', 'name': 'Battery body, silver cap, lightning bolt and plug tail', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['body', 'cap-button', 'bolt', 'plug'], 'evidenceRefs': ['full-object']},
    palette_name='Yellow body, purple band, silver cap, white bolt, cream cable, violet plug and feet',
    silhouette_shape='upright rounded cylinder with a terminal cap, two side mitts, two feet, and a cable-and-plug tail on the left',
    assumptions=['Cable leaves the lower back behind the hanging mitt.', 'Cap is round all the way around.'],
)

# The shared base is an egg; Volt is a battery. Swap the body profile and size, then move the
# eyes onto the flatter, narrower front and the mitts in against the narrower sides.
for _p in MODEL['parts']:
    if _p['id'] == 'body':
        _p['dims'] = [BODY_W, BODY_H, 0.66]
        _p['pos'] = [0, 0.175 + BODY_H / 2, 0]
        _p['pivot'] = [0, -BODY_H / 2, 0]
        _p['descriptor']['latheProfile'] = {'points': BATTERY_PROFILE, 'segments': 48}
        _p['topologyRationale'] = 'Head and torso are one upright battery: a lathe profile with soft shoulders and a flat top.'
    elif _p['id'] in ('eye-l', 'eye-r'):
        side = 1 if _p['id'] == 'eye-l' else -1
        _p['dims'] = [0.31, 0.35, 0.1]
        _p['pos'] = [0.155 * side, 0.3, FRONT + 0.01]
        _p['rot'] = [-0.05, 0.42 * side, 0.0]
    elif _p['id'] in ('hand-l', 'hand-r'):
        side = 1 if _p['id'] == 'hand-l' else -1
        _p['pos'] = [0.42 * side, -0.24, 0.04]
MODEL['silhouette']['aspectRatios'] = [{'name': 'body height:width', 'value': 1.76}]
MODEL['silhouette']['dominantCurves'] = ['straight battery sides', 'soft top shoulders']
MODEL['passGoals']['blockout'] = ('Match the battery body, mitt and foot placement, and the cap and plug silhouette.',
                                  ['Body reads as an upright rounded cylinder ~1.76x taller than wide', 'Feet peek out under the body', 'Cap and plug match the reference'])
