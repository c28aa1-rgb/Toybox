import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, object_class, suitability  # noqa: E402,F401

NAME = 'Snap Trap'
ANALYSIS = """# Snap Trap: image analysis

Reference: 1448x1086 AI concept, front view from slightly above, neutral background.

Layer 1: floor mine, primaryDomain object, confidence 0.95.
Layer 2-4: Low wide orange puck, a ring of violet teeth around the top edge, red domed button in the middle.
Layer 5-6: glossy dielectric plastic, flat colour per part; value changes are studio shading.
Layer 8: single view; the back and the depth of side parts are inferred.
"""
SUITABILITY = suitability(NAME).replace('straight side profile', 'front view from slightly above')
OBJECT_CLASS = object_class('floor mine')
REASONING = ['Lathe body and lid, small repeated details placed around the axis.']
SAMPLE_REGIONS = {'body-plastic': (724, 782, 30, 30)}
ZONES = {f'zone-r{r}c{c}': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7) for r in range(3) for c in range(3)}
