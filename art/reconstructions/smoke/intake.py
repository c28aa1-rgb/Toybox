import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, object_class, suitability  # noqa: E402,F401

NAME = 'Puff Can'
ANALYSIS = """# Puff Can: image analysis

Reference: 1254x1254 AI concept, upright front view, neutral background.

Layer 1: toy smoke canister, primaryDomain object, confidence 0.95.
Layer 2-4: Tall lavender can, wide violet band, violet vented dome, yellow ring pull on a loop.
Layer 5-6: glossy dielectric plastic, flat colour per part; value changes are studio shading.
Layer 8: single front view; the depth of the lever/ring is inferred.
"""
SUITABILITY = suitability(NAME).replace('straight side profile', 'upright front view')
OBJECT_CLASS = object_class('smoke canister')
REASONING = ['Lathe body and cap, torus rings and bands, a flat lever, small dots.']
SAMPLE_REGIONS = {'body-plastic': (590, 1200, 30, 20)}
ZONES = {'zone-r0c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7)}
