import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from hero_intake import COMPLEXITY, COUNTS, SCORES, SPEC_QUERIES, analysis, contract, object_class, suitability  # noqa: E402,F401

NAME = 'Tock'
ANALYSIS = analysis(
    NAME, 'mint green, mid-high value (~#3DDBB4)',
    '- `clock-face`: white disc set into the belly (no cream belly), ~0.5 m across, centred 0.66 of body height from the crown.\n'
    '- `clock-rim`: yellow bezel ring around the dial.\n'
    '- `dial-hour`, `dial-minute`, `dial-hub`: violet hands (hour up, minute toward ~4 o\'clock) and centre hub.\n'
    '- `bell-stem` + `bell` + `bell-knob`: yellow dome bell, open underneath, on a short stem at the crown, tilted.',
    '1. Clock dial on the belly. 2. Yellow alarm bell on top. 3. Big eyes.',
    'Bell interior unseen (assumed open shell). Dial assumed flat.',
)
SUITABILITY = suitability(NAME)
CONTRACT = contract(NAME)
OBJECT_CLASS = object_class('clock dial and dome bell')
REASONING = ['Five macro parts plus dial assembly (face, rim, hands, hub) and bell assembly (stem, dome, knob).',
             'Bilateral pairs are one mirror system.']
SAMPLE_REGIONS = {'body-plastic': (380, 560, 25, 40), 'gem-yellow': (640, 250, 30, 20), 'eye-white': (470, 870, 30, 30)}
ZONES = {
    'zone-r0c0': ('contour', 'background only', 'macro', 'silhouette', '', 0.9),
    'zone-r0c1': ('contour', 'yellow dome bell with knob on a stem; mint crown', 'meso', 'silhouette', 'bell', 0.85),
    'zone-r0c2': ('contour', 'right edge of the bell dome', 'meso', 'silhouette', 'bell', 0.7),
    'zone-r1c0': ('contour', 'raised character-right mitt; left eye', 'macro', 'silhouette', 'hand-r', 0.8),
    'zone-r1c1': ('decal', 'two big eyes; top of the yellow bezel', 'meso', 'identity', 'eye-l', 0.9),
    'zone-r1c2': ('contour', 'hanging character-left mitt', 'macro', 'silhouette', 'hand-l', 0.8),
    'zone-r2c0': ('contour', 'character-right violet foot', 'macro', 'silhouette', 'foot-r', 0.85),
    'zone-r2c1': ('linework', 'white dial with violet hands and hub inside the yellow bezel', 'meso', 'identity', 'clock-face', 0.9),
    'zone-r2c2': ('contour', 'character-left violet foot', 'macro', 'silhouette', 'foot-l', 0.85),
}
