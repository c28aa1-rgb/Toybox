import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Chameleon'
ANALYSIS = analysis(
    NAME, 'mint green, mid-high value (~#3DDBB4)',
    '- `eye-turret-l/r`: mint turret bulges the eyes sit in, standing proud of the head like a real chameleon.\n'
    '- `crest` + `crest-2`: rounded mint fin on the crown leaning back, with a smaller bump behind it.\n'
    '- `tail`: thick mint tail coiled into a flat spiral on the character-left side behind the hanging mitt, ~0.5 m across.\n'
    '- Cream belly ellipse, large and low; ~12 lighter-mint spots scattered over the crown, flanks and tail.',
    '1. Curly spiral tail. 2. Eye turrets. 3. Crown crest. 4. Lighter spots. 5. Cream belly.',
    'Tail root and the back of the coil are hidden behind the body (assumed to join the lower back). Spot layout on the back is inferred.',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('eye turrets, crown crest and spiral tail')
REASONING = ['Five macro parts plus eye turrets, crest and a coiled tail.', 'Belly and spots are painted regions.',
             'Bilateral pairs are one mirror system; the tail breaks symmetry.']
SAMPLE_REGIONS = {'body-plastic': (390, 600, 30, 30), 'belly-cream': (520, 800, 40, 40), 'spot-mint': (835, 525, 14, 24)}
ZONES = {
    'zone-r0c0': ('contour', 'background only', 'macro', 'silhouette', '', 0.9),
    'zone-r0c1': ('contour', 'mint crest fin on the crown with a smaller bump behind; first spots', 'meso', 'silhouette', 'crest', 0.85),
    'zone-r0c2': ('contour', 'back edge of the crown with lighter spots', 'meso', 'silhouette', 'body', 0.7),
    'zone-r1c0': ('contour', 'character-right eye in its mint turret; raised mitt', 'meso', 'identity', 'eye-turret-r', 0.85),
    'zone-r1c1': ('decal', 'character-left eye turret and spots on the flank', 'meso', 'identity', 'eye-turret-l', 0.85),
    'zone-r1c2': ('contour', 'outer coil of the spiral tail with spots', 'meso', 'silhouette', 'tail', 0.85),
    'zone-r2c0': ('contour', 'character-right violet foot; raised mitt', 'macro', 'silhouette', 'foot-r', 0.85),
    'zone-r2c1': ('decal', 'large cream belly ellipse, flush with the body', 'meso', 'identity', 'body', 0.9),
    'zone-r2c2': ('contour', 'hanging character-left mitt over the inner curl of the tail; foot', 'macro', 'silhouette', 'hand-l', 0.8),
}
