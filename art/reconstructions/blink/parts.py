"""Flicker (blink hero) part list for spec_builder.py.

Measurements come from anatomy.json / landmarks.png. Figure height F = 1.45 m (sole to crown),
body ovoid 1.25 m tall, 0.94 m wide, 0.80 m deep.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from spec_builder import attach  # noqa: E402

BODY_H, BODY_W, BODY_D = 1.25, 0.94, 0.80
BODY_Y = 0.80  # body centre height; spans 0.175 .. 1.425

def _egg_profile(n=26, widest=-0.12):
    """Egg outline [radius, y] in unit space: fuller superellipse below the widest point,
    rounder and tapered above it, matching the reference crown narrowing to ~0.72 of max width."""
    import math
    pts = []
    for i in range(n + 1):
        y = -0.5 + i / n
        if y <= widest:
            t = (widest - y) / (widest + 0.5)
            r = (1 - t ** 2.6) ** (1 / 2.6)
        else:
            t = (y - widest) / (0.5 - widest)
            r = (1 - t ** 2.6) ** (1 / 2.6) * (1 - 0.05 * t)
        pts.append([round(0.5 * max(r, 0.0), 4), round(y, 4)])
    pts[0][0] = 0.0
    pts[-1][0] = 0.0
    return pts


# Egg profile: widest just below mid-height, tapering toward the crown. [radius, y] in unit space.
BODY_PROFILE = _egg_profile()


MATERIALS = [
    {'id': 'hidden', 'color': '#000000', 'roughness': 1.0, 'materialClass': 'unknown', 'finish': 'none'},
    {'id': 'body-plastic', 'color': '#4AAEF8', 'roughness': 0.25,
     'evidence': 'albedo-samples.json body flank median #329CE5 is on the shadow side; de-lit estimate #4AAEF8 matches prompt palette #4FB3FF',
     'localOverrides': [
         {'id': 'mitt-contact-ao', 'region': 'body surface under and behind each mitt', 'albedoMultiplier': 0.82, 'roughness': 0.3,
          'evidenceRef': 'detail-inventory/zone-r1c0.png', 'notes': 'soft contact darkening where the mitt overlaps the body'},
         {'id': 'base-contact-ao', 'region': 'lowest 6% of the body where it sits on the feet', 'albedoMultiplier': 0.85,
          'evidenceRef': 'detail-inventory/zone-r2c1.png', 'notes': 'contact shadow band at the body base'},
     ]},
    {'id': 'belly-cream', 'color': '#F3E6CC', 'roughness': 0.35, 'evidence': 'zone-r2c1 belly centre'},
    {'id': 'eye-white', 'color': '#F6F4EE', 'roughness': 0.2, 'evidence': 'zone-r1c1 sclera'},
    {'id': 'pupil-ink', 'color': '#1E1414', 'roughness': 0.15, 'evidence': 'zone-r1c1 pupils'},
    {'id': 'catchlight', 'color': '#FFFFFF', 'roughness': 0.1, 'emissive': '#FFFFFF', 'emissiveIntensity': 0.8, 'evidence': 'zone-r1c1 pupil highlights'},
    {'id': 'violet-plastic', 'color': '#4A2F78', 'roughness': 0.3, 'evidence': 'zone-r2c0 / r2c2 feet, zone-r0c1 stalk'},
    {'id': 'gem-yellow', 'color': '#FFC21A', 'roughness': 0.25, 'evidence': 'zone-r0c1 / r0c2 gem facets'},
]


def mirror(p):
    q = dict(p)
    q['pos'] = [-p['pos'][0], p['pos'][1], p['pos'][2]]
    if 'rot' in p:
        q['rot'] = [p['rot'][0], -p['rot'][1], -p['rot'][2]]
    return q


eye_l = {
    'id': 'eye-l', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'ellipsoid',
    'dims': [0.29, 0.32, 0.09], 'pos': [0.15, 0.23, 0.35], 'rot': [-0.12, 0.38, 0.0],
    'material': 'eye-white', 'importance': 0.95,
}
pupil_l = {
    'id': 'pupil-l', 'level': 'micro', 'role': 'detail', 'parent': 'eye-l', 'primitive': 'ellipsoid',
    'dims': [0.13, 0.15, 0.04], 'pos': [-0.03, 0.015, 0.035], 'material': 'pupil-ink', 'importance': 0.9,
}
catch_l = {
    'id': 'catchlight-l', 'level': 'micro', 'role': 'detail', 'parent': 'pupil-l', 'primitive': 'sphere',
    'dims': [0.032, 0.032, 0.012], 'pos': [0.02, 0.03, 0.016], 'material': 'catchlight', 'importance': 0.5,
}
foot_l = {
    'id': 'foot-l', 'level': 'macro', 'role': 'foot', 'parent': 'root', 'primitive': 'ellipsoid',
    'dims': [0.34, 0.21, 0.42], 'pos': [0.25, 0.1, 0.1], 'material': 'violet-plastic', 'importance': 0.8,
    'animationRole': 'step', 'pivotMode': 'top', 'pivot': [0, 0.1, 0],
}
hand_l = {
    # Rest pose is symmetric. The reference raises the character-right mitt; the game applies
    # that as the aim pose on hand-r's pivot (see anatomy.json pose.jointAngles).
    'id': 'hand-l', 'level': 'macro', 'role': 'hand', 'parent': 'body', 'primitive': 'ellipsoid',
    'dims': [0.32, 0.38, 0.32], 'pos': [0.44, -0.22, 0.04], 'rot': [0.0, 0.0, 0.25],
    'material': 'body-plastic', 'importance': 0.75, 'animationRole': 'sway', 'pivotMode': 'top', 'pivot': [0, 0.13, 0],
}
hand_r = {
    # Character-right mitt is raised forward at waist height: the gun hand in game.
    'id': 'hand-r', 'level': 'macro', 'role': 'hand', 'parent': 'body', 'primitive': 'ellipsoid',
    'dims': [0.32, 0.38, 0.32], 'pos': [-0.44, -0.22, 0.04], 'rot': [0.0, 0.0, -0.25],
    'material': 'body-plastic', 'importance': 0.8, 'animationRole': 'aim', 'pivotMode': 'top', 'pivot': [0.05, 0.1, -0.05],
    'sockets': [{'id': 'gun', 'localPosition': [-0.02, -0.02, 0.12], 'localRotation': [0, 0, 0], 'purpose': 'weapon grip'}],
}

PARTS = [
    {'id': 'root', 'level': 'macro', 'role': 'root', 'parent': None, 'primitive': 'box', 'dims': [0.01, 0.01, 0.01],
     'material': 'hidden', 'importance': 0.1, 'animationRole': 'root-motion', 'topologyRationale': 'Invisible pivot for whole-figure motion.'},
    {'id': 'body', 'level': 'macro', 'role': 'body', 'parent': 'root', 'primitive': 'lathe',
     'dims': [BODY_W, BODY_H, BODY_D], 'pos': [0, BODY_Y, 0], 'material': 'body-plastic', 'importance': 1.0,
     'topologyClass': 'continuous-sculpt', 'topologyRationale': 'Head and torso are one continuous egg volume; a lathe profile gives the bottom-heavy taper an ellipsoid cannot.',
     'descriptor': {'latheProfile': {'points': BODY_PROFILE, 'segments': 28}},
     'localFeatures': [
         {'id': 'belly-seam', 'kind': 'seam', 'description': 'flush colour boundary where the cream belly meets the azure body', 'evidenceRef': 'detail-inventory/zone-r2c1.png'},
         {'id': 'crown-socket', 'kind': 'hole', 'description': 'antenna stalk socket at the crown', 'evidenceRef': 'detail-inventory/zone-r0c1.png'},
     ],
     'animationRole': 'squash', 'pivotMode': 'bottom', 'pivot': [0, -BODY_H / 2, 0],
     },
    {'id': 'belly-patch', 'level': 'meso', 'role': 'detail', 'parent': 'body', 'primitive': 'ellipsoid',
     'dims': [0.6, 0.66, 0.24], 'pos': [0, -0.27, 0.3], 'rot': [0.12, 0, 0], 'material': 'belly-cream', 'importance': 0.9,
     },
    eye_l, mirror({**eye_l, 'id': 'eye-r'}),
    pupil_l, {**mirror(pupil_l), 'id': 'pupil-r', 'parent': 'eye-r'},
    catch_l, {**mirror(catch_l), 'id': 'catchlight-r', 'parent': 'pupil-r'},
    hand_l, hand_r,
    foot_l, {**mirror(foot_l), 'id': 'foot-r'},
    {'id': 'antenna-stalk', 'level': 'meso', 'role': 'antenna', 'parent': 'body', 'primitive': 'cylinder',
     'dims': [0.08, 0.18, 0.08], 'material': 'violet-plastic', 'importance': 0.85,
     'animationRole': 'wobble', 'pivotMode': 'base',
     'topologyRationale': 'Lower half of the curved stalk; the generator builds attachment parts as tapered cylinders from localStart to localEnd in parent space.',
     'attachment': {**attach('body', 'crown', [0, 0.6, 0], [0.02, 0.78, 0.02], 'socket', 0.025), 'baseRadius': 0.04, 'endRadius': 0.035}},
    {'id': 'antenna-tip', 'level': 'meso', 'role': 'antenna', 'parent': 'antenna-stalk', 'primitive': 'cylinder',
     'dims': [0.07, 0.14, 0.07], 'material': 'violet-plastic', 'importance': 0.8,
     'animationRole': 'wobble', 'pivotMode': 'base',
     'topologyRationale': 'Upper half of the stalk, bent toward character-left to approximate the S-curve.',
     'attachment': {**attach('antenna-stalk', 'bend', [0.02, 0.17, 0.02], [0.13, 0.25, 0.06], 'overlap', 0.01), 'baseRadius': 0.035, 'endRadius': 0.03}},
    {'id': 'antenna-gem', 'level': 'meso', 'role': 'ornament', 'parent': 'antenna-tip', 'primitive': 'lathe',
     'dims': [0.33, 0.46, 0.33], 'pos': [0.15, 0.27, 0.05], 'rot': [0.0, 0.785, -0.3], 'material': 'gem-yellow', 'importance': 0.95,
     'descriptor': {'latheProfile': {'points': [[0.0, -0.5], [0.5, 0.0], [0.0, 0.5]], 'segments': 4}},
     'normalStrategy': 'flat faceted normals',
     'localFeatures': [{'id': 'gem-facets', 'kind': 'bevel', 'description': 'eight flat facets meeting at a sharp waist', 'evidenceRef': 'detail-inventory/zone-r0c2.png'}],
     'topologyClass': 'assembled-solid', 'topologyRationale': 'Square bipyramid gem: a 4-segment lathe gives flat facets.'},
]

PASS_COMPONENTS = {
    'blockout': ['root', 'body', 'hand-l', 'hand-r', 'foot-l', 'foot-r', 'antenna-stalk', 'antenna-tip', 'antenna-gem'],
    'structural-pass': ['root', 'body', 'hand-l', 'hand-r', 'foot-l', 'foot-r', 'antenna-stalk', 'antenna-tip', 'antenna-gem'],
    'proportion-lock': ['root', 'body', 'belly-patch', 'hand-l', 'hand-r', 'foot-l', 'foot-r', 'antenna-stalk', 'antenna-tip', 'antenna-gem'],
}

DETAILS = [
    {'id': 'antenna-gem', 'kind': 'contour', 'description': 'yellow square bipyramid gem, flat facets', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'antenna-gem'}, 'evidenceRef': 'detail-inventory/zone-r0c2.png', 'confidence': 0.8},
    {'id': 'antenna-stalk-curve', 'kind': 'contour', 'description': 'violet stalk curving forward-left from the crown', 'scale': 'meso', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'antenna-stalk'}, 'evidenceRef': 'detail-inventory/zone-r0c1.png', 'confidence': 0.7},
    {'id': 'eye-sclera', 'kind': 'decal', 'description': 'two large off-white discs proud of the body', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'eye-l'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.9},
    {'id': 'pupils', 'kind': 'decal', 'description': 'near-black pupils offset inward', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'pupil-l'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.9},
    {'id': 'catchlights', 'kind': 'gloss', 'description': 'white catchlight dot on each pupil', 'scale': 'micro', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'catchlight-l'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.8},
    {'id': 'belly-patch', 'kind': 'decal', 'description': 'cream ellipse on the lower front', 'scale': 'meso', 'affects': 'identity',
     'mapsTo': {'type': 'component', 'ref': 'belly-patch'}, 'evidenceRef': 'detail-inventory/zone-r2c1.png', 'confidence': 0.9},
    {'id': 'violet-feet', 'kind': 'contour', 'description': 'two flattened violet feet under the body', 'scale': 'macro', 'affects': 'silhouette',
     'mapsTo': {'type': 'component', 'ref': 'foot-l'}, 'evidenceRef': 'detail-inventory/zone-r2c0.png', 'confidence': 0.85},
    {'id': 'gloss-finish', 'kind': 'gloss', 'description': 'low-roughness moulded plastic everywhere', 'scale': 'micro', 'affects': 'material',
     'mapsTo': {'type': 'material', 'ref': 'body-plastic'}, 'evidenceRef': 'detail-inventory/zone-r1c1.png', 'confidence': 0.85},
]

LIGHTING = [
    {'id': 'key', 'type': 'area/soft box', 'direction': 'upper front-left of the figure', 'evidence': 'large soft speculars on crown, mitts and feet face upper-left', 'intensity': 'high'},
    {'id': 'fill', 'type': 'soft fill', 'direction': 'front-right', 'evidence': 'shadow side of body stays mid-value azure, never black', 'intensity': 'medium'},
    {'id': 'rim', 'type': 'faint rim', 'direction': 'behind right', 'evidence': 'slight edge lift on the right silhouette', 'intensity': 'low'},
    {'id': 'environment', 'type': 'neutral grey studio sweep', 'evidence': 'background #C9C9C9 with no horizon', 'notes': 'Review renders use ACES filmic tone mapping at exposure 1.0; the game itself uses a 3-step toon ramp, so tone mapping is review-only.'},
    {'id': 'ground', 'type': 'contact shadow', 'evidence': 'soft ground contact shadow under the feet', 'notes': 'Game uses a directional shadow map plus ambient occlusion contact darkening.'},
]

MODEL = {
    'details': DETAILS,
    'lightingFromPhoto': LIGHTING,
    'unknowns': [],
    'passOrder': ['blockout', 'structural-pass', 'proportion-lock', 'feature-placement', 'material-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass'],
    'materials': MATERIALS,
    'parts': PARTS,
    'passComponents': PASS_COMPONENTS,
    'passGoals': {
        'structural-pass': ('Lock the part hierarchy, pivots, sockets and attachments.',
                            ['Every part is a named pivot group; mitts pivot at the shoulder, feet at the top, antenna at the crown']),
        'blockout': ('Match the egg body, mitt and foot placement, and antenna silhouette.',
                     ['Body reads as a bottom-heavy egg ~1.33x taller than wide', 'Feet peek out under the body', 'Antenna gem sits up and to character-left']),
        'proportion-lock': ('Lock body/belly/limb proportions against landmarks.png.',
                            ['Belly covers ~60% of body width centred at 0.73 of body height from the crown']),
        'feature-placement': ('Place eyes, pupils and catchlights.',
                              ['Eye centres at 0.317 of body height from crown, spacing 0.33 of body width']),
    },
    'featureReviewTargets': [
        {'id': 'anatomy-proportion', 'name': 'Egg body, feet and mitt proportions', 'tier': 'critical',
         'passIds': ['blockout', 'proportion-lock'], 'minimumScore': 0.78, 'mustPass': True,
         'componentRefs': ['body', 'foot-l', 'foot-r', 'hand-l', 'hand-r'], 'evidenceRefs': ['full-object']},
        {'id': 'pose-silhouette', 'name': 'Full silhouette incl. antenna', 'tier': 'critical',
         'passIds': ['blockout', 'proportion-lock'], 'minimumScore': 0.75, 'mustPass': True,
         'componentRefs': ['body', 'antenna-stalk', 'antenna-tip', 'antenna-gem'], 'evidenceRefs': ['full-object']},
        {'id': 'face-landmark-placement', 'name': 'Eyes, pupils, catchlights', 'tier': 'critical',
         'passIds': ['feature-placement'], 'minimumScore': 0.75, 'mustPass': True,
         'componentRefs': ['eye-l', 'eye-r', 'pupil-l', 'pupil-r'], 'evidenceRefs': ['full-object']},
        {'id': 'antenna-gem-signature', 'name': 'Yellow bipyramid gem on curved violet stalk', 'tier': 'critical',
         'passIds': ['feature-placement', 'material-pass'], 'minimumScore': 0.75, 'mustPass': True,
         'componentRefs': ['antenna-stalk', 'antenna-tip', 'antenna-gem'], 'evidenceRefs': ['full-object']},
        {'id': 'outfit-and-palette', 'name': 'Azure body, cream belly, violet feet, yellow gem', 'tier': 'important',
         'passIds': ['material-pass'], 'minimumScore': 0.7, 'mustPass': False,
         'componentRefs': ['body', 'belly-patch', 'foot-l', 'antenna-gem'], 'evidenceRefs': ['full-object']},
    ],
    'silhouette': {
        'boundingShape': 'egg (bottom-heavy ovoid) with two side mitts, two feet below and a gem antenna above',
        'aspectRatios': [{'name': 'body height:width', 'value': 1.33}, {'name': 'figure height incl. antenna:width', 'value': 1.85}],
        'symmetry': 'bilateral (antenna and mitt pose break it)',
        'dominantCurves': ['egg outline', 'antenna stalk S-curve'],
        'negativeSpaces': ['gap between feet', 'gap between hanging left mitt and body'],
        'landmarks': ['crown', 'eye line 0.317', 'belly centre 0.73', 'mitt centre 0.62'],
    },
    'coordinateFrame': {'front': '+Z (camera-facing in reference)', 'up': '+Y', 'characterLeft': '+X', 'units': 'meters', 'scaleReference': 'figure height 1.45 m sole to crown'},
    'performanceBudget': {'qualityPriority': 'runtime', 'targetTriangles': 6000, 'maxDrawCalls': 20, 'textureSize': 0, 'fpsTarget': 60,
                          'optimizationPolicy': 'Up to 9 copies on screen; stay in the low tessellation tier.'},
    'assumptions': ['Resolved unknowns (single view): see risks.', 'Back of body is a smooth continuation of the egg.', 'Antenna leans forward-left about 25 degrees.', 'Gem is a 4-sided bipyramid.'],
    'risks': ['Single 3/4 view: back and antenna depth are inferred (confidence 0.5).'],
    'repetitionSystems': [{'id': 'bilateral-pairs', 'type': 'mirror', 'axis': 'x', 'members': ['eye-l/eye-r', 'pupil-l/pupil-r', 'catchlight-l/catchlight-r', 'foot-l/foot-r'],
                           'notes': 'Mirror across the sagittal plane; mitts are posed asymmetrically.'}],
    'rig': {'version': '1.0', 'bindPose': 'rest', 'forward': '+Z', 'bones': [], 'posedJoints': {},
            'notes': 'Rigid part animation only (pivot groups); no skinned mesh.'},
}
