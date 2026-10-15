"""Snap Trap. Built from the slightly-high front view; 0.42 m wide; origin at the base."""
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

# The reference is tilted, so heights are set from the stated 3:1 width-to-height ratio, not traced.
F = FrontFrame(0.42 / 344, 250, 300)

PARTS = [
    lathe_y(F, 'base', [(0, 300), (160, 298), (172, 282), (171, 262), (160, 252), (0, 252)], 'orange', importance=1.0),
    lathe_y(F, 'collar', [(0, 253), (110, 253), (108, 244), (90, 240), (0, 240)], 'orange-light', level='meso', importance=0.6),
    lathe_y(F, 'button', [(0, 241), (62, 241), (60, 228), (44, 219), (0, 216)], 'red', level='meso', importance=0.85),
    *around('tooth', F, 14, 138, 232, 34, 46, 'grape', level='meso', importance=0.7),
]

MATERIALS = [
    material('orange', '#FF8A1F', 'zone-r2c1 base'),
    material('grape', '#6A2FA0', 'zone-r0c1 teeth'),
    material('red', '#FF3B5C', 'zone-r1c1 button'),
    material('orange-light', '#FFA343', 'zone-r1c1 inner collar'),
]

DETAILS = [
    detail('puck', 'contour', 'low wide orange puck', 'base', 'zone-r2c1', 'macro', 'silhouette'),
    detail('teeth', 'contour', 'ring of violet teeth', 'tooth-0', 'zone-r0c1', 'meso', 'silhouette'),
    detail('button', 'contour', 'red domed button', 'button', 'zone-r1c1', 'meso'),
    detail('collar', 'seam', 'raised inner collar around the button', 'collar', 'zone-r1c1'),
    detail('rolled-edge', 'bevel', 'rolled edge on the puck', 'base', 'zone-r2c0'),
    detail('tooth-gap', 'groove', 'gaps between the teeth', 'tooth-1', 'zone-r0c1'),
    detail('gloss', 'gloss', 'glossy moulded plastic', 'orange', 'zone-r2c1', affects='material'),
]

MODEL = build_util_model(
    name='Snap Trap', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'trap-signature', 'name': 'Wide puck ringed with teeth around a red button', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['base', 'tooth-0', 'button'], 'evidenceRefs': ['full-object']},
    palette='Orange puck, violet teeth, red button', height_m=0.12, blockout_ids=['base', 'collar', 'button', 'tooth-0', 'tooth-7'],
)
