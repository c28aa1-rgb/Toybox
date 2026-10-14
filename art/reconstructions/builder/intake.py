import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Brick'
ANALYSIS = analysis(
    NAME, 'saturated orange, mid-high value (~#FF8A1F)',
    '- `hard-hat` + `hat-ridge` + `hat-peak`: wide yellow ribbed dome with a short front peak, sitting low over the crown.\n'
    '- `belt`: dark ink strap around the lower body at ~0.74 of body height from the crown.\n'
    '- `buckle-brick` + 2 studs: orange toy brick clipped to the belt front, slightly to character-right.\n'
    '- Cream belly ellipse, partly under the belt.',
    '1. Yellow hard hat. 2. Tool belt with brick buckle. 3. Big eyes.',
    'Crown hidden under the hat. Back of the belt assumed continuous.',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('hard hat and belt with brick buckle')
REASONING = ['Five macro parts plus hat assembly and belt assembly.', 'Belly is a painted region.', 'Bilateral pairs are one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (390, 650, 25, 40), 'hat-yellow': (700, 260, 40, 30), 'belt-ink': (640, 870, 40, 15)}
ZONES = {
    'zone-r0c0': ('contour', 'left brim of the hard hat', 'meso', 'silhouette', 'hard-hat', 0.8),
    'zone-r0c1': ('ridge', 'yellow ribbed hard hat dome', 'macro', 'silhouette', 'hard-hat', 0.85),
    'zone-r0c2': ('contour', 'right side of the hard hat and its rear brim', 'meso', 'silhouette', 'hard-hat', 0.8),
    'zone-r1c0': ('contour', 'raised character-right mitt; left eye', 'macro', 'silhouette', 'hand-r', 0.8),
    'zone-r1c1': ('decal', 'two big eyes; top of the cream belly', 'meso', 'identity', 'eye-l', 0.9),
    'zone-r1c2': ('contour', 'hanging character-left mitt', 'macro', 'silhouette', 'hand-l', 0.8),
    'zone-r2c0': ('fastener', 'orange toy brick buckle on the belt; right foot', 'micro', 'identity', 'buckle-brick', 0.8),
    'zone-r2c1': ('seam', 'ink belt crossing the cream belly', 'meso', 'identity', 'belt', 0.85),
    'zone-r2c2': ('contour', 'character-left violet foot; belt end', 'macro', 'silhouette', 'foot-l', 0.85),
}
