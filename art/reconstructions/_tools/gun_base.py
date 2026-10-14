"""Shared helpers for the toy guns.

Each gun concept is a straight side profile (muzzle to the right). Parts are traced in the
500x500 gridded preview of the concept (art/concepts/<id>.png scaled to 500 px) and converted to
metres with a per-gun scale. The model frame: muzzle along +Z, +Y up, X across the gun; the origin
sits at the top of the grip, which is where the hero's mitt socket holds it in game.

Profile slabs are extrusions of the traced outline (the generator's `extrude` primitive), turned so
the outline lies in the Z/Y plane and the extrusion runs across X.
"""
from __future__ import annotations

import math
from typing import Any

from spec_builder import attach

HALF_PI = math.pi / 2


class Frame:
    def __init__(self, metres_per_px: float, origin_px: tuple[float, float]):
        self.s = metres_per_px
        self.ox, self.oy = origin_px

    def z(self, x: float) -> float:
        return round((x - self.ox) * self.s, 4)

    def y(self, yy: float) -> float:
        return round((self.oy - yy) * self.s, 4)

    def zy(self, x: float, yy: float) -> list[float]:
        return [self.z(x), self.y(yy)]

    def m(self, px: float) -> float:
        return round(px * self.s, 4)


def rounded_rect(x0: float, y0: float, x1: float, y1: float, r: float, steps: int = 4) -> list[tuple[float, float]]:
    """Rounded rectangle outline in pixel space (y down), counter-clockwise once flipped to y up."""
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts: list[tuple[float, float]] = []
    # Walk the corners in order so the outline never crosses itself.
    corners = [(x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)]
    for cx, cy, start in corners:
        for i in range(steps + 1):
            a = math.radians(start + 90 * i / steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def slab(f: Frame, pid: str, outline_px: list[tuple[float, float]], thickness: float, material: str, *,
         level: str = 'macro', parent: str = 'root', importance: float = 0.8, x_offset: float = 0.0,
         role: str = 'body', features: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    pts = [f.zy(x, yy) for x, yy in outline_px]
    zs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {
        'id': pid, 'level': level, 'role': role, 'parent': parent, 'primitive': 'extrude', 'material': material,
        'dims': [round(thickness, 4), round(max(ys) - min(ys), 4), round(max(zs) - min(zs), 4)],
        'scale': [1, 1, 1], 'pos': [round(thickness / 2 + x_offset, 4), 0, 0], 'rot': [0, -HALF_PI, 0],
        'descriptor': {'profile2D': {'points': pts, 'depth': round(thickness, 4)}},
        'topologyClass': 'assembled-solid',
        'topologyRationale': 'Moulded toy part traced from the side profile and extruded across its thickness.',
        'importance': importance, 'localFeatures': features or [],
    }


def cyl_z(f: Frame, pid: str, x0: float, x1: float, yy: float, r_px: float, material: str, *,
          r_end_px: float | None = None, parent: str = 'root', level: str = 'meso', importance: float = 0.8,
          x: float = 0.0, role: str = 'tube') -> dict[str, Any]:
    r0 = f.m(r_px)
    r1 = f.m(r_end_px if r_end_px is not None else r_px)
    y = f.y(yy)
    return {
        'id': pid, 'level': level, 'role': role, 'parent': parent, 'primitive': 'cylinder', 'material': material,
        'dims': [2 * r0, 2 * r0, round(f.m(x1 - x0), 4)], 'importance': importance,
        'topologyRationale': 'Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.',
        'attachment': {**attach(parent, f'{pid}-mount', [x, y, f.z(x0)], [x, y, f.z(x1)], 'embed', 0.01), 'baseRadius': r0, 'endRadius': r1},
    }


def ring_z(f: Frame, pid: str, cx: float, cy: float, outer_px: float, inner_px: float, depth_m: float, material: str, *,
           facing: str = 'z', parent: str = 'root', level: str = 'meso', importance: float = 0.7) -> dict[str, Any]:
    """Torus ring. facing='z' looks down the barrel; facing='x' shows its hole in the side view."""
    outer, inner = f.m(outer_px), f.m(inner_px)
    big_r = (outer + inner) / 2
    tube = (outer - inner) / 2
    ratio = tube / big_r
    unit_outer = 0.45 * (1 + ratio)
    k = outer / unit_outer
    kz = depth_m / (2 * 0.45 * ratio)
    rot = [0, 0, 0] if facing == 'z' else [0, HALF_PI, 0]
    return {
        'id': pid, 'level': level, 'role': 'detail', 'parent': parent, 'primitive': 'torus', 'material': material,
        'dims': [round(k, 4), round(k, 4), round(kz, 4)], 'pos': [0, f.y(cy), f.z(cx)], 'rot': rot, 'importance': importance,
        'descriptor': {'torusTubeRatio': round(ratio, 4)},
        'topologyRationale': 'Moulded ring: torus sized from its traced inner and outer radius.',
    }


def nose_z(f: Frame, pid: str, x0: float, x1: float, cy: float, r_px: float, material: str, *, parent: str = 'root') -> dict[str, Any]:
    """Rounded nose cone pointing along +Z: a lathe dome turned onto the gun axis."""
    length = f.m(x1 - x0)
    r = f.m(r_px)
    prof = [[0.5, -0.5], [0.49, -0.3], [0.44, -0.1], [0.34, 0.12], [0.2, 0.32], [0.07, 0.46], [0.0, 0.5]]
    return {
        'id': pid, 'level': 'meso', 'role': 'detail', 'parent': parent, 'primitive': 'lathe', 'material': material,
        'dims': [2 * r, length, 2 * r], 'pos': [0, f.y(cy), round(f.z(x0) + length / 2, 4)], 'rot': [HALF_PI, 0, 0],
        'descriptor': {'latheProfile': {'points': prof, 'segments': 24}},
        'topologyRationale': 'Bullet-shaped nose: lathe profile rotated onto the gun axis.', 'importance': 0.85,
    }


def blob(f: Frame, pid: str, cx: float, cy: float, rz_px: float, ry_px: float, rx_m: float, material: str, *,
         x: float = 0.0, parent: str = 'root', level: str = 'micro', importance: float = 0.5) -> dict[str, Any]:
    return {
        'id': pid, 'level': level, 'role': 'detail', 'parent': parent, 'primitive': 'ellipsoid', 'material': material,
        'dims': [rx_m, 2 * f.m(ry_px), 2 * f.m(rz_px)], 'pos': [x, f.y(cy), f.z(cx)], 'importance': importance,
    }


LIGHTING = [
    {'id': 'key', 'type': 'area/soft box', 'direction': 'upper front-left', 'evidence': 'broad speculars along the top edges', 'intensity': 'high'},
    {'id': 'fill', 'type': 'soft fill', 'direction': 'front-right', 'evidence': 'undersides stay mid-value', 'intensity': 'medium'},
    {'id': 'rim', 'type': 'faint rim', 'direction': 'behind', 'evidence': 'slight lift on the lower silhouette', 'intensity': 'low'},
    {'id': 'environment', 'type': 'neutral grey studio sweep', 'evidence': 'background ~#C9CDD3', 'notes': 'Review renders use ACES filmic tone mapping at exposure 1.0; the game uses a toon ramp.'},
    {'id': 'ground', 'type': 'contact shadow', 'evidence': 'no ground plane in the reference', 'notes': 'Game uses a directional shadow map and ambient occlusion contact darkening.'},
]

PASS_ORDER = ['blockout', 'structural-pass', 'form-refinement', 'material-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass']


def material(mid: str, color: str, evidence: str, roughness: float = 0.25, **extra: Any) -> dict[str, Any]:
    return {'id': mid, 'color': color, 'roughness': roughness, 'evidence': evidence, **extra}


def build_gun_model(*, name: str, parts: list[dict[str, Any]], materials: list[dict[str, Any]],
                    details: list[dict[str, Any]], signature: dict[str, Any], palette: str, shape: str,
                    blockout_ids: list[str], length_m: float, assumptions: list[str]) -> dict[str, Any]:
    root = {'id': 'root', 'level': 'macro', 'role': 'root', 'parent': None, 'primitive': 'box', 'dims': [0.01, 0.01, 0.01],
            'material': 'hidden', 'importance': 0.1, 'animationRole': 'root-motion',
            'topologyRationale': 'Invisible pivot at the grip top; the hero mitt socket holds this point.',
            'sockets': [{'id': 'muzzle', 'localPosition': [0, 0, length_m], 'localRotation': [0, 0, 0], 'purpose': 'muzzle flash and bullet origin'}]}
    # Two feature groups every concept shows: the rolled edge on the main moulding and the grip taper.
    parts = [dict(p) for p in parts]
    parts[0]['localFeatures'] = parts[0].get('localFeatures', []) + [
        {'id': 'edge-roundover', 'kind': 'bevel', 'description': 'rolled moulded edges that catch a soft highlight along the outline',
         'evidenceRef': 'detail-inventory/zone-r1c1.png'}]
    for p in parts:
        if p['id'] in ('grip', 'stock', 'fore-grip') and p['id'] != parts[0]['id']:
            p['localFeatures'] = p.get('localFeatures', []) + [
                {'id': f"{p['id']}-taper", 'kind': 'contour', 'description': 'narrows toward its lower end',
                 'evidenceRef': 'detail-inventory/zone-r2c0.png'}]
            break
    mats = [{'id': 'hidden', 'color': '#000000', 'roughness': 1.0, 'materialClass': 'unknown', 'finish': 'none'}] + materials
    # The first material carries the contact-darkening override the material-pass gate asks for.
    mats[1] = {**mats[1], 'localOverrides': [
        {'id': 'seam-contact-ao', 'region': 'where parts meet (grip root, barrel mount)', 'albedoMultiplier': 0.85,
         'evidenceRef': 'detail-inventory/zone-r1c1.png', 'notes': 'soft contact darkening at moulded seams'}]}
    return {
        'details': details,
        'lightingFromPhoto': LIGHTING,
        'unknowns': [],
        'passOrder': PASS_ORDER,
        'materials': mats,
        'parts': [root] + parts,
        'passComponents': {'blockout': ['root'] + blockout_ids, 'structural-pass': ['root'] + blockout_ids},
        'passGoals': {
            'blockout': ('Match the side-profile silhouette and the main masses.', [f'{name} profile and proportions match the reference side view']),
            'structural-pass': ('Lock the part hierarchy and the muzzle socket.', ['Every part is a named pivot; grip-top origin; muzzle socket on the barrel axis']),
            'form-refinement': ('Add rings, triggers, panels and small details.', ['Small details sit where the reference shows them']),
        },
        'featureReviewTargets': [
            {'id': 'profile-silhouette', 'name': 'Side-profile silhouette and proportions', 'tier': 'critical',
             'passIds': ['blockout', 'structural-pass'], 'minimumScore': 0.78, 'mustPass': True,
             'componentRefs': blockout_ids[:4], 'evidenceRefs': ['full-object']},
            signature,
            {'id': 'palette', 'name': palette, 'tier': 'important', 'passIds': ['material-pass'], 'minimumScore': 0.7,
             'mustPass': False, 'componentRefs': blockout_ids[:2], 'evidenceRefs': ['full-object']},
        ],
        'silhouette': {'boundingShape': shape, 'aspectRatios': [], 'symmetry': 'bilateral across the barrel plane',
                       'dominantCurves': ['grip rake', 'rounded body corners'], 'negativeSpaces': ['trigger guard opening'],
                       'landmarks': ['grip top (origin)', 'muzzle']},
        'coordinateFrame': {'front': '+Z (muzzle)', 'up': '+Y', 'units': 'meters', 'scaleReference': f'overall length {length_m} m'},
        'performanceBudget': {'qualityPriority': 'runtime', 'targetTriangles': 3000, 'maxDrawCalls': 16, 'textureSize': 0, 'fpsTarget': 60,
                              'optimizationPolicy': 'Up to 9 held guns plus pickups on screen.'},
        'assumptions': ['Resolved unknowns (single side view): see risks.', 'Both sides of the gun are mirror images.'] + assumptions,
        'risks': ['Single side view: thickness across the gun is inferred (confidence 0.6).'],
        'repetitionSystems': [{'id': 'side-mirror', 'type': 'mirror', 'axis': 'x', 'members': ['side-panel (one slab, proud of both faces)'],
                               'notes': 'Side panel repeats on both faces.'}],
        'rig': {'version': '1.0', 'bindPose': 'rest', 'forward': '+Z', 'bones': [], 'posedJoints': {}, 'notes': 'Rigid prop.'},
    }


# ---------- upright utilities (front view: image x -> model X, image y -> model Y) ----------

class FrontFrame:
    """Front-view tracing frame: origin at the bottom centre of the object."""

    def __init__(self, metres_per_px: float, center_x: float, bottom_y: float):
        self.s = metres_per_px
        self.cx, self.by = center_x, bottom_y

    def x(self, px: float) -> float:
        return round((px - self.cx) * self.s, 4)

    def y(self, py: float) -> float:
        return round((self.by - py) * self.s, 4)

    def m(self, px: float) -> float:
        return round(px * self.s, 4)


def lathe_y(f: FrontFrame, pid: str, profile_px: list[tuple[float, float]], material: str, *, level: str = 'macro',
            importance: float = 0.8, segments: int = 28, features: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Round body around the vertical axis. profile_px: (radius px, image y) pairs, bottom to top."""
    ys = [f.y(py) for _, py in profile_px]
    rmax = max(r for r, _ in profile_px) or 1
    y0, y1 = min(ys), max(ys)
    h = max(1e-4, y1 - y0)
    pts = [[round(0.5 * r / rmax, 4), round((f.y(py) - y0) / h - 0.5, 4)] for r, py in profile_px]
    w = 2 * f.m(rmax)
    return {
        'id': pid, 'level': level, 'role': 'body', 'parent': 'root', 'primitive': 'lathe', 'material': material,
        'dims': [w, round(h, 4), w], 'pos': [0, round((y0 + y1) / 2, 4), 0],
        'descriptor': {'latheProfile': {'points': pts, 'segments': segments}},
        'topologyRationale': 'Round moulded body traced from the front silhouette and spun around the vertical axis.',
        'importance': importance, 'localFeatures': features or [],
    }


def ring_xy(f: FrontFrame, pid: str, cx: float, cy: float, outer_px: float, inner_px: float, depth_m: float, material: str,
            *, level: str = 'meso', importance: float = 0.6, horizontal: bool = False) -> dict[str, Any]:
    """Torus. Default faces the viewer (ring pull); horizontal=True lies flat around the vertical axis (bands)."""
    outer, inner = f.m(outer_px), f.m(inner_px)
    big_r = (outer + inner) / 2
    tube = (outer - inner) / 2
    ratio = tube / big_r
    k = outer / (0.45 * (1 + ratio))
    kz = depth_m / (2 * 0.45 * ratio)
    return {
        'id': pid, 'level': level, 'role': 'detail', 'parent': 'root', 'primitive': 'torus', 'material': material,
        'dims': [round(k, 4), round(k, 4), round(kz, 4)], 'pos': [f.x(cx), f.y(cy), 0],
        'rot': [HALF_PI, 0, 0] if horizontal else [0, 0, 0], 'importance': importance,
        'descriptor': {'torusTubeRatio': round(ratio, 4)},
        'topologyRationale': 'Moulded ring: torus sized from its traced inner and outer radius.',
    }


def slab_xy(f: FrontFrame, pid: str, outline_px: list[tuple[float, float]], thickness: float, material: str, *,
            level: str = 'meso', importance: float = 0.6, z: float = 0.0) -> dict[str, Any]:
    """Flat moulded part traced in the front view, extruded toward the viewer."""
    pts = [[f.x(x), f.y(y)] for x, y in outline_px]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {
        'id': pid, 'level': level, 'role': 'detail', 'parent': 'root', 'primitive': 'extrude', 'material': material,
        'dims': [round(max(xs) - min(xs), 4), round(max(ys) - min(ys), 4), round(thickness, 4)],
        'scale': [1, 1, 1], 'pos': [0, 0, round(z - thickness / 2, 4)],
        'descriptor': {'profile2D': {'points': pts, 'depth': round(thickness, 4)}},
        'topologyRationale': 'Flat moulded part traced from the front view and extruded across its thickness.',
        'importance': importance,
    }


def dot(f: FrontFrame, pid: str, cx: float, cy: float, r_px: float, z: float, material: str) -> dict[str, Any]:
    r = 2 * f.m(r_px)
    return {'id': pid, 'level': 'micro', 'role': 'detail', 'parent': 'root', 'primitive': 'ellipsoid', 'material': material,
            'dims': [r, r, r * 0.5], 'pos': [f.x(cx), f.y(cy), z], 'importance': 0.3}
