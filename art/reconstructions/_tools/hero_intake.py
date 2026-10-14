"""Shared intake text for the hero toys. Each hero's intake.py fills in what differs."""

COMPLEXITY = 'moderate'
SPEC_QUERIES = ['glossy plastic vinyl toy', 'stylized cartoon eye catchlight', 'superellipsoid bean body']
SCORES = {'silhouetteComplexity': 2, 'componentCount': 3, 'hierarchyDepth': 2, 'repetitionDensity': 1,
          'materialLayerCount': 3, 'localDetailDensity': 2, 'occlusionRisk': 1, 'actionReadinessNeed': 3}
COUNTS = {'macroComponents': 5, 'mesoComponents': 6, 'microFeatureGroups': 2, 'materialLayers': 7, 'repetitionSystems': 1}


def object_class(accessories: str) -> dict:
    return {
        'primaryType': 'stylized vinyl-toy mascot figure',
        'primaryDomain': 'character',
        'formLanguage': ['organic', 'rounded', 'blobby'],
        'structureKind': ['single-volume body', 'appendages', accessories],
        'motionPotential': ['rigid part animation: bob, squash, mitt sway, accessory wobble'],
        'materialFamilies': ['glossy dielectric plastic'],
        'notes': 'Same egg body, eyes, mitts and feet as Flicker (one ChatGPT style sheet); identity lives in colour and accessory.',
    }


def suitability(name: str) -> str:
    return f"""# {name}: reference suitability

Verdict: **pass** (character-conditional -> stylized).

- One centred figure on a neutral grey background, full body visible.
- Every macro part and accessory is visible in the 3/4 view; the back is inferred as a smooth egg.
- Simple glossy plastics only; all distinct surfaces visible.
- Approximable with procedural primitives (lathe egg, spheroids, torus, cylinders, cones, boxes).
- Chibi stylization, stylized fidelity accepted by the user (chunky toy look).
"""


def contract(name: str) -> str:
    return f"""# {name}: character contract notes

Read: `grimoire/character/reconstruction.md`, `grimoire/character/likeness_maximization.md` (same as Flicker).

- Chibi single-volume body, so proportions are fractions of figure height, not head units.
- Rigid part hierarchy (no skinned mesh): root -> body -> eyes/mitts/accessories, root -> feet.
- Freehand stylized route, not projection: flat-colour toy, solid albedo per region; colour regions
  with hard edges (belly, mask) are vertex-painted on the body, per `_shared/vertex_paint.py`.
- Base body/eye/mitt/foot dimensions reuse Flicker's measured and reviewed parts; this hero is
  reviewed against its own reference in every pass.
"""


def analysis(name: str, colour: str, accessory_layers: str, identity: str, unknowns: str) -> str:
    return f"""# {name}: image analysis

Reference: 1254x1254 AI concept, 3/4 front view, neutral grey background.

## Layer 1: identification
Stylized vinyl-toy mascot, `primaryDomain: character`, confidence 0.95.

## Layer 2: form & silhouette
Egg body (head and torso one volume, ~1.33 tall:wide), two teardrop mitts at the sides, two violet
feet, plus the accessories below. Bilateral symmetry except the accessories and the raised mitt.

## Layer 3-4: decomposition and relationships
Macro: body, mitt x2, foot x2. Meso: eyes x2. Micro: pupils, catchlights.
{accessory_layers}

## Layer 5-6: materials and colour
Glossy dielectric plastic everywhere (metalness 0, roughness ~0.25). Body {colour}.
Value changes across each part are studio shading, not paint.

## Layer 7: identity features
{identity}

## Layer 8: single-view limits
{unknowns}
"""
