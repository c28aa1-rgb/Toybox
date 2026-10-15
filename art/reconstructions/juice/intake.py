import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, object_class, suitability  # noqa: E402,F401

NAME = 'Juice Box'
ANALYSIS = """# Juice Box: image analysis

Reference: 1448x1086 AI concept, upright front view turned slightly to show the right side, neutral background.

Layer 1: toy drink carton, primaryDomain object, confidence 0.95.
Layer 2-4: Rounded coral carton body, yellow gable top, violet base band, raised white cross on the front, white bendy straw.
Layer 5-6: glossy dielectric plastic, flat colour per part; value changes are studio shading.
Layer 8: single view; the back and the depth of the carton are inferred.
"""
SUITABILITY = suitability(NAME).replace('straight side profile', 'upright front view')
OBJECT_CLASS = object_class('drink carton')
REASONING = ['Extruded front-traced slabs for the carton, base and gable; thin lathe tubes for the straw.']
SAMPLE_REGIONS = {'body-plastic': (550, 450, 30, 30)}
ZONES = {f'zone-r{r}c{c}': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7) for r in range(3) for c in range(3)}
