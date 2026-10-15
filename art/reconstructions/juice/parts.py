"""Juice Box (instant heal). Front view traced in the 500 px preview; 0.3 m tall with the straw; origin at the base."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import FrontFrame, lathe_y, material, rounded_rect, slab_xy  # noqa: E402
from util_model import build_util_model, detail  # noqa: E402

F = FrontFrame(0.3 / 318, 248, 340)
DEPTH = 0.15
TUBE = [[0.0, -0.5], [0.5, -0.5], [0.5, 0.5], [0.0, 0.5]]


def tube(pid, x0, y0, x1, y1, r_px, mat):
    """Straight straw segment between two traced points, as a thin lathe turned onto the segment."""
    ax, ay, bx, by = F.x(x0), F.y(y0), F.x(x1), F.y(y1)
    length = math.hypot(bx - ax, by - ay)
    return {
        'id': pid, 'level': 'meso', 'role': 'detail', 'parent': 'root', 'primitive': 'lathe', 'material': mat,
        'dims': [2 * F.m(r_px), round(length, 4), 2 * F.m(r_px)],
        'pos': [round((ax + bx) / 2, 4), round((ay + by) / 2, 4), -0.02],
        'rot': [0, 0, round(-math.atan2(bx - ax, by - ay), 4)],
        'descriptor': {'latheProfile': {'points': TUBE, 'segments': 12}},
        'topologyRationale': 'Straw segment: a thin tube between two traced points.', 'importance': 0.7,
    }


CROSS = [(197, 173), (237, 173), (237, 205), (265, 205), (265, 245), (237, 245), (237, 277), (197, 277),
         (197, 245), (168, 245), (168, 205), (197, 205)]

PARTS = [
    slab_xy(F, 'carton', rounded_rect(150, 125, 348, 292, 16), DEPTH, 'coral', level='macro', importance=1.0),
    slab_xy(F, 'base-band', rounded_rect(147, 282, 350, 340, 18), DEPTH + 0.012, 'grape', importance=0.8),
    slab_xy(F, 'gable', [(152, 130), (158, 92), (178, 80), (320, 82), (340, 100), (348, 136)], DEPTH - 0.03, 'yellow', importance=0.85),
    slab_xy(F, 'cross', CROSS, 0.03, 'white', z=DEPTH / 2 + 0.006, importance=0.9),
    lathe_y(F, 'spout', [(0, 102), (20, 102), (19, 92), (0, 90)], 'yellow', level='micro', importance=0.4),
    tube('straw-low', 276, 96, 282, 52, 10, 'white'),
    tube('straw-bend', 282, 54, 296, 40, 11, 'white'),
    tube('straw-top', 294, 42, 338, 28, 10, 'white'),
]

MATERIALS = [
    material('coral', '#FF5F6D', 'zone-r1c1 carton'),
    material('grape', '#6A2FA0', 'zone-r2c1 base band'),
    material('yellow', '#FFD84A', 'zone-r0c1 gable top'),
    material('white', '#F6F1EC', 'zone-r1c1 cross, zone-r0c2 straw'),
]

DETAILS = [
    detail('carton', 'contour', 'rounded coral carton body', 'carton', 'zone-r1c1', 'macro', 'silhouette'),
    detail('cross', 'contour', 'raised white cross on the front', 'cross', 'zone-r1c1', 'meso'),
    detail('gable', 'contour', 'yellow gable top', 'gable', 'zone-r0c1', 'meso', 'silhouette'),
    detail('base-band', 'seam', 'violet band round the bottom', 'base-band', 'zone-r2c1'),
    detail('straw', 'contour', 'bendy white straw', 'straw-top', 'zone-r0c2', 'meso', 'silhouette'),
    detail('spout', 'fastener', 'small yellow spout ring under the straw', 'spout', 'zone-r0c2'),
    detail('gloss', 'gloss', 'glossy moulded plastic', 'coral', 'zone-r1c1', affects='material'),
]

MODEL = build_util_model(
    name='Juice Box', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'juice-signature', 'name': 'Coral carton with a white cross and bendy straw', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['carton', 'cross', 'straw-top'], 'evidenceRefs': ['full-object']},
    palette='Coral carton, yellow top, violet base, white cross and straw', height_m=0.3,
    blockout_ids=['carton', 'base-band', 'gable', 'cross', 'straw-low'],
)
