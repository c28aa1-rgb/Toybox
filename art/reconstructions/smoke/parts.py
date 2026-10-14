"""Puff Can (smoke). Front view traced in the 500 px preview (panel offsets removed); 0.36 m tall; origin at the base."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import FrontFrame, dot, lathe_y, material, ring_xy  # noqa: E402
from util_model import build_util_model, detail  # noqa: E402

F = FrontFrame(0.36 / 455, 250, 470)
BODY = [(0, 470), (80, 468), (98, 455), (101, 420), (101, 200), (96, 186), (0, 184)]

PARTS = [
    lathe_y(F, 'body', BODY, 'lavender', importance=1.0),
    lathe_y(F, 'band', [(0, 347), (104, 347), (105, 300), (104, 262), (0, 262)], 'grape', level='meso'),
    lathe_y(F, 'dome', [(0, 188), (88, 188), (86, 160), (70, 128), (40, 114), (0, 110)], 'grape', level='meso'),
    *[dot(F, f'vent-{i}', x, 150, 10, 0.06, 'ink') for i, x in enumerate([205, 250, 295])],
    lathe_y(F, 'loop', [(0, 115), (16, 115), (16, 85), (0, 85)], 'yellow', level='micro', importance=0.4),
    ring_xy(F, 'ring-pull', 250, 48, 52, 34, 0.022, 'yellow', importance=0.8),
]

MATERIALS = [
    material('lavender', '#B48CFF', 'zone-r1c1 can'),
    material('grape', '#7A35B8', 'zone-r1c1 band, zone-r0c1 dome'),
    material('yellow', '#FFE45C', 'zone-r0c1 ring pull'),
    material('ink', '#2B1F45', 'zone-r0c1 vents'),
]

DETAILS = [
    detail('can', 'contour', 'tall lavender can with rounded edges', 'body', 'zone-r1c1', 'macro', 'silhouette'),
    detail('band', 'ridge', 'wide violet band round the middle', 'band', 'zone-r1c1', 'meso'),
    detail('dome', 'contour', 'violet domed top', 'dome', 'zone-r0c1', 'meso'),
    detail('vents', 'hole', 'three round vent holes in the dome', 'vent-1', 'zone-r0c1'),
    detail('ring-pull', 'contour', 'yellow ring pull on a loop', 'ring-pull', 'zone-r0c1', 'meso'),
    detail('loop', 'fastener', 'short yellow loop holding the ring', 'loop', 'zone-r0c1'),
    detail('gloss', 'gloss', 'glossy moulded plastic', 'lavender', 'zone-r1c1', affects='material'),
]

MODEL = build_util_model(
    name='Puff Can', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'smoke-signature', 'name': 'Banded lavender can with vented dome and ring pull', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['body', 'band', 'dome'], 'evidenceRefs': ['full-object']},
    palette='Lavender can, violet band and dome, yellow ring', height_m=0.36, blockout_ids=['body', 'band', 'dome', 'ring-pull'],
)
