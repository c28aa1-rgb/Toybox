import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Snag'
ANALYSIS = analysis(
    NAME, 'bubblegum pink, mid-high value (~#FF5FA2)',
    '- `helmet`: lemon-yellow climbing helmet over the crown, wider than the head, with two dark side vents.\n'
    '- `lamp-housing`, `lamp-lens`: round headlamp on the helmet front, dark grey ring with a cream lens.\n'
    '- `rope`: thick grape-purple rope coil slung diagonally across the body, high on the character-left shoulder, low on the character-right hip.\n'
    '- `hook-*`: silver grappling hook held up in the character-right mitt, short shaft and three curved prongs.\n'
    '- Cream belly ellipse, large and low.',
    '1. Yellow helmet with headlamp. 2. Diagonal rope sash. 3. Three-pronged hook. 4. Big eyes. 5. Cream belly.',
    'The back of the rope and the helmet strap are hidden; the rope is assumed to wrap round the back.',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('climbing helmet, rope sash and grappling hook')
REASONING = ['Five macro parts plus a helmet with lamp and vents, a rope torus and a hook built from cylinders and cones.',
             'Belly is a painted region.', 'Bilateral pairs (vents) are one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (687, 519, 20, 20), 'helmet-yellow': (678, 100, 20, 20), 'rope-grape': (752, 830, 16, 16)}
ZONES = {
    'zone-r0c0': ('contour', 'character-right side of the helmet with a vent; hook prongs', 'meso', 'silhouette', 'helmet', 0.8),
    'zone-r0c1': ('contour', 'helmet crown and headlamp', 'meso', 'identity', 'lamp-housing', 0.85),
    'zone-r0c2': ('contour', 'character-left side of the helmet with a vent', 'meso', 'silhouette', 'helmet', 0.8),
    'zone-r1c0': ('contour', 'grappling hook held up in the character-right mitt', 'meso', 'silhouette', 'hook-shaft', 0.8),
    'zone-r1c1': ('decal', 'two big eyes with pupils and catchlights', 'meso', 'identity', 'eye-l', 0.9),
    'zone-r1c2': ('contour', 'rope coil over the character-left shoulder; hanging mitt', 'meso', 'silhouette', 'rope', 0.8),
    'zone-r2c0': ('contour', 'character-right violet foot; rope end at the hip', 'macro', 'silhouette', 'foot-r', 0.85),
    'zone-r2c1': ('decal', 'large cream belly ellipse crossed by the rope', 'meso', 'identity', 'body', 0.9),
    'zone-r2c2': ('contour', 'character-left violet foot and mitt', 'macro', 'silhouette', 'foot-l', 0.8),
}
