import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, object_class, suitability  # noqa: E402,F401

NAME = 'Bounce Pad'
ANALYSIS = """# Bounce Pad: image analysis

Reference: 1254x1254 AI concept, front view from slightly above, neutral background.

Layer 1: toy springboard, primaryDomain object, confidence 0.95.
Layer 2-4: Round sky-blue mat with a white star, thick segmented yellow rim, fat violet coil spring, flat white base disc.
Layer 5-6: glossy dielectric plastic, flat colour per part; value changes are studio shading.
Layer 8: single view from above; heights are read from the front edge, the underside is inferred.
"""
SUITABILITY = suitability(NAME).replace('straight side profile', 'front view from slightly above')
OBJECT_CLASS = object_class('springboard')
REASONING = ['Lathe base and mat, stacked torus coils and rim, a flat extruded star on top.']
SAMPLE_REGIONS = {'body-plastic': (380, 560, 30, 30)}
ZONES = {f'zone-r{r}c{c}': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7) for r in range(3) for c in range(3)}
