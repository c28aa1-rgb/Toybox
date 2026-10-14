import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Mirage'
ANALYSIS = analysis(
    NAME, 'light lavender, high value (~#B48CFF)',
    '- Mask: dark ink band ~0.2 m tall across the eyes, wrapping around the head (painted region).\n'
    '- `hat-crown` + `hat-brim`: short grape top hat with a fat rolled brim, perched on the crown and tilted toward character-left.\n'
    '- Cream belly ellipse as on Flicker.',
    '1. Domino mask band. 2. Tilted top hat. 3. Big eyes showing through the mask.',
    'Back of the mask band assumed to wrap around. Hat top assumed flat.',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('painted mask band and top hat')
REASONING = ['Five macro parts plus a two-part hat.', 'Mask and belly are painted regions.', 'Bilateral pairs are one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (390, 700, 25, 40), 'hat-grape': (700, 230, 40, 30)}
ZONES = {
    'zone-r0c0': ('contour', 'background only', 'macro', 'silhouette', '', 0.9),
    'zone-r0c1': ('contour', 'grape top hat crown and rolled brim on the lavender crown', 'meso', 'silhouette', 'hat-crown', 0.85),
    'zone-r0c2': ('contour', 'right side of the hat crown and brim', 'meso', 'silhouette', 'hat-brim', 0.8),
    'zone-r1c0': ('decal', 'left end of the ink mask band; raised character-right mitt', 'meso', 'identity', 'body', 0.85),
    'zone-r1c1': ('decal', 'eyes framed by the ink mask band', 'meso', 'identity', 'eye-l', 0.9),
    'zone-r1c2': ('decal', 'mask band wrapping round the flank; hanging mitt', 'meso', 'identity', 'body', 0.8),
    'zone-r2c0': ('contour', 'character-right violet foot', 'macro', 'silhouette', 'foot-r', 0.85),
    'zone-r2c1': ('decal', 'cream belly ellipse', 'meso', 'identity', 'body', 0.9),
    'zone-r2c2': ('contour', 'character-left violet foot', 'macro', 'silhouette', 'foot-l', 0.85),
}
