import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, object_class, suitability  # noqa: E402,F401

NAME = 'Goo Bomb'
ANALYSIS = """# Goo Bomb: image analysis

Reference: 1448x1086 AI concept, upright front view, neutral background.

Layer 1: jar grenade, primaryDomain object, confidence 0.95.
Layer 2-4: Round lime jar, darker goo collar with drips running down, ridged violet lid, yellow spout and ring pull.
Layer 5-6: glossy dielectric plastic, flat colour per part; value changes are studio shading.
Layer 8: single view; the back and the depth of side parts are inferred.
"""
SUITABILITY = suitability(NAME).replace('straight side profile', 'upright front view')
OBJECT_CLASS = object_class('jar grenade')
REASONING = ['Lathe body and lid, small repeated details placed around the axis.']
SAMPLE_REGIONS = {'body-plastic': (695, 840, 30, 30)}
ZONES = {f'zone-r{r}c{c}': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7) for r in range(3) for c in range(3)}
