"""Tock (chrono hero): mint egg with a clock face on the belly and an alarm bell on top."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_base import attach, build_hero_model  # noqa: E402

FACE_Y = -0.2   # body-local height of the clock centre (0.66 of body height from the crown)
FACE_Z = 0.36

PARTS = [
    # Clock face: a short disc facing +Z, built as an attachment cylinder from inside the body outward.
    {'id': 'clock-face', 'level': 'meso', 'role': 'support', 'parent': 'body', 'primitive': 'cylinder', 'material': 'eye-white',
     'dims': [0.5, 0.08, 0.5], 'importance': 0.95,
     'topologyRationale': 'Flat clock dial: a short cylinder whose axis points forward out of the belly.',
     'attachment': {**attach('body', 'belly', [0, FACE_Y, FACE_Z - 0.06], [0, FACE_Y, FACE_Z + 0.05], 'embed', 0.06), 'baseRadius': 0.25, 'endRadius': 0.25}},
    {'id': 'clock-rim', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'torus', 'material': 'gem-yellow',
     'dims': [0.6, 0.6, 0.12], 'pos': [0, FACE_Y, FACE_Z + 0.06], 'importance': 0.85,
     'descriptor': {'torusTubeRatio': 0.1},
     'topologyRationale': 'Yellow bezel ring around the dial; torus faces +Z by default.'},
    {'id': 'dial-hub', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'sphere', 'material': 'violet-plastic',
     'dims': [0.06, 0.06, 0.04], 'pos': [0, FACE_Y, FACE_Z + 0.1], 'importance': 0.6},
    {'id': 'dial-hour', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'box', 'material': 'violet-plastic',
     'dims': [0.035, 0.15, 0.02], 'pos': [0.0, FACE_Y + 0.075, FACE_Z + 0.105], 'importance': 0.7},
    {'id': 'dial-minute', 'level': 'micro', 'role': 'detail', 'parent': 'body', 'primitive': 'box', 'material': 'violet-plastic',
     'dims': [0.035, 0.13, 0.02], 'pos': [0.05, FACE_Y - 0.035, FACE_Z + 0.105], 'rot': [0, 0, 1.0], 'importance': 0.7},
    # Alarm bell on a short stem, tilted toward character-left.
    {'id': 'bell-stem', 'level': 'meso', 'role': 'support', 'parent': 'body', 'primitive': 'cylinder', 'material': 'gem-yellow',
     'dims': [0.08, 0.16, 0.08], 'importance': 0.7, 'animationRole': 'wobble', 'pivotMode': 'base',
     'topologyRationale': 'Bell stem, built as an attachment cylinder from the crown.',
     'attachment': {**attach('body', 'crown', [0, 0.6, 0], [0.04, 0.76, 0.0], 'socket', 0.025), 'baseRadius': 0.045, 'endRadius': 0.04}},
    {'id': 'bell', 'level': 'meso', 'role': 'ornament', 'parent': 'bell-stem', 'primitive': 'lathe', 'material': 'gem-yellow',
     'dims': [0.44, 0.24, 0.44], 'pos': [0.05, 0.2, 0.0], 'rot': [0, 0, -0.2], 'importance': 0.9,
     'descriptor': {'latheProfile': {'points': [[0.44, -0.5], [0.5, -0.5], [0.5, -0.2], [0.47, 0.1], [0.38, 0.32], [0.22, 0.46], [0.0, 0.5]], 'segments': 28}},
     'topologyClass': 'open-shell', 'topologyRationale': 'Dome bell open underneath: a lathe shell.',
     'localFeatures': [{'id': 'bell-lip', 'kind': 'bevel', 'description': 'rounded lip at the open rim of the bell', 'evidenceRef': 'detail-inventory/zone-r0c1.png'}]},
    {'id': 'bell-knob', 'level': 'micro', 'role': 'detail', 'parent': 'bell', 'primitive': 'sphere', 'material': 'gem-yellow',
     'dims': [0.11, 0.11, 0.11], 'pos': [0, 0.15, 0], 'importance': 0.6},
]

MATERIALS = [
    {'id': 'gem-yellow', 'color': '#FFE45C', 'roughness': 0.25, 'doubleSided': True, 'evidence': 'zone-r0c1 bell, zone-r2c1 bezel'},
]

DETAILS = [
    {'id': 'clock-dial', 'kind': 'decal', 'description': 'white dial with violet hands on the belly', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'clock-face'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
    {'id': 'clock-bezel', 'kind': 'ridge', 'description': 'yellow bezel ring around the dial', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'clock-rim'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.85},
    {'id': 'clock-hands', 'kind': 'linework', 'description': 'hour hand up, minute hand to ~4 o clock, hub at centre', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'dial-hour'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.8},
    {'id': 'alarm-bell', 'kind': 'contour', 'description': 'yellow dome bell with knob on a short stem', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'bell'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.8},
]

MODEL = build_hero_model(
    name='Tock',
    body_color='#3DDBB4',
    body_evidence='albedo-samples.json body flank median; prompt palette #3DDBB4',
    paint_regions=[],
    body_features=[{'id': 'dial-socket', 'kind': 'groove', 'description': 'the dial sits into the belly', 'evidenceRef': 'detail-inventory/zone-r2c1.png'}],
    accessory_parts=PARTS,
    accessory_materials=MATERIALS,
    accessory_details=DETAILS,
    signature_target={'id': 'clock-and-bell', 'name': 'Belly clock face and alarm bell', 'tier': 'critical',
                      'passIds': ['blockout', 'feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
                      'componentRefs': ['clock-face', 'clock-rim', 'bell'], 'evidenceRefs': ['full-object']},
    palette_name='Mint body, white dial with yellow bezel, yellow bell, violet hands and feet',
    silhouette_shape='egg with a round dial on the belly, two side mitts, two feet, and a dome bell on a stem',
    assumptions=['Bell is open underneath.', 'Clock hands are flat bars.'],
)
