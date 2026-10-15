"""Goo Bomb. Front view traced in the 500 px preview; 0.28 m tall; origin at the base."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import FrontFrame, lathe_y, material, ring_xy, slab_xy  # noqa: E402
from util_model import build_util_model, detail  # noqa: E402

CONE = [[0.5, -0.5], [0.44, -0.2], [0.3, 0.12], [0.14, 0.38], [0.0, 0.5]]


def around(pid, f, n, radius_px, y_px, w_px, h_px, mat, profile=CONE, phase=0.0, level='micro', importance=0.4):
    """n small lathe pieces spaced evenly around the vertical axis."""
    import math
    out = []
    for i in range(n):
        a = phase + i * 2 * math.pi / n
        out.append({
            'id': f'{pid}-{i}', 'level': level, 'role': 'detail', 'parent': 'root', 'primitive': 'lathe', 'material': mat,
            'dims': [f.m(w_px), f.m(h_px), f.m(w_px)],
            'pos': [round(math.sin(a) * f.m(radius_px), 4), f.y(y_px), round(math.cos(a) * f.m(radius_px), 4)],
            'descriptor': {'latheProfile': {'points': profile, 'segments': 12}},
            'topologyRationale': 'One of a ring of identical moulded pieces spaced around the axis.', 'importance': importance,
        })
    return out

F = FrontFrame(0.28 / 282, 240, 332)


def drips(f, spec):
    """Goo drips: long rounded blobs hugging the jar wall, hanging from the collar."""
    import math
    out = []
    for i, (a, bottom_px, len_px) in enumerate(spec):
        r = f.m(116)
        top = 196
        out.append({
            'id': f'drip-{i}', 'level': 'meso', 'role': 'detail', 'parent': 'root', 'primitive': 'ellipsoid', 'material': 'goo',
            'dims': [f.m(30), f.m(bottom_px - top + 20), f.m(20)],
            'pos': [round(math.sin(a) * r, 4), f.y((top + bottom_px) / 2), round(math.cos(a) * r, 4)],
            'rot': [0, round(a, 4), 0],
            'topologyRationale': 'Drip of goo hanging from the collar, flattened against the jar wall.', 'importance': 0.55,
        })
    return out

PARTS = [
    lathe_y(F, 'body', [(0, 332), (80, 330), (105, 318), (119, 290), (122, 250), (118, 210), (108, 175), (95, 158), (0, 156)], 'lime', importance=1.0),
    lathe_y(F, 'lid', [(0, 158), (96, 158), (96, 106), (88, 97), (0, 96)], 'grape', level='meso', importance=0.8),
    lathe_y(F, 'goo-collar', [(0, 205), (121, 203), (125, 185), (117, 166), (100, 156), (0, 155)], 'goo', level='meso', importance=0.75),
    *drips(F, [(0.0, 245, 75), (0.75, 228, 55), (1.45, 238, 65), (2.2, 222, 45), (2.95, 240, 70), (3.7, 226, 50), (4.4, 236, 60), (5.2, 224, 48)]),
    *around('lid-ridge', F, 12, 94, 128, 22, 54, 'grape', profile=[[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], level='micro', importance=0.35),
    slab_xy(F, 'spout', [(222, 95), (222, 60), (230, 52), (258, 52), (266, 60), (266, 95)], 0.05, 'yellow', importance=0.7),
    slab_xy(F, 'spout-bar', [(258, 58), (312, 62), (318, 78), (262, 82)], 0.03, 'yellow', level='micro', importance=0.5),
    ring_xy(F, 'ring-pull', 350, 85, 50, 38, 0.02, 'yellow', importance=0.8),
]

MATERIALS = [
    material('lime', '#9BE35E', 'zone-r2c1 jar'),
    material('grape', '#6A2FA0', 'zone-r0c1 lid'),
    material('goo', '#6FD046', 'zone-r1c1 drips'),
    material('yellow', '#FFE45C', 'zone-r0c2 ring pull'),
]

DETAILS = [
    detail('round-jar', 'contour', 'squat round lime jar', 'body', 'zone-r2c1', 'macro', 'silhouette'),
    detail('drips', 'contour', 'goo drips running down from the rim', 'drip-0', 'zone-r1c1', 'meso', 'silhouette'),
    detail('lid-ridges', 'groove', 'ridged violet screw lid', 'lid-ridge-0', 'zone-r0c1'),
    detail('spout', 'contour', 'yellow spout on the lid', 'spout', 'zone-r0c1'),
    detail('ring-pull', 'contour', 'yellow ring pull', 'ring-pull', 'zone-r0c2', 'meso'),
    detail('collar', 'seam', 'goo collar where the lid meets the jar', 'goo-collar', 'zone-r1c1'),
    detail('gloss', 'gloss', 'glossy moulded plastic', 'lime', 'zone-r2c1', affects='material'),
]

MODEL = build_util_model(
    name='Goo Bomb', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'goo-signature', 'name': 'Drippy jar with ridged lid and ring pull', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['body', 'goo-collar', 'lid'], 'evidenceRefs': ['full-object']},
    palette='Lime jar, darker goo, violet lid, yellow ring', height_m=0.28, blockout_ids=['body', 'lid', 'goo-collar', 'spout', 'ring-pull'],
)
