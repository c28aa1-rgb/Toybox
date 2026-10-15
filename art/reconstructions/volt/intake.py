import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Volt'
ANALYSIS = analysis(
    NAME, 'lemon yellow, high value (~#FFE45C)',
    '- Body is an upright rounded cylinder (an AA battery), not an egg: ~1.8x taller than wide, flat top with soft shoulders.\n'
    '- `cap-base` + `cap-button`: silver plus-terminal cap on the crown, a flat ring and a raised button.\n'
    '- Purple band painted round the lower quarter of the body (the battery wrapper).\n'
    '- `bolt`: flat white lightning bolt on the belly, slightly raised.\n'
    '- `cable-1..3` + `plug` + `prong-a/b`: cream charging cable curling out from behind the hanging mitt, ending in a purple plug with two silver prongs.',
    '1. Battery body with silver cap. 2. Lightning bolt. 3. Plug tail. 4. Purple band. 5. Big eyes.',
    'Cable root hidden behind the mitt (assumed to leave the lower back). Back of the cap assumed round.',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('battery cap, belly bolt and plug tail')
REASONING = ['Five macro parts on a cylinder body plus cap, bolt and a cable-and-plug tail.',
             'Purple band is a painted region.', 'Bilateral pairs are one mirror system; the cable breaks symmetry.']
SAMPLE_REGIONS = {'body-plastic': (760, 600, 25, 40), 'band-violet': (620, 920, 40, 30), 'cap-silver': (640, 215, 30, 15), 'bolt-white': (555, 705, 20, 30)}
ZONES = {
    'zone-r0c0': ('contour', 'background only', 'macro', 'silhouette', '', 0.9),
    'zone-r0c1': ('contour', 'silver plus-terminal cap on a flat yellow top', 'meso', 'silhouette', 'cap-button', 0.85),
    'zone-r0c2': ('contour', 'right shoulder of the battery top', 'macro', 'silhouette', 'body', 0.75),
    'zone-r1c0': ('contour', 'character-right eye; raised mitt', 'meso', 'identity', 'eye-r', 0.85),
    'zone-r1c1': ('decal', 'two big eyes; top of the white lightning bolt', 'meso', 'identity', 'eye-l', 0.9),
    'zone-r1c2': ('contour', 'purple plug with two silver prongs at the end of the cable', 'meso', 'silhouette', 'plug', 0.85),
    'zone-r2c0': ('contour', 'character-right violet foot under the purple band', 'macro', 'silhouette', 'foot-r', 0.85),
    'zone-r2c1': ('decal', 'white lightning bolt on the belly above the purple band', 'meso', 'identity', 'bolt', 0.9),
    'zone-r2c2': ('contour', 'hanging character-left mitt with the cream cable curling out behind it', 'macro', 'silhouette', 'cable-2', 0.8),
}
