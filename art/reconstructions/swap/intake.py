import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Switch'
ANALYSIS = analysis(
    NAME, 'vivid pink, mid-high value (~#FF5FA2)',
    '- `band`: sky-blue ring around the body just under the eyes, ~0.12 m tall, standing ~0.06 m proud.\n'
    '- `fin-white`: white cone on the upper character-right crown pointing up and out.\n'
    '- `fin-blue`: sky-blue cone on the upper character-left crown pointing out, near horizontal.\n'
    '- Cream belly ellipse, larger and lower than Flicker\'s, below the band.',
    '1. Opposing white and blue arrow fins (swap motif). 2. Blue band. 3. Big eyes. 4. Cream belly.',
    'Back of the band assumed continuous. The fins have a small flat collar at the base (not modelled).',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('ring band and cone fins')
REASONING = ['Five macro parts plus band and two fins.', 'Belly is a painted region.', 'Bilateral pairs are one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (380, 760, 30, 50), 'band-blue': (700, 585, 40, 14), 'fin-white': (360, 300, 20, 20)}
ZONES = {
    'zone-r0c0': ('contour', 'white arrow fin pointing up-left from the crown', 'meso', 'silhouette', 'fin-white', 0.8),
    'zone-r0c1': ('contour', 'pink crown between the fins; base of the white fin', 'meso', 'silhouette', 'fin-white', 0.75),
    'zone-r0c2': ('contour', 'blue arrow fin pointing right from the upper crown', 'meso', 'silhouette', 'fin-blue', 0.8),
    'zone-r1c0': ('contour', 'raised character-right mitt; left eye edge; band end', 'macro', 'silhouette', 'hand-r', 0.8),
    'zone-r1c1': ('decal', 'two big eyes with pupils and catchlights above the sky-blue band', 'meso', 'identity', 'eye-l', 0.9),
    'zone-r1c2': ('contour', 'hanging character-left mitt; band wrapping round the flank', 'macro', 'silhouette', 'hand-l', 0.8),
    'zone-r2c0': ('contour', 'character-right violet foot', 'macro', 'silhouette', 'foot-r', 0.85),
    'zone-r2c1': ('decal', 'large cream belly ellipse, flush with the body', 'meso', 'identity', 'body', 0.9),
    'zone-r2c2': ('contour', 'character-left violet foot', 'macro', 'silhouette', 'foot-l', 0.85),
}
