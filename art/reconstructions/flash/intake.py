import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '_tools'))
from gun_intake import COMPLEXITY, CONTRACT, COUNTS, SCORES, SPEC_QUERIES, object_class, suitability  # noqa: E402,F401

NAME = 'Flash Pop'
ANALYSIS = """# Flash Pop: image analysis

Reference: 1254x1254 AI concept, upright front view, neutral background.

Layer 1: toy flashbang, primaryDomain object, confidence 0.95.
Layer 2-4: Short yellow can with three white bands and a ring of vent holes, violet cap and lever, yellow ring pull.
Layer 5-6: glossy dielectric plastic, flat colour per part; value changes are studio shading.
Layer 8: single front view; the depth of the lever/ring is inferred.
"""
SUITABILITY = suitability(NAME).replace('straight side profile', 'upright front view')
OBJECT_CLASS = object_class('flashbang')
REASONING = ['Lathe body and cap, torus rings and bands, a flat lever, small dots.']
SAMPLE_REGIONS = {'body-plastic': (480, 1150, 30, 20)}
ZONES = {'zone-r0c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r0c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r1c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c0': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c1': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7), 'zone-r2c2': ('contour', 'traced region', 'macro', 'silhouette', '', 0.7)}
