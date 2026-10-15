import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Echo'
ANALYSIS = analysis(
    NAME, 'bright orange, mid-high value (~#FF8A1F)',
    '- `dish-l/r`: two big radar-dish ears on the crown sides, shallow orange bowls ~0.6 m across facing forward and slightly out, cream inner face.\n'
    '- `antenna-l/r`: short orange stalk with a ball tip in the centre of each dish.\n'
    '- `phones-band`, `cup-l/r`: light-blue headphones resting on the neck, band behind, round cups on the cheeks with darker blue caps.\n'
    '- `wing-l/r`: small bat wings behind the mitts, cream membrane with an orange bone along the top edge and a scalloped lower edge.\n'
    '- Cream belly ellipse, large and low.',
    '1. Radar-dish ears. 2. Blue headphones. 3. Bat wings. 4. Big eyes. 5. Cream belly.',
    'The headphone band behind the head and the wing roots are hidden; the band is assumed to wrap the back of the neck.',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('dish ears, headphones and bat wings')
REASONING = ['Five macro parts plus two dish ears with antennae, headphones (band and two cups) and two wings.',
             'Belly is a painted region.', 'Bilateral pairs are one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (560, 330, 30, 30), 'dish-cream': (420, 300, 20, 20), 'phone-blue': (370, 620, 18, 18)}
ZONES = {
    'zone-r0c0': ('contour', 'character-right radar-dish ear with cream inner face and antenna', 'meso', 'silhouette', 'dish-r', 0.85),
    'zone-r0c1': ('contour', 'orange crown between the two dish ears', 'macro', 'silhouette', 'body', 0.8),
    'zone-r0c2': ('contour', 'character-left radar-dish ear with antenna', 'meso', 'silhouette', 'dish-l', 0.85),
    'zone-r1c0': ('contour', 'character-right blue headphone cup; raised mitt; wing tip behind', 'meso', 'identity', 'cup-r', 0.8),
    'zone-r1c1': ('decal', 'two big eyes with pupils and catchlights', 'meso', 'identity', 'eye-l', 0.9),
    'zone-r1c2': ('contour', 'character-left headphone cup and band; bat wing behind', 'meso', 'silhouette', 'wing-l', 0.8),
    'zone-r2c0': ('contour', 'character-right violet foot; raised mitt', 'macro', 'silhouette', 'foot-r', 0.85),
    'zone-r2c1': ('decal', 'large cream belly ellipse, flush with the body', 'meso', 'identity', 'body', 0.9),
    'zone-r2c2': ('contour', 'hanging character-left mitt and violet foot', 'macro', 'silhouette', 'hand-l', 0.8),
}
