"""Shared base for the five hero toys.

All five concepts came from one ChatGPT style sheet: same egg body, eyes, mitts and feet, with a
different colour and accessory. Flicker (blink) was reconstructed first and its base parts passed
blockout through feature-placement; every other hero starts from those validated parts and adds
its own accessories, then goes through the same gated passes against its own reference.

Coordinates: metres, +Y up, +Z forward, character-left = +X, parent-relative.
"""
from __future__ import annotations

import copy
import math
from typing import Any

from spec_builder import attach  # noqa: F401  (re-exported for hero parts files)

BODY_H, BODY_W, BODY_D = 1.25, 0.94, 0.80
BODY_Y = 0.80  # body centre height; spans 0.175 .. 1.425
CROWN_Y = BODY_H / 2  # body-local crown height


def egg_profile(n: int = 48, widest: float = -0.12, taper: float = 0.05) -> list[list[float]]:
    """Egg outline [radius, y] in unit space: fuller superellipse below the widest point,
    rounder and slightly tapered above it."""
    pts = []
    for i in range(n + 1):
        y = -0.5 + i / n
        if y <= widest:
            t = (widest - y) / (widest + 0.5)
        else:
            t = (y - widest) / (0.5 - widest)
        r = (1 - t ** 2.6) ** (1 / 2.6)
        if y > widest:
            r *= 1 - taper * t
        pts.append([round(0.5 * max(r, 0.0), 4), round(y, 4)])
    pts[0][0] = 0.0
    pts[-1][0] = 0.0
    return pts


def body_half_extent(y_local: float) -> tuple[float, float]:
    """Half width and half depth of the body surface at a body-local height (metres)."""
    prof = egg_profile()
    u = y_local / BODY_H
    for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
        if y0 <= u <= y1:
            r = r0 + (r1 - r0) * (u - y0) / (y1 - y0 or 1)
            return r * BODY_W, r * BODY_D
    return 0.0, 0.0


def mirror(p: dict[str, Any]) -> dict[str, Any]:
    q = copy.deepcopy(p)
    q['pos'] = [-p['pos'][0], p['pos'][1], p['pos'][2]]
    if 'rot' in p:
        q['rot'] = [p['rot'][0], -p['rot'][1], -p['rot'][2]]
    return q


SHARED_MATERIALS = [
    {'id': 'hidden', 'color': '#000000', 'roughness': 1.0, 'materialClass': 'unknown', 'finish': 'none'},
    {'id': 'eye-white', 'color': '#F6F4EE', 'roughness': 0.2, 'evidence': 'zone-r1c1 sclera'},
    {'id': 'pupil-ink', 'color': '#1E1414', 'roughness': 0.15, 'evidence': 'zone-r1c1 pupils'},
    {'id': 'catchlight', 'color': '#FFFFFF', 'roughness': 0.1, 'emissive': '#FFFFFF', 'emissiveIntensity': 0.8, 'evidence': 'zone-r1c1 pupil highlights'},
    {'id': 'violet-plastic', 'color': '#4A2F78', 'roughness': 0.3, 'evidence': 'zone-r2c0 / r2c2 feet'},
]

LIGHTING = [
    {'id': 'key', 'type': 'area/soft box', 'direction': 'upper front-left of the figure', 'evidence': 'large soft speculars on crown, mitts and feet face upper-left', 'intensity': 'high'},
    {'id': 'fill', 'type': 'soft fill', 'direction': 'front-right', 'evidence': 'shadow side of body stays mid-value, never black', 'intensity': 'medium'},
    {'id': 'rim', 'type': 'faint rim', 'direction': 'behind right', 'evidence': 'slight edge lift on the right silhouette', 'intensity': 'low'},
    {'id': 'environment', 'type': 'neutral grey studio sweep', 'evidence': 'background ~#C9C9C9 with no horizon', 'notes': 'Review renders use ACES filmic tone mapping at exposure 1.0; the game uses a 3-step toon ramp, so tone mapping is review-only.'},
    {'id': 'ground', 'type': 'contact shadow', 'evidence': 'soft ground contact shadow under the feet', 'notes': 'Game uses a directional shadow map plus ambient occlusion contact darkening.'},
]

PASS_ORDER = ['blockout', 'structural-pass', 'proportion-lock', 'feature-placement', 'material-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass']


def base_parts(body_paint: dict[str, Any] | None, body_features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    eye_l = {'id': 'eye-l', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'ellipsoid',
             'dims': [0.29, 0.32, 0.09], 'pos': [0.15, 0.23, 0.35], 'rot': [-0.12, 0.38, 0.0],
             'material': 'eye-white', 'importance': 0.95}
    pupil_l = {'id': 'pupil-l', 'level': 'micro', 'role': 'detail', 'parent': 'eye-l', 'primitive': 'ellipsoid',
               'dims': [0.13, 0.15, 0.04], 'pos': [-0.03, 0.015, 0.035], 'material': 'pupil-ink', 'importance': 0.9}
    catch_l = {'id': 'catchlight-l', 'level': 'micro', 'role': 'detail', 'parent': 'pupil-l', 'primitive': 'sphere',
               'dims': [0.032, 0.032, 0.012], 'pos': [0.02, 0.03, 0.016], 'material': 'catchlight', 'importance': 0.5}
    foot_l = {'id': 'foot-l', 'level': 'macro', 'role': 'foot', 'parent': 'root', 'primitive': 'ellipsoid',
              'dims': [0.34, 0.21, 0.42], 'pos': [0.25, 0.1, 0.1], 'material': 'violet-plastic', 'importance': 0.8,
              'animationRole': 'step', 'pivotMode': 'top', 'pivot': [0, 0.1, 0]}
    hand_l = {'id': 'hand-l', 'level': 'macro', 'role': 'hand', 'parent': 'body', 'primitive': 'ellipsoid',
              'dims': [0.32, 0.38, 0.32], 'pos': [0.52, -0.22, 0.04], 'rot': [0.0, 0.0, 0.25],
              'material': 'body-plastic', 'importance': 0.75, 'animationRole': 'sway', 'pivotMode': 'top', 'pivot': [0, 0.13, 0]}
    hand_r = {**mirror(hand_l), 'id': 'hand-r', 'animationRole': 'aim', 'importance': 0.8,
              'sockets': [{'id': 'gun', 'localPosition': [-0.02, -0.02, 0.12], 'localRotation': [0, 0, 0], 'purpose': 'weapon grip'}]}
    body = {'id': 'body', 'level': 'macro', 'role': 'body', 'parent': 'root', 'primitive': 'lathe',
            'dims': [BODY_W, BODY_H, BODY_D], 'pos': [0, BODY_Y, 0], 'material': 'body-plastic', 'importance': 1.0,
            'topologyClass': 'continuous-sculpt',
            'topologyRationale': 'Head and torso are one continuous egg volume; a lathe profile gives the bottom-heavy taper an ellipsoid cannot.',
            'descriptor': {'latheProfile': {'points': egg_profile(), 'segments': 56}},
            'localFeatures': body_features,
            'animationRole': 'squash', 'pivotMode': 'bottom', 'pivot': [0, -BODY_H / 2, 0]}
    if body_paint:
        body['vertexPaint'] = body_paint
    return [
        {'id': 'root', 'level': 'macro', 'role': 'root', 'parent': None, 'primitive': 'box', 'dims': [0.01, 0.01, 0.01],
         'material': 'hidden', 'importance': 0.1, 'animationRole': 'root-motion', 'topologyRationale': 'Invisible pivot for whole-figure motion.'},
        body,
        eye_l, {**mirror(eye_l), 'id': 'eye-r'},
        pupil_l, {**mirror(pupil_l), 'id': 'pupil-r', 'parent': 'eye-r'},
        catch_l, {**mirror(catch_l), 'id': 'catchlight-r', 'parent': 'pupil-r'},
        hand_l, hand_r,
        foot_l, {**mirror(foot_l), 'id': 'foot-r'},
    ]


def belly_region(center_y: float = -0.27, radii=(0.3, 0.33, 0.25)) -> dict[str, Any]:
    return {'id': 'belly', 'kind': 'ellipsoid', 'color': '#F3E6CC', 'softness': 0.02,
            'center': [0.0, center_y, 0.4], 'radii': list(radii)}


BASE_DETAILS = [
    {'id': 'eye-sclera', 'kind': 'decal', 'description': 'two large off-white discs proud of the body', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'eye-l'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.9},
    {'id': 'pupils', 'kind': 'decal', 'description': 'near-black pupils offset inward', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'pupil-l'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.9},
    {'id': 'catchlights', 'kind': 'gloss', 'description': 'white catchlight dot on each pupil', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'catchlight-l'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.8},
    {'id': 'violet-feet', 'kind': 'contour', 'description': 'two flattened violet feet under the body', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'foot-l'}, 'evidenceRef': 'detail-inventory/zone-r2c0.png', 'confidence': 0.85},
    {'id': 'gloss-finish', 'kind': 'gloss', 'description': 'low-roughness moulded plastic everywhere', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'body-plastic'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
]


def build_hero_model(
    *,
    name: str,
    body_color: str,
    body_evidence: str,
    paint_regions: list[dict[str, Any]],
    body_features: list[dict[str, Any]],
    accessory_parts: list[dict[str, Any]],
    accessory_materials: list[dict[str, Any]],
    accessory_details: list[dict[str, Any]],
    signature_target: dict[str, Any],
    palette_name: str,
    silhouette_shape: str,
    assumptions: list[str],
) -> dict[str, Any]:
    paint = {'baseColor': body_color, 'regions': paint_regions} if paint_regions else None
    parts = base_parts(paint, body_features) + accessory_parts
    base_ids = ['root', 'body', 'hand-l', 'hand-r', 'foot-l', 'foot-r']
    macro_acc = [p['id'] for p in accessory_parts if p.get('blockout', True)]
    materials = [
        SHARED_MATERIALS[0],
        {'id': 'body-plastic', 'color': body_color, 'roughness': 0.25, 'evidence': body_evidence,
         'localOverrides': [
             {'id': 'mitt-contact-ao', 'region': 'body surface under and behind each mitt', 'albedoMultiplier': 0.82, 'roughness': 0.3,
              'evidenceRef': 'detail-inventory/zone-r1c0.png', 'notes': 'soft contact darkening where the mitt overlaps the body'},
             {'id': 'base-contact-ao', 'region': 'lowest 6% of the body where it sits on the feet', 'albedoMultiplier': 0.85,
              'evidenceRef': 'detail-inventory/zone-r2c1.png', 'notes': 'contact shadow band at the body base'},
         ]},
        *SHARED_MATERIALS[1:],
        *accessory_materials,
    ]
    for p in parts:
        p.pop('blockout', None)
    return {
        'details': BASE_DETAILS + accessory_details,
        'lightingFromPhoto': LIGHTING,
        'unknowns': [],
        'passOrder': PASS_ORDER,
        'materials': materials,
        'parts': parts,
        'passComponents': {
            'blockout': base_ids + macro_acc,
            'structural-pass': base_ids + macro_acc,
            'proportion-lock': base_ids + macro_acc,
        },
        'passGoals': {
            'blockout': ('Match the egg body, mitt and foot placement, and the accessory silhouette.',
                         ['Body reads as a bottom-heavy egg ~1.33x taller than wide', 'Feet peek out under the body', f'{name} accessory silhouette matches the reference']),
            'structural-pass': ('Lock the part hierarchy, pivots, sockets and attachments.',
                                ['Every part is a named pivot group; gun socket on the forward mitt']),
            'proportion-lock': ('Lock body, colour-region and accessory proportions.',
                                ['Painted regions and accessories sit at the measured heights']),
            'feature-placement': ('Place eyes, pupils, catchlights and small accessory details.',
                                  ['Eye centres at 0.317 of body height from crown, spacing 0.33 of body width']),
        },
        'featureReviewTargets': [
            {'id': 'anatomy-proportion', 'name': 'Egg body, feet and mitt proportions', 'tier': 'critical',
             'passIds': ['blockout', 'proportion-lock'], 'minimumScore': 0.78, 'mustPass': True,
             'componentRefs': ['body', 'foot-l', 'foot-r', 'hand-l', 'hand-r'], 'evidenceRefs': ['full-object']},
            {'id': 'face-landmark-placement', 'name': 'Eyes, pupils, catchlights', 'tier': 'critical',
             'passIds': ['feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
             'componentRefs': ['eye-l', 'eye-r', 'pupil-l', 'pupil-r'], 'evidenceRefs': ['full-object']},
            signature_target,
            {'id': 'outfit-and-palette', 'name': palette_name, 'tier': 'important',
             'passIds': ['material-pass'], 'minimumScore': 0.7, 'mustPass': False,
             'componentRefs': ['body', 'foot-l'], 'evidenceRefs': ['full-object']},
        ],
        'silhouette': {
            'boundingShape': silhouette_shape,
            'aspectRatios': [{'name': 'body height:width', 'value': 1.33}],
            'symmetry': 'bilateral (accessories may break it)',
            'dominantCurves': ['egg outline'],
            'negativeSpaces': ['gap between feet', 'gap between hanging mitt and body'],
            'landmarks': ['crown', 'eye line 0.317', 'mitt centre 0.62'],
        },
        'coordinateFrame': {'front': '+Z (camera-facing in reference)', 'up': '+Y', 'characterLeft': '+X', 'units': 'meters', 'scaleReference': 'figure height 1.45 m sole to crown'},
        'performanceBudget': {'qualityPriority': 'runtime', 'targetTriangles': 9000, 'maxDrawCalls': 24, 'textureSize': 0, 'fpsTarget': 60,
                              'optimizationPolicy': 'Up to 9 copies on screen; stay in the low tessellation tier.'},
        'assumptions': ['Resolved unknowns (single view): see risks.', 'Back of body is a smooth continuation of the egg.'] + assumptions,
        'risks': ['Single 3/4 view: back of body and accessory depth are inferred (confidence 0.5).'],
        'repetitionSystems': [{'id': 'bilateral-pairs', 'type': 'mirror', 'axis': 'x',
                               'members': ['eye-l/eye-r', 'pupil-l/pupil-r', 'catchlight-l/catchlight-r', 'foot-l/foot-r', 'hand-l/hand-r'],
                               'notes': 'Mirror across the sagittal plane.'}],
        'rig': {'version': '1.0', 'bindPose': 'rest', 'forward': '+Z', 'bones': [], 'posedJoints': {},
                'notes': 'Rigid part animation only (pivot groups); no skinned mesh.'},
    }


HALF_PI = math.pi / 2
