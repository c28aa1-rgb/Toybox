"""Shared intake text for the toy guns. Each gun's intake.py fills in what differs."""

COMPLEXITY = 'moderate'
SPEC_QUERIES = ['glossy plastic toy gun', 'extruded side profile', 'cylinder barrel']
SCORES = {'silhouetteComplexity': 3, 'componentCount': 3, 'hierarchyDepth': 2, 'repetitionDensity': 1,
          'materialLayerCount': 3, 'localDetailDensity': 2, 'occlusionRisk': 1, 'actionReadinessNeed': 2}
COUNTS = {'macroComponents': 3, 'mesoComponents': 4, 'microFeatureGroups': 2, 'materialLayers': 5, 'repetitionSystems': 1}
CONTRACT = ''


def object_class(kind: str) -> dict:
    return {
        'primaryType': f'toy {kind}',
        'primaryDomain': 'object',
        'formLanguage': ['rounded', 'chunky', 'moulded'],
        'structureKind': ['profile slabs', 'cylinders along the barrel axis'],
        'motionPotential': ['rigid prop held at the grip; recoil kick'],
        'materialFamilies': ['glossy dielectric plastic'],
        'notes': 'Straight side profile reference; thickness across the gun is inferred.',
    }


def suitability(name: str) -> str:
    return f"""# {name}: reference suitability

Verdict: **conditional** (single side view).

- One centred object on a neutral background, whole silhouette visible in a clean side profile.
- Flat-colour glossy plastic; every distinct part visible from this side.
- Thickness across the gun is not visible and is inferred from toy proportions (confidence 0.6).
- Approximable with extruded profile slabs, cylinders, torus rings and a lathe nose.
"""


def analysis(name: str, parts: str, identity: str) -> str:
    return f"""# {name}: image analysis

Reference: 1254x1254 AI concept, straight side profile, muzzle to the right, neutral background.

## Layer 1: identification
Toy gun, `primaryDomain: object`, confidence 0.95.

## Layer 2-4: form, decomposition, relationships
{parts}

## Layer 5-6: materials and colour
Glossy dielectric plastic (metalness 0, roughness ~0.25), flat colour per part. Value changes are studio shading.

## Layer 7: identity features
{identity}

## Layer 8: single-view limits
Thickness across the gun and the far side are not visible; both sides assumed identical.
"""
