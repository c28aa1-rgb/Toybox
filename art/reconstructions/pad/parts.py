"""Bounce Pad. Front view traced in the 500 px preview; heights read from the front edge; origin at the base."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import HALF_PI, FrontFrame, lathe_y, material, ring_xy  # noqa: E402
from util_model import build_util_model, detail  # noqa: E402

F = FrontFrame(0.42 / 430, 250, 450)


def star(pid, cy_px, outer_px, inner_px, thickness, mat):
    """Five-point star lying flat on the mat, points toward the front."""
    pts = []
    for i in range(10):
        a = HALF_PI + i * math.pi / 5
        r = F.m(outer_px if i % 2 == 0 else inner_px)
        pts.append([round(math.cos(a) * r, 4), round(math.sin(a) * r, 4)])
    w = 2 * F.m(outer_px)
    return {
        'id': pid, 'level': 'meso', 'role': 'detail', 'parent': 'root', 'primitive': 'extrude', 'material': mat,
        'dims': [w, w, thickness], 'scale': [1, 1, 1], 'pos': [0, F.y(cy_px), 0], 'rot': [-HALF_PI, 0, 0],
        'descriptor': {'profile2D': {'points': pts, 'depth': thickness}},
        'topologyRationale': 'Flat star decal raised a little off the mat: an extruded outline laid flat.', 'importance': 0.8,
    }


PARTS = [
    lathe_y(F, 'base', [(0, 450), (138, 447), (145, 432), (138, 412), (0, 410)], 'white', importance=1.0),
    lathe_y(F, 'spring-core', [(0, 412), (40, 412), (40, 298), (0, 298)], 'grape-dark', level='meso', importance=0.5),
    *[ring_xy(F, f'coil-{i}', 250, y, 84, 58, 0.03, 'grape', horizontal=True, level='meso', importance=0.75)
      for i, y in enumerate([395, 366, 337, 310])],
    lathe_y(F, 'mat', [(0, 296), (170, 296), (176, 282), (168, 262), (0, 258)], 'sky', level='meso', importance=0.9),
    ring_xy(F, 'rim', 250, 276, 200, 160, 0.045, 'yellow', horizontal=True, level='meso', importance=0.9),
    star('star', 256, 95, 40, 0.006, 'white'),
]

MATERIALS = [
    material('white', '#F3EEEA', 'zone-r2c1 base, zone-r0c1 star'),
    material('grape', '#6A2FA0', 'zone-r2c1 spring coils'),
    material('grape-dark', '#4A2370', 'zone-r2c1 spring core'),
    material('sky', '#4FB3FF', 'zone-r1c1 mat'),
    material('yellow', '#FFD84A', 'zone-r1c0 rim'),
]

DETAILS = [
    detail('mat', 'contour', 'round sky-blue bouncy mat', 'mat', 'zone-r1c1', 'macro', 'silhouette'),
    detail('star', 'decal', 'white star on the mat', 'star', 'zone-r0c1', 'meso'),
    detail('rim', 'contour', 'thick yellow rim round the mat', 'rim', 'zone-r1c0', 'meso', 'silhouette'),
    detail('spring', 'contour', 'fat violet coil spring', 'coil-1', 'zone-r2c1', 'meso', 'silhouette'),
    detail('base', 'contour', 'flat white base disc', 'base', 'zone-r2c1', 'meso'),
    detail('rim-seams', 'seam', 'segment seams on the rim', 'rim', 'zone-r1c2'),
    detail('gloss', 'gloss', 'glossy moulded plastic', 'sky', 'zone-r1c1', affects='material'),
]

MODEL = build_util_model(
    name='Bounce Pad', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'pad-signature', 'name': 'Star mat on a yellow rim over a violet spring', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['mat', 'rim', 'coil-1'], 'evidenceRefs': ['full-object']},
    palette='Sky-blue mat, yellow rim, violet spring, white base and star', height_m=0.2,
    blockout_ids=['base', 'mat', 'rim', 'coil-1', 'spring-core'],
)
