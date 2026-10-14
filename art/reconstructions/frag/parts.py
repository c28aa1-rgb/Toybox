"""Fizz Bomb (frag). Front view traced in the 500 px preview (panel x offset removed); 0.3 m tall; origin at the base."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_base import FrontFrame, lathe_y, material, ring_xy, slab_xy  # noqa: E402
from util_model import build_util_model, detail  # noqa: E402

F = FrontFrame(0.3 / 395, 248, 455)
BODY = [(0, 455), (70, 450), (115, 430), (135, 390), (138, 330), (133, 270), (115, 225), (85, 195), (55, 185), (0, 183)]

PARTS = [
    lathe_y(F, 'body', BODY, 'mint', importance=1.0),
    lathe_y(F, 'neck', [(0, 210), (68, 210), (70, 190), (66, 160), (0, 160)], 'grape', level='meso'),
    lathe_y(F, 'cap', [(0, 160), (48, 160), (46, 110), (40, 70), (0, 68)], 'grape', level='meso'),
    *[ring_xy(F, f'groove-{i}', 248, y, r + 7, r - 7, 0.02, 'mint-dark', horizontal=True, level='micro', importance=0.3)
      for i, (y, r) in enumerate([(285, 134), (335, 138), (390, 135)])],
    ring_xy(F, 'ring-pull', 175, 145, 66, 44, 0.02, 'yellow', importance=0.8),
    slab_xy(F, 'lever', [(275, 75), (330, 62), (372, 110), (410, 250), (396, 350), (376, 350), (376, 250), (346, 140), (300, 112)], 0.05, 'yellow', importance=0.8),
]

MATERIALS = [
    material('mint', '#3DDBB4', 'zone-r1c1 body'),
    material('grape', '#6A2FA0', 'zone-r0c1 cap'),
    material('yellow', '#FFE45C', 'zone-r0c0 ring, zone-r1c2 lever'),
    material('mint-dark', '#2BB896', 'zone-r1c1 grooves'),
]

DETAILS = [
    detail('round-body', 'contour', 'round mint body', 'body', 'zone-r1c1', 'macro', 'silhouette'),
    detail('grooves', 'groove', 'shallow horizontal grooves around the body', 'groove-1', 'zone-r1c1'),
    detail('ring-pull', 'contour', 'yellow ring pull on the cap', 'ring-pull', 'zone-r0c0', 'meso'),
    detail('lever', 'contour', 'curved yellow lever down one side', 'lever', 'zone-r1c2', 'meso', 'silhouette'),
    detail('cap', 'contour', 'violet cap and neck', 'cap', 'zone-r0c1', 'meso'),
    detail('neck-step', 'seam', 'step where the neck meets the body', 'neck', 'zone-r0c1'),
    detail('gloss', 'gloss', 'glossy moulded plastic', 'mint', 'zone-r1c1', affects='material'),
]

MODEL = build_util_model(
    name='Fizz Bomb', parts=PARTS, materials=MATERIALS, details=DETAILS,
    signature={'id': 'grenade-signature', 'name': 'Round grooved body with ring pull and lever', 'tier': 'critical',
               'passIds': ['blockout', 'form-refinement'], 'minimumScore': 0.75, 'mustPass': True,
               'componentRefs': ['body', 'ring-pull', 'lever'], 'evidenceRefs': ['full-object']},
    palette='Mint body, violet cap, yellow ring and lever', height_m=0.3, blockout_ids=['body', 'neck', 'cap', 'lever', 'ring-pull'],
)
