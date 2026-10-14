"""Flash Pop (flashbang). Front view traced in the 500 px preview (panel offsets removed); 0.3 m tall; origin at the base."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import FrontFrame, dot, lathe_y, material, ring_xy, slab_xy  # noqa: E402
from util_model import build_util_model, detail  # noqa: E402

F = FrontFrame(0.3 / 405, 250, 465)
BODY = [(0, 465), (105, 462), (122, 445), (125, 300), (120, 222), (100, 210), (0, 208)]

PARTS = [
    lathe_y(F, 'body', BODY, 'yellow', importance=1.0),
    lathe_y(F, 'neck', [(0, 212), (62, 212), (62, 170), (0, 170)], 'grape', level='meso'),
    lathe_y(F, 'cap', [(0, 172), (48, 172), (46, 110), (38, 65), (0, 62)], 'grape', level='meso'),
    *[ring_xy(F, f'band-{i}', 250, y, 129, 112, 0.035, 'white', horizontal=True, level='meso', importance=0.6)
      for i, y in enumerate([290, 345, 400])],
    *[dot(F, f'hole-{i}', x, 245, 9, 0.093 - abs(x - 250) * 0.00012, 'ink') for i, x in enumerate([158, 205, 250, 295, 342])],
    ring_xy(F, 'ring-pull', 170, 140, 64, 44, 0.02, 'yellow-ring', importance=0.8),
    slab_xy(F, 'lever', [(270, 62), (330, 70), (382, 140), (412, 250), (406, 360), (386, 360), (380, 250), (346, 140), (292, 110)], 0.05, 'grape', importance=0.8),
]

MATERIALS = [
    material('yellow', '#FFE45C', 'zone-r1c1 body'),
    material('grape', '#7A35B8', 'zone-r0c1 cap and lever'),
    material('white', '#F6F4EE', 'zone-r1c1 bands'),
    material('yellow-ring', '#FFD233', 'zone-r0c0 ring pull'),
    material('ink', '#2B1F45', 'zone-r1c1 vent holes'),
]

DETAILS = [
    detail('can-body', 'contour', 'short fat yellow can', 'body', 'zone-r1c1', 'macro', 'silhouette'),
    detail('white-bands', 'ridge', 'three white bands around the can', 'band-1', 'zone-r1c1', 'meso'),
    detail('vent-holes', 'hole', 'ring of small vent holes near the top', 'hole-2', 'zone-r1c1'),
    detail('ring-pull', 'contour', 'yellow ring pull', 'ring-pull', 'zone-r0c0', 'meso'),
    detail('lever', 'contour', 'curved violet lever', 'lever', 'zone-r1c2', 'meso', 'silhouette'),
    detail('cap', 'contour', 'violet cap', 'cap', 'zone-r0c1', 'meso'),
    detail('gloss', 'gloss', 'glossy moulded plastic', 'yellow', 'zone-r1c1', affects='material'),
]

MODEL = build_util_model(
    name='Flash Pop', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'flash-signature', 'name': 'Yellow can with white bands, vent holes and violet lever', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['body', 'band-1', 'lever'], 'evidenceRefs': ['full-object']},
    palette='Yellow can, white bands, violet cap and lever', height_m=0.3, blockout_ids=['body', 'neck', 'cap', 'lever', 'ring-pull'],
)
