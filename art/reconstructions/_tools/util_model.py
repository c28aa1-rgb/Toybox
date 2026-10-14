"""Model assembly for upright utility throwables (shares gun_base's spec plumbing)."""
from typing import Any

from gun_base import LIGHTING


def build_util_model(*, name: str, parts: list[dict[str, Any]], materials: list[dict[str, Any]],
                     details: list[dict[str, Any]], signature: dict[str, Any], palette: str, height_m: float,
                     blockout_ids: list[str]) -> dict[str, Any]:
    root = {'id': 'root', 'level': 'macro', 'role': 'root', 'parent': None, 'primitive': 'box', 'dims': [0.01, 0.01, 0.01],
            'material': 'hidden', 'importance': 0.1, 'animationRole': 'root-motion',
            'topologyRationale': 'Invisible pivot at the bottom centre; the throw simulation moves this point.'}
    parts = [dict(p) for p in parts]
    parts[0]['localFeatures'] = parts[0].get('localFeatures', []) + [
        {'id': 'edge-roundover', 'kind': 'bevel', 'description': 'rolled moulded edges that catch a soft highlight',
         'evidenceRef': 'detail-inventory/zone-r1c1.png'}]
    parts[1]['localFeatures'] = parts[1].get('localFeatures', []) + [
        {'id': 'seam-step', 'kind': 'seam', 'description': 'stepped joint where this part meets the body',
         'evidenceRef': 'detail-inventory/zone-r0c1.png'}]
    mats = [{'id': 'hidden', 'color': '#000000', 'roughness': 1.0, 'materialClass': 'unknown', 'finish': 'none'}] + materials
    mats[1] = {**mats[1], 'localOverrides': [
        {'id': 'seam-contact-ao', 'region': 'where the cap meets the body', 'albedoMultiplier': 0.85,
         'evidenceRef': 'detail-inventory/zone-r1c1.png', 'notes': 'soft contact darkening at the moulded seam'}]}
    return {
        'details': details, 'lightingFromPhoto': LIGHTING, 'unknowns': [],
        'passOrder': ['blockout', 'structural-pass', 'form-refinement', 'material-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass'],
        'materials': mats, 'parts': [root] + parts,
        'passComponents': {'blockout': ['root'] + blockout_ids, 'structural-pass': ['root'] + blockout_ids},
        'passGoals': {
            'blockout': ('Match the front silhouette and main masses.', [f'{name} body, cap and handle proportions match']),
            'structural-pass': ('Lock the part hierarchy.', ['Every part is a named pivot; bottom-centre origin']),
            'form-refinement': ('Add rings, bands, holes and small details.', ['Small details sit where the reference shows them']),
        },
        'featureReviewTargets': [
            {'id': 'profile-silhouette', 'name': 'Front silhouette and proportions', 'tier': 'critical',
             'passIds': ['blockout', 'structural-pass'], 'minimumScore': 0.78, 'mustPass': True,
             'componentRefs': blockout_ids[:3], 'evidenceRefs': ['full-object']},
            signature,
            {'id': 'palette', 'name': palette, 'tier': 'important', 'passIds': ['material-pass'], 'minimumScore': 0.7,
             'mustPass': False, 'componentRefs': blockout_ids[:2], 'evidenceRefs': ['full-object']},
        ],
        'silhouette': {'boundingShape': f'upright toy {name}', 'aspectRatios': [], 'symmetry': 'radial body with side handle',
                       'dominantCurves': ['round body'], 'negativeSpaces': ['inside the ring pull'], 'landmarks': ['base', 'cap']},
        'coordinateFrame': {'front': '+Z (toward the viewer)', 'up': '+Y', 'units': 'meters', 'scaleReference': f'height {height_m} m'},
        'performanceBudget': {'qualityPriority': 'runtime', 'targetTriangles': 2000, 'maxDrawCalls': 12, 'textureSize': 0, 'fpsTarget': 60,
                              'optimizationPolicy': 'Several in flight at once.'},
        'assumptions': ['Resolved unknowns (single front view): see risks.', 'Body is round (lathe).'],
        'risks': ['Single front view: depth of the handle is inferred.'],
        'repetitionSystems': [{'id': 'bands', 'type': 'stack', 'axis': 'y', 'members': ['bands'], 'notes': 'Stacked rings on the body.'}],
        'rig': {'version': '1.0', 'bindPose': 'rest', 'forward': '+Z', 'bones': [], 'posedJoints': {}, 'notes': 'Rigid prop.'},
    }


def detail(i, kind, desc, ref, zone, scale='micro', affects='identity', conf=0.8):
    return {'id': i, 'kind': kind, 'description': desc, 'scale': scale, 'affects': affects,
            'mapsTo': {'type': 'component' if ref else 'material', 'ref': ref}, 'evidenceRef': f'detail-inventory/{zone}.png', 'confidence': conf}
