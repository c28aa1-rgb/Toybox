import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// Paint declared colour regions into the vertex-colour attribute.
//
// WHY VERTEX COLOUR AND NOT A TEXTURE. A subject whose identity is a set of flat colour regions
// with hard boundaries -- a blaze, a bib, a sock, a livery stripe -- needs those boundaries placed
// to a measured position. This pipeline emits code and no image assets, so a texture is not
// available to place them with; a single root-to-tip ramp cannot express a shaped region. Per-
// vertex colour driven by a declared shape is the remaining honest representation, and it is the
// one the boundary gate can measure BEFORE a browser is involved.
//
// The maths here is a transcription of forge/_shared/vertex_paint.py, and
// forge/tests/test_vertex_paint.py holds the two to the same numbers on a fixture. Editing one
// side without the other turns a gated boundary into an ungated one, which is exactly the failure
// the shared implementation exists to prevent.
//
// Regions are evaluated in the component's own local space AFTER its real dimensions have been
// applied to the vertex data, so every coordinate below is in the same units as the component's
// measured dimensions rather than in a unit cube.
type VertexPaintRegion = {
  id: string;
  kind: 'axis-band' | 'ellipsoid' | 'tapered-capsule';
  color: string;
  softness: number;
  axis?: 'x' | 'y' | 'z';
  min?: number;
  max?: number;
  center?: [number, number, number];
  radii?: [number, number, number];
  start?: [number, number, number];
  end?: [number, number, number];
  startRadius?: number;
  endRadius?: number;
};

function vertexPaintSmoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge1 ? 0 : 1;
  let t = (value - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function vertexPaintSignedDistance(
  region: VertexPaintRegion,
  x: number,
  y: number,
  z: number,
): number {
  if (region.kind === 'axis-band') {
    const value = region.axis === 'x' ? x : region.axis === 'z' ? z : y;
    const low = region.min as number;
    const high = region.max as number;
    if (value < low) return low - value;
    if (value > high) return value - high;
    return -Math.min(value - low, high - value);
  }
  if (region.kind === 'ellipsoid') {
    const [cx, cy, cz] = region.center as [number, number, number];
    const [rx, ry, rz] = region.radii as [number, number, number];
    const q = Math.sqrt(
      ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2,
    );
    return (q - 1) * Math.min(rx, ry, rz);
  }
  const [ax, ay, az] = region.start as [number, number, number];
  const [bx, by, bz] = region.end as [number, number, number];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const denominator = abx * abx + aby * aby + abz * abz;
  let t = denominator > 0
    ? ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / denominator
    : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const distance = Math.sqrt(
    (x - (ax + abx * t)) ** 2 + (y - (ay + aby * t)) ** 2 + (z - (az + abz * t)) ** 2,
  );
  const startRadius = region.startRadius as number;
  const endRadius = region.endRadius as number;
  return distance - (startRadius + (endRadius - startRadius) * t);
}

function vertexPaintWeight(region: VertexPaintRegion, x: number, y: number, z: number): number {
  const distance = vertexPaintSignedDistance(region, x, y, z);
  if (region.softness <= 0) return distance <= 0 ? 1 : 0;
  return 1 - vertexPaintSmoothstep(-region.softness * 0.5, region.softness * 0.5, distance);
}

function applyVertexPaint(
  geometry: THREE.BufferGeometry,
  baseColor: string,
  regions: VertexPaintRegion[],
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const values = new Float32Array(position.count * 3);
  const base = new THREE.Color(baseColor);
  const target = new THREE.Color();
  const mixed = new THREE.Color();
  const regionColors = regions.map((region) => new THREE.Color(region.color));

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    mixed.copy(base);
    for (let r = 0; r < regions.length; r += 1) {
      const weight = vertexPaintWeight(regions[r], x, y, z);
      if (weight <= 0) continue;
      target.copy(regionColors[r]);
      mixed.lerp(target, weight);
    }
    values[i * 3] = mixed.r;
    values[i * 3 + 1] = mixed.g;
    values[i * 3 + 2] = mixed.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
}

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Echo
// Sculpt build pass: feature-placement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createEchoModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Echo";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "hidden", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000", "#000000"], "samplingNotes": "Solid albedo sampled from the de-lit reference region; value changes in the image are shading, not paint."}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 1.0, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "unknown", "finishStyle": "none"},
    options
  );
  materialMap["body-plastic"] = createSculptMaterial(
    "body-plastic",
    {"id": "body-plastic", "name": "body-plastic", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#FF8A1F", "color": "#FF8A1F", "albedo": {"dominant": "#FF8A1F", "secondary": ["#D9751A", "#FF9822"], "samplingNotes": "albedo-samples.json body forehead median; prompt palette #FF8A1F"}, "colorVariation": {"palette": ["#FF8A1F"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "mitt-contact-ao", "region": "body surface under and behind each mitt", "albedoMultiplier": 0.82, "roughness": 0.3, "evidenceRef": "detail-inventory/zone-r1c0.png", "notes": "soft contact darkening where the mitt overlaps the body"}, {"id": "base-contact-ao", "region": "lowest 6% of the body where it sits on the feet", "albedoMultiplier": 0.85, "evidenceRef": "detail-inventory/zone-r2c1.png", "notes": "contact shadow band at the body base"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["eye-white"] = createSculptMaterial(
    "eye-white",
    {"id": "eye-white", "name": "eye-white", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F6F4EE", "color": "#F6F4EE", "albedo": {"dominant": "#F6F4EE", "secondary": ["#D1CFCA", "#FFFFFF"], "samplingNotes": "zone-r1c1 sclera"}, "colorVariation": {"palette": ["#F6F4EE"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.2, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["pupil-ink"] = createSculptMaterial(
    "pupil-ink",
    {"id": "pupil-ink", "name": "pupil-ink", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#1E1414", "color": "#1E1414", "albedo": {"dominant": "#1E1414", "secondary": ["#1A1111", "#211616"], "samplingNotes": "zone-r1c1 pupils"}, "colorVariation": {"palette": ["#1E1414"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.15, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["catchlight"] = createSculptMaterial(
    "catchlight",
    {"id": "catchlight", "name": "catchlight", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#FFFFFF", "color": "#FFFFFF", "albedo": {"dominant": "#FFFFFF", "secondary": ["#D9D9D9", "#FFFFFF"], "samplingNotes": "zone-r1c1 pupil highlights"}, "colorVariation": {"palette": ["#FFFFFF"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.1, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "emissive": {"color": "#FFFFFF", "intensity": 0.8}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["violet-plastic"] = createSculptMaterial(
    "violet-plastic",
    {"id": "violet-plastic", "name": "violet-plastic", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4A2F78", "color": "#4A2F78", "albedo": {"dominant": "#4A2F78", "secondary": ["#3F2866", "#513484"], "samplingNotes": "zone-r2c0 / r2c2 feet"}, "colorVariation": {"palette": ["#4A2F78"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["dish-orange"] = createSculptMaterial(
    "dish-orange",
    {"id": "dish-orange", "name": "dish-orange", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#FF8A1F", "color": "#FF8A1F", "albedo": {"dominant": "#FF8A1F", "secondary": ["#D9751A", "#FF9822"], "samplingNotes": "zone-r0c0 / r0c2 dish rims"}, "colorVariation": {"palette": ["#FF8A1F"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "doubleSided": true, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["dish-cream"] = createSculptMaterial(
    "dish-cream",
    {"id": "dish-cream", "name": "dish-cream", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F3E3CC", "color": "#F3E3CC", "albedo": {"dominant": "#F3E3CC", "secondary": ["#CFC1AD", "#FFFAE0"], "samplingNotes": "zone-r0c0 dish inner face"}, "colorVariation": {"palette": ["#F3E3CC"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["phone-blue"] = createSculptMaterial(
    "phone-blue",
    {"id": "phone-blue", "name": "phone-blue", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6FB0F0", "color": "#6FB0F0", "albedo": {"dominant": "#6FB0F0", "secondary": ["#5E96CC", "#7AC2FF"], "samplingNotes": "zone-r1c0 headphone cup"}, "colorVariation": {"palette": ["#6FB0F0"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["phone-dark"] = createSculptMaterial(
    "phone-dark",
    {"id": "phone-dark", "name": "phone-dark", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#3F7FDB", "color": "#3F7FDB", "albedo": {"dominant": "#3F7FDB", "secondary": ["#366CBA", "#458CF1"], "samplingNotes": "zone-r1c2 headphone cap"}, "colorVariation": {"palette": ["#3F7FDB"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["wing-cream"] = createSculptMaterial(
    "wing-cream",
    {"id": "wing-cream", "name": "wing-cream", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F2DEC4", "color": "#F2DEC4", "albedo": {"dominant": "#F2DEC4", "secondary": ["#CEBDA7", "#FFF4D8"], "samplingNotes": "zone-r1c2 wing membrane"}, "colorVariation": {"palette": ["#F2DEC4"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "doubleSided": true, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 0.1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot for whole-figure motion.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.01, 0.01, 0.01]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.01, 0.01, 0.01);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 0.1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot for whole-figure motion.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.01, 0.01, 0.01]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_body_1 = makeAttachmentEndpoint(null);
  const node_body_1 = new THREE.Group();
  node_body_1.name = "Body__pivot";
  node_body_1.scale.set(1, 1, 1);
  if (endpoint_body_1) {
    node_body_1.position.copy(endpoint_body_1.start);
    node_body_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_body_1.position.set(0.0, 0.8, 0.0);
    node_body_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_body_1.userData.sculptComponent = {"id": "body", "name": "Body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Head and torso are one continuous egg volume; a lathe profile gives the bottom-heavy taper an ellipsoid cannot.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.2324, -0.4792], [0.2981, -0.4583], [0.3423, -0.4375], [0.3754, -0.4167], [0.4015, -0.3958], [0.4225, -0.375], [0.4397, -0.3542], [0.4538, -0.3333], [0.4653, -0.3125], [0.4746, -0.2917], [0.4821, -0.2708], [0.4879, -0.25], [0.4924, -0.2292], [0.4956, -0.2083], [0.4978, -0.1875], [0.4992, -0.1667], [0.4998, -0.1458], [0.5, -0.125], [0.4993, -0.1042], [0.4984, -0.0833], [0.4973, -0.0625], [0.496, -0.0417], [0.4944, -0.0208], [0.4925, 0.0], [0.4903, 0.0208], [0.4877, 0.0417], [0.4847, 0.0625], [0.4812, 0.0833], [0.4772, 0.1042], [0.4728, 0.125], [0.4677, 0.1458], [0.462, 0.1667], [0.4557, 0.1875], [0.4485, 0.2083], [0.4406, 0.2292], [0.4317, 0.25], [0.4219, 0.2708], [0.4108, 0.2917], [0.3985, 0.3125], [0.3846, 0.3333], [0.3689, 0.3542], [0.351, 0.375], [0.3303, 0.3958], [0.306, 0.4167], [0.2764, 0.4375], [0.2386, 0.4583], [0.1844, 0.4792], [0.0, 0.5]], "segments": 56}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.94, "height": 1.25, "depth": 0.8, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.8, 0], "rotation": [0, 0, 0], "scale": [0.94, 1.25, 0.8]}, "actionProfile": {"animationRole": "squash", "pivot": {"mode": "bottom", "localPosition": [0, -0.625, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}}, "material": "body-plastic", "materialLayers": ["body-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belly-seam", "kind": "seam", "description": "flush colour boundary of the cream belly", "evidenceRef": "detail-inventory/zone-r2c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}, "vertexPaint": {"baseColor": "#FF8A1F", "regions": [{"id": "belly", "kind": "ellipsoid", "color": "#F3E6CC", "softness": 0.02, "center": [0.0, -0.28, 0.4], "radii": [0.34, 0.4, 0.26]}]}};
  node_body_1.userData.actionProfile = {"animationRole": "squash", "pivot": {"mode": "bottom", "localPosition": [0, -0.625, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}};
  (nodes["root"] ?? root).add(node_body_1);
  nodes["body"] = node_body_1;
  const mesh_body_1Geometry = endpoint_body_1
    ? new THREE.CylinderGeometry(endpoint_body_1.endRadius, endpoint_body_1.baseRadius, endpoint_body_1.length, 16, 6)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.2324, -0.4792], [0.2981, -0.4583], [0.3423, -0.4375], [0.3754, -0.4167], [0.4015, -0.3958], [0.4225, -0.375], [0.4397, -0.3542], [0.4538, -0.3333], [0.4653, -0.3125], [0.4746, -0.2917], [0.4821, -0.2708], [0.4879, -0.25], [0.4924, -0.2292], [0.4956, -0.2083], [0.4978, -0.1875], [0.4992, -0.1667], [0.4998, -0.1458], [0.5, -0.125], [0.4993, -0.1042], [0.4984, -0.0833], [0.4973, -0.0625], [0.496, -0.0417], [0.4944, -0.0208], [0.4925, 0.0], [0.4903, 0.0208], [0.4877, 0.0417], [0.4847, 0.0625], [0.4812, 0.0833], [0.4772, 0.1042], [0.4728, 0.125], [0.4677, 0.1458], [0.462, 0.1667], [0.4557, 0.1875], [0.4485, 0.2083], [0.4406, 0.2292], [0.4317, 0.25], [0.4219, 0.2708], [0.4108, 0.2917], [0.3985, 0.3125], [0.3846, 0.3333], [0.3689, 0.3542], [0.351, 0.375], [0.3303, 0.3958], [0.306, 0.4167], [0.2764, 0.4375], [0.2386, 0.4583], [0.1844, 0.4792], [0.0, 0.5]], "segments": 56});
  if (!endpoint_body_1) {
    mesh_body_1Geometry.scale(0.94, 1.25, 0.8);
  }
  applyVertexPaint(mesh_body_1Geometry, "#FF8A1F", [{"id": "belly", "kind": "ellipsoid", "color": "#F3E6CC", "softness": 0.02, "center": [0.0, -0.28, 0.4], "radii": [0.34, 0.4, 0.26]}]);
  const mesh_body_1 = new THREE.Mesh(
    mesh_body_1Geometry,
    materialMap["body-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_1.name = "Body";
  mesh_body_1.material = mesh_body_1.material.clone();
  mesh_body_1.material.vertexColors = true;
  (mesh_body_1.material as THREE.MeshPhysicalMaterial).color.setRGB(1, 1, 1);
  if (endpoint_body_1) {
    mesh_body_1.position.copy(endpoint_body_1.midpoint);
    mesh_body_1.quaternion.copy(endpoint_body_1.quaternion);
  }
  mesh_body_1.castShadow = options.castShadow ?? true;
  mesh_body_1.receiveShadow = options.receiveShadow ?? true;
  mesh_body_1.userData.sculptComponent = {"id": "body", "name": "Body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Head and torso are one continuous egg volume; a lathe profile gives the bottom-heavy taper an ellipsoid cannot.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.2324, -0.4792], [0.2981, -0.4583], [0.3423, -0.4375], [0.3754, -0.4167], [0.4015, -0.3958], [0.4225, -0.375], [0.4397, -0.3542], [0.4538, -0.3333], [0.4653, -0.3125], [0.4746, -0.2917], [0.4821, -0.2708], [0.4879, -0.25], [0.4924, -0.2292], [0.4956, -0.2083], [0.4978, -0.1875], [0.4992, -0.1667], [0.4998, -0.1458], [0.5, -0.125], [0.4993, -0.1042], [0.4984, -0.0833], [0.4973, -0.0625], [0.496, -0.0417], [0.4944, -0.0208], [0.4925, 0.0], [0.4903, 0.0208], [0.4877, 0.0417], [0.4847, 0.0625], [0.4812, 0.0833], [0.4772, 0.1042], [0.4728, 0.125], [0.4677, 0.1458], [0.462, 0.1667], [0.4557, 0.1875], [0.4485, 0.2083], [0.4406, 0.2292], [0.4317, 0.25], [0.4219, 0.2708], [0.4108, 0.2917], [0.3985, 0.3125], [0.3846, 0.3333], [0.3689, 0.3542], [0.351, 0.375], [0.3303, 0.3958], [0.306, 0.4167], [0.2764, 0.4375], [0.2386, 0.4583], [0.1844, 0.4792], [0.0, 0.5]], "segments": 56}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.94, "height": 1.25, "depth": 0.8, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.8, 0], "rotation": [0, 0, 0], "scale": [0.94, 1.25, 0.8]}, "actionProfile": {"animationRole": "squash", "pivot": {"mode": "bottom", "localPosition": [0, -0.625, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}}, "material": "body-plastic", "materialLayers": ["body-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belly-seam", "kind": "seam", "description": "flush colour boundary of the cream belly", "evidenceRef": "detail-inventory/zone-r2c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}, "vertexPaint": {"baseColor": "#FF8A1F", "regions": [{"id": "belly", "kind": "ellipsoid", "color": "#F3E6CC", "softness": 0.02, "center": [0.0, -0.28, 0.4], "radii": [0.34, 0.4, 0.26]}]}};
  node_body_1.add(mesh_body_1);
  meshes["body"] = mesh_body_1;
  colliders["body"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_body_1);

  const endpoint_eye_l_2 = makeAttachmentEndpoint(null);
  const node_eye_l_2 = new THREE.Group();
  node_eye_l_2.name = "Eye L__pivot";
  node_eye_l_2.scale.set(1, 1, 1);
  if (endpoint_eye_l_2) {
    node_eye_l_2.position.copy(endpoint_eye_l_2.start);
    node_eye_l_2.rotation.set(-0.12, 0.38, 0.0);
  } else {
    node_eye_l_2.position.set(0.15, 0.23, 0.35);
    node_eye_l_2.rotation.set(-0.12, 0.38, 0.0);
  }
  node_eye_l_2.userData.sculptComponent = {"id": "eye-l", "name": "Eye L", "level": "meso", "role": "detail", "importance": 0.95, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.29, "height": 0.32, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.15, 0.23, 0.35], "rotation": [-0.12, 0.38, 0.0], "scale": [0.29, 0.32, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-white"}}, "material": "eye-white", "materialLayers": ["eye-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(246, 244, 238, 1.0)", "secondaryAlbedo": "rgba(209, 207, 202, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_eye_l_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-white"}};
  (nodes["body"] ?? root).add(node_eye_l_2);
  nodes["eye-l"] = node_eye_l_2;
  const mesh_eye_l_2Geometry = endpoint_eye_l_2
    ? new THREE.CylinderGeometry(endpoint_eye_l_2.endRadius, endpoint_eye_l_2.baseRadius, endpoint_eye_l_2.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye_l_2) {
    mesh_eye_l_2Geometry.scale(0.29, 0.32, 0.09);
  }
  const mesh_eye_l_2 = new THREE.Mesh(
    mesh_eye_l_2Geometry,
    materialMap["eye-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_l_2.name = "Eye L";
  if (endpoint_eye_l_2) {
    mesh_eye_l_2.position.copy(endpoint_eye_l_2.midpoint);
    mesh_eye_l_2.quaternion.copy(endpoint_eye_l_2.quaternion);
  }
  mesh_eye_l_2.castShadow = options.castShadow ?? true;
  mesh_eye_l_2.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_l_2.userData.sculptComponent = {"id": "eye-l", "name": "Eye L", "level": "meso", "role": "detail", "importance": 0.95, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.29, "height": 0.32, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.15, 0.23, 0.35], "rotation": [-0.12, 0.38, 0.0], "scale": [0.29, 0.32, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-white"}}, "material": "eye-white", "materialLayers": ["eye-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(246, 244, 238, 1.0)", "secondaryAlbedo": "rgba(209, 207, 202, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_eye_l_2.add(mesh_eye_l_2);
  meshes["eye-l"] = mesh_eye_l_2;
  colliders["eye-l"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["eye-l"] ??= [];
  destructionGroups["eye-l"].push(node_eye_l_2);

  const endpoint_eye_r_3 = makeAttachmentEndpoint(null);
  const node_eye_r_3 = new THREE.Group();
  node_eye_r_3.name = "Eye R__pivot";
  node_eye_r_3.scale.set(1, 1, 1);
  if (endpoint_eye_r_3) {
    node_eye_r_3.position.copy(endpoint_eye_r_3.start);
    node_eye_r_3.rotation.set(-0.12, -0.38, -0.0);
  } else {
    node_eye_r_3.position.set(-0.15, 0.23, 0.35);
    node_eye_r_3.rotation.set(-0.12, -0.38, -0.0);
  }
  node_eye_r_3.userData.sculptComponent = {"id": "eye-r", "name": "Eye R", "level": "meso", "role": "detail", "importance": 0.95, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.29, "height": 0.32, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.15, 0.23, 0.35], "rotation": [-0.12, -0.38, -0.0], "scale": [0.29, 0.32, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-white"}}, "material": "eye-white", "materialLayers": ["eye-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(246, 244, 238, 1.0)", "secondaryAlbedo": "rgba(209, 207, 202, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_eye_r_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-white"}};
  (nodes["body"] ?? root).add(node_eye_r_3);
  nodes["eye-r"] = node_eye_r_3;
  const mesh_eye_r_3Geometry = endpoint_eye_r_3
    ? new THREE.CylinderGeometry(endpoint_eye_r_3.endRadius, endpoint_eye_r_3.baseRadius, endpoint_eye_r_3.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_eye_r_3) {
    mesh_eye_r_3Geometry.scale(0.29, 0.32, 0.09);
  }
  const mesh_eye_r_3 = new THREE.Mesh(
    mesh_eye_r_3Geometry,
    materialMap["eye-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_r_3.name = "Eye R";
  if (endpoint_eye_r_3) {
    mesh_eye_r_3.position.copy(endpoint_eye_r_3.midpoint);
    mesh_eye_r_3.quaternion.copy(endpoint_eye_r_3.quaternion);
  }
  mesh_eye_r_3.castShadow = options.castShadow ?? true;
  mesh_eye_r_3.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_r_3.userData.sculptComponent = {"id": "eye-r", "name": "Eye R", "level": "meso", "role": "detail", "importance": 0.95, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.29, "height": 0.32, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.15, 0.23, 0.35], "rotation": [-0.12, -0.38, -0.0], "scale": [0.29, 0.32, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "eye-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eye-white"}}, "material": "eye-white", "materialLayers": ["eye-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(246, 244, 238, 1.0)", "secondaryAlbedo": "rgba(209, 207, 202, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_eye_r_3.add(mesh_eye_r_3);
  meshes["eye-r"] = mesh_eye_r_3;
  colliders["eye-r"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["eye-r"] ??= [];
  destructionGroups["eye-r"].push(node_eye_r_3);

  const endpoint_pupil_l_4 = makeAttachmentEndpoint(null);
  const node_pupil_l_4 = new THREE.Group();
  node_pupil_l_4.name = "Pupil L__pivot";
  node_pupil_l_4.scale.set(1, 1, 1);
  if (endpoint_pupil_l_4) {
    node_pupil_l_4.position.copy(endpoint_pupil_l_4.start);
    node_pupil_l_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pupil_l_4.position.set(-0.03, 0.015, 0.035);
    node_pupil_l_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_pupil_l_4.userData.sculptComponent = {"id": "pupil-l", "name": "Pupil L", "level": "micro", "role": "detail", "importance": 0.9, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eye-l", "attachment": null, "dimensions": {"width": 0.13, "height": 0.15, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.03, 0.015, 0.035], "rotation": [0, 0, 0], "scale": [0.13, 0.15, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pupil-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pupil-ink"}}, "material": "pupil-ink", "materialLayers": ["pupil-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 20, 20, 1.0)", "secondaryAlbedo": "rgba(26, 17, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_pupil_l_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pupil-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pupil-ink"}};
  (nodes["eye-l"] ?? root).add(node_pupil_l_4);
  nodes["pupil-l"] = node_pupil_l_4;
  const mesh_pupil_l_4Geometry = endpoint_pupil_l_4
    ? new THREE.CylinderGeometry(endpoint_pupil_l_4.endRadius, endpoint_pupil_l_4.baseRadius, endpoint_pupil_l_4.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_pupil_l_4) {
    mesh_pupil_l_4Geometry.scale(0.13, 0.15, 0.04);
  }
  const mesh_pupil_l_4 = new THREE.Mesh(
    mesh_pupil_l_4Geometry,
    materialMap["pupil-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pupil_l_4.name = "Pupil L";
  if (endpoint_pupil_l_4) {
    mesh_pupil_l_4.position.copy(endpoint_pupil_l_4.midpoint);
    mesh_pupil_l_4.quaternion.copy(endpoint_pupil_l_4.quaternion);
  }
  mesh_pupil_l_4.castShadow = options.castShadow ?? true;
  mesh_pupil_l_4.receiveShadow = options.receiveShadow ?? true;
  mesh_pupil_l_4.userData.sculptComponent = {"id": "pupil-l", "name": "Pupil L", "level": "micro", "role": "detail", "importance": 0.9, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eye-l", "attachment": null, "dimensions": {"width": 0.13, "height": 0.15, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.03, 0.015, 0.035], "rotation": [0, 0, 0], "scale": [0.13, 0.15, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pupil-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pupil-ink"}}, "material": "pupil-ink", "materialLayers": ["pupil-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 20, 20, 1.0)", "secondaryAlbedo": "rgba(26, 17, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_pupil_l_4.add(mesh_pupil_l_4);
  meshes["pupil-l"] = mesh_pupil_l_4;
  colliders["pupil-l"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["pupil-l"] ??= [];
  destructionGroups["pupil-l"].push(node_pupil_l_4);

  const endpoint_pupil_r_5 = makeAttachmentEndpoint(null);
  const node_pupil_r_5 = new THREE.Group();
  node_pupil_r_5.name = "Pupil R__pivot";
  node_pupil_r_5.scale.set(1, 1, 1);
  if (endpoint_pupil_r_5) {
    node_pupil_r_5.position.copy(endpoint_pupil_r_5.start);
    node_pupil_r_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pupil_r_5.position.set(0.03, 0.015, 0.035);
    node_pupil_r_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_pupil_r_5.userData.sculptComponent = {"id": "pupil-r", "name": "Pupil R", "level": "micro", "role": "detail", "importance": 0.9, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eye-r", "attachment": null, "dimensions": {"width": 0.13, "height": 0.15, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.03, 0.015, 0.035], "rotation": [0, 0, 0], "scale": [0.13, 0.15, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pupil-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pupil-ink"}}, "material": "pupil-ink", "materialLayers": ["pupil-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 20, 20, 1.0)", "secondaryAlbedo": "rgba(26, 17, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_pupil_r_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pupil-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pupil-ink"}};
  (nodes["eye-r"] ?? root).add(node_pupil_r_5);
  nodes["pupil-r"] = node_pupil_r_5;
  const mesh_pupil_r_5Geometry = endpoint_pupil_r_5
    ? new THREE.CylinderGeometry(endpoint_pupil_r_5.endRadius, endpoint_pupil_r_5.baseRadius, endpoint_pupil_r_5.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_pupil_r_5) {
    mesh_pupil_r_5Geometry.scale(0.13, 0.15, 0.04);
  }
  const mesh_pupil_r_5 = new THREE.Mesh(
    mesh_pupil_r_5Geometry,
    materialMap["pupil-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pupil_r_5.name = "Pupil R";
  if (endpoint_pupil_r_5) {
    mesh_pupil_r_5.position.copy(endpoint_pupil_r_5.midpoint);
    mesh_pupil_r_5.quaternion.copy(endpoint_pupil_r_5.quaternion);
  }
  mesh_pupil_r_5.castShadow = options.castShadow ?? true;
  mesh_pupil_r_5.receiveShadow = options.receiveShadow ?? true;
  mesh_pupil_r_5.userData.sculptComponent = {"id": "pupil-r", "name": "Pupil R", "level": "micro", "role": "detail", "importance": 0.9, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "eye-r", "attachment": null, "dimensions": {"width": 0.13, "height": 0.15, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.03, 0.015, 0.035], "rotation": [0, 0, 0], "scale": [0.13, 0.15, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pupil-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "pupil-ink"}}, "material": "pupil-ink", "materialLayers": ["pupil-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(30, 20, 20, 1.0)", "secondaryAlbedo": "rgba(26, 17, 17, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_pupil_r_5.add(mesh_pupil_r_5);
  meshes["pupil-r"] = mesh_pupil_r_5;
  colliders["pupil-r"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["pupil-r"] ??= [];
  destructionGroups["pupil-r"].push(node_pupil_r_5);

  const endpoint_catchlight_l_6 = makeAttachmentEndpoint(null);
  const node_catchlight_l_6 = new THREE.Group();
  node_catchlight_l_6.name = "Catchlight L__pivot";
  node_catchlight_l_6.scale.set(1, 1, 1);
  if (endpoint_catchlight_l_6) {
    node_catchlight_l_6.position.copy(endpoint_catchlight_l_6.start);
    node_catchlight_l_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_catchlight_l_6.position.set(0.02, 0.03, 0.016);
    node_catchlight_l_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_catchlight_l_6.userData.sculptComponent = {"id": "catchlight-l", "name": "Catchlight L", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pupil-l", "attachment": null, "dimensions": {"width": 0.032, "height": 0.032, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.02, 0.03, 0.016], "rotation": [0, 0, 0], "scale": [0.032, 0.032, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "catchlight-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "catchlight"}}, "material": "catchlight", "materialLayers": ["catchlight"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(217, 217, 217, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_catchlight_l_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "catchlight-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "catchlight"}};
  (nodes["pupil-l"] ?? root).add(node_catchlight_l_6);
  nodes["catchlight-l"] = node_catchlight_l_6;
  const mesh_catchlight_l_6Geometry = endpoint_catchlight_l_6
    ? new THREE.CylinderGeometry(endpoint_catchlight_l_6.endRadius, endpoint_catchlight_l_6.baseRadius, endpoint_catchlight_l_6.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_catchlight_l_6) {
    mesh_catchlight_l_6Geometry.scale(0.032, 0.032, 0.012);
  }
  const mesh_catchlight_l_6 = new THREE.Mesh(
    mesh_catchlight_l_6Geometry,
    materialMap["catchlight"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_catchlight_l_6.name = "Catchlight L";
  if (endpoint_catchlight_l_6) {
    mesh_catchlight_l_6.position.copy(endpoint_catchlight_l_6.midpoint);
    mesh_catchlight_l_6.quaternion.copy(endpoint_catchlight_l_6.quaternion);
  }
  mesh_catchlight_l_6.castShadow = options.castShadow ?? true;
  mesh_catchlight_l_6.receiveShadow = options.receiveShadow ?? true;
  mesh_catchlight_l_6.userData.sculptComponent = {"id": "catchlight-l", "name": "Catchlight L", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pupil-l", "attachment": null, "dimensions": {"width": 0.032, "height": 0.032, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.02, 0.03, 0.016], "rotation": [0, 0, 0], "scale": [0.032, 0.032, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "catchlight-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "catchlight"}}, "material": "catchlight", "materialLayers": ["catchlight"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(217, 217, 217, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_catchlight_l_6.add(mesh_catchlight_l_6);
  meshes["catchlight-l"] = mesh_catchlight_l_6;
  colliders["catchlight-l"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["catchlight-l"] ??= [];
  destructionGroups["catchlight-l"].push(node_catchlight_l_6);

  const endpoint_catchlight_r_7 = makeAttachmentEndpoint(null);
  const node_catchlight_r_7 = new THREE.Group();
  node_catchlight_r_7.name = "Catchlight R__pivot";
  node_catchlight_r_7.scale.set(1, 1, 1);
  if (endpoint_catchlight_r_7) {
    node_catchlight_r_7.position.copy(endpoint_catchlight_r_7.start);
    node_catchlight_r_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_catchlight_r_7.position.set(-0.02, 0.03, 0.016);
    node_catchlight_r_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_catchlight_r_7.userData.sculptComponent = {"id": "catchlight-r", "name": "Catchlight R", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pupil-r", "attachment": null, "dimensions": {"width": 0.032, "height": 0.032, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.02, 0.03, 0.016], "rotation": [0, 0, 0], "scale": [0.032, 0.032, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "catchlight-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "catchlight"}}, "material": "catchlight", "materialLayers": ["catchlight"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(217, 217, 217, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_catchlight_r_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "catchlight-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "catchlight"}};
  (nodes["pupil-r"] ?? root).add(node_catchlight_r_7);
  nodes["catchlight-r"] = node_catchlight_r_7;
  const mesh_catchlight_r_7Geometry = endpoint_catchlight_r_7
    ? new THREE.CylinderGeometry(endpoint_catchlight_r_7.endRadius, endpoint_catchlight_r_7.baseRadius, endpoint_catchlight_r_7.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_catchlight_r_7) {
    mesh_catchlight_r_7Geometry.scale(0.032, 0.032, 0.012);
  }
  const mesh_catchlight_r_7 = new THREE.Mesh(
    mesh_catchlight_r_7Geometry,
    materialMap["catchlight"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_catchlight_r_7.name = "Catchlight R";
  if (endpoint_catchlight_r_7) {
    mesh_catchlight_r_7.position.copy(endpoint_catchlight_r_7.midpoint);
    mesh_catchlight_r_7.quaternion.copy(endpoint_catchlight_r_7.quaternion);
  }
  mesh_catchlight_r_7.castShadow = options.castShadow ?? true;
  mesh_catchlight_r_7.receiveShadow = options.receiveShadow ?? true;
  mesh_catchlight_r_7.userData.sculptComponent = {"id": "catchlight-r", "name": "Catchlight R", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "pupil-r", "attachment": null, "dimensions": {"width": 0.032, "height": 0.032, "depth": 0.012, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.02, 0.03, 0.016], "rotation": [0, 0, 0], "scale": [0.032, 0.032, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "catchlight-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "catchlight"}}, "material": "catchlight", "materialLayers": ["catchlight"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 255, 255, 1.0)", "secondaryAlbedo": "rgba(217, 217, 217, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_catchlight_r_7.add(mesh_catchlight_r_7);
  meshes["catchlight-r"] = mesh_catchlight_r_7;
  colliders["catchlight-r"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["catchlight-r"] ??= [];
  destructionGroups["catchlight-r"].push(node_catchlight_r_7);

  const endpoint_hand_l_8 = makeAttachmentEndpoint(null);
  const node_hand_l_8 = new THREE.Group();
  node_hand_l_8.name = "Hand L__pivot";
  node_hand_l_8.scale.set(1, 1, 1);
  if (endpoint_hand_l_8) {
    node_hand_l_8.position.copy(endpoint_hand_l_8.start);
    node_hand_l_8.rotation.set(0.0, 0.0, 0.25);
  } else {
    node_hand_l_8.position.set(0.52, -0.22, 0.04);
    node_hand_l_8.rotation.set(0.0, 0.0, 0.25);
  }
  node_hand_l_8.userData.sculptComponent = {"id": "hand-l", "name": "Hand L", "level": "macro", "role": "hand", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.32, "height": 0.38, "depth": 0.32, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.52, -0.22, 0.04], "rotation": [0.0, 0.0, 0.25], "scale": [0.32, 0.38, 0.32]}, "actionProfile": {"animationRole": "sway", "pivot": {"mode": "top", "localPosition": [0, 0.13, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}}, "material": "body-plastic", "materialLayers": ["body-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_hand_l_8.userData.actionProfile = {"animationRole": "sway", "pivot": {"mode": "top", "localPosition": [0, 0.13, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}};
  (nodes["body"] ?? root).add(node_hand_l_8);
  nodes["hand-l"] = node_hand_l_8;
  const mesh_hand_l_8Geometry = endpoint_hand_l_8
    ? new THREE.CylinderGeometry(endpoint_hand_l_8.endRadius, endpoint_hand_l_8.baseRadius, endpoint_hand_l_8.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_hand_l_8) {
    mesh_hand_l_8Geometry.scale(0.32, 0.38, 0.32);
  }
  const mesh_hand_l_8 = new THREE.Mesh(
    mesh_hand_l_8Geometry,
    materialMap["body-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_l_8.name = "Hand L";
  if (endpoint_hand_l_8) {
    mesh_hand_l_8.position.copy(endpoint_hand_l_8.midpoint);
    mesh_hand_l_8.quaternion.copy(endpoint_hand_l_8.quaternion);
  }
  mesh_hand_l_8.castShadow = options.castShadow ?? true;
  mesh_hand_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_l_8.userData.sculptComponent = {"id": "hand-l", "name": "Hand L", "level": "macro", "role": "hand", "importance": 0.75, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.32, "height": 0.38, "depth": 0.32, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.52, -0.22, 0.04], "rotation": [0.0, 0.0, 0.25], "scale": [0.32, 0.38, 0.32]}, "actionProfile": {"animationRole": "sway", "pivot": {"mode": "top", "localPosition": [0, 0.13, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}}, "material": "body-plastic", "materialLayers": ["body-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_hand_l_8.add(mesh_hand_l_8);
  meshes["hand-l"] = mesh_hand_l_8;
  colliders["hand-l"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["hand-l"] ??= [];
  destructionGroups["hand-l"].push(node_hand_l_8);

  const endpoint_hand_r_9 = makeAttachmentEndpoint(null);
  const node_hand_r_9 = new THREE.Group();
  node_hand_r_9.name = "Hand R__pivot";
  node_hand_r_9.scale.set(1, 1, 1);
  if (endpoint_hand_r_9) {
    node_hand_r_9.position.copy(endpoint_hand_r_9.start);
    node_hand_r_9.rotation.set(0.0, -0.0, -0.25);
  } else {
    node_hand_r_9.position.set(-0.52, -0.22, 0.04);
    node_hand_r_9.rotation.set(0.0, -0.0, -0.25);
  }
  node_hand_r_9.userData.sculptComponent = {"id": "hand-r", "name": "Hand R", "level": "macro", "role": "hand", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.32, "height": 0.38, "depth": 0.32, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.52, -0.22, 0.04], "rotation": [0.0, -0.0, -0.25], "scale": [0.32, 0.38, 0.32]}, "actionProfile": {"animationRole": "aim", "pivot": {"mode": "top", "localPosition": [0, 0.13, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [{"id": "gun", "localPosition": [-0.02, -0.02, 0.12], "localRotation": [0, 0, 0], "purpose": "weapon grip"}], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}}, "material": "body-plastic", "materialLayers": ["body-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_hand_r_9.userData.actionProfile = {"animationRole": "aim", "pivot": {"mode": "top", "localPosition": [0, 0.13, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [{"id": "gun", "localPosition": [-0.02, -0.02, 0.12], "localRotation": [0, 0, 0], "purpose": "weapon grip"}], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}};
  (nodes["body"] ?? root).add(node_hand_r_9);
  nodes["hand-r"] = node_hand_r_9;
  const mesh_hand_r_9Geometry = endpoint_hand_r_9
    ? new THREE.CylinderGeometry(endpoint_hand_r_9.endRadius, endpoint_hand_r_9.baseRadius, endpoint_hand_r_9.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_hand_r_9) {
    mesh_hand_r_9Geometry.scale(0.32, 0.38, 0.32);
  }
  const mesh_hand_r_9 = new THREE.Mesh(
    mesh_hand_r_9Geometry,
    materialMap["body-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_r_9.name = "Hand R";
  if (endpoint_hand_r_9) {
    mesh_hand_r_9.position.copy(endpoint_hand_r_9.midpoint);
    mesh_hand_r_9.quaternion.copy(endpoint_hand_r_9.quaternion);
  }
  mesh_hand_r_9.castShadow = options.castShadow ?? true;
  mesh_hand_r_9.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_r_9.userData.sculptComponent = {"id": "hand-r", "name": "Hand R", "level": "macro", "role": "hand", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": null, "dimensions": {"width": 0.32, "height": 0.38, "depth": 0.32, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.52, -0.22, 0.04], "rotation": [0.0, -0.0, -0.25], "scale": [0.32, 0.38, 0.32]}, "actionProfile": {"animationRole": "aim", "pivot": {"mode": "top", "localPosition": [0, 0.13, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [{"id": "gun", "localPosition": [-0.02, -0.02, 0.12], "localRotation": [0, 0, 0], "purpose": "weapon grip"}], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hand-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body-plastic"}}, "material": "body-plastic", "materialLayers": ["body-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_hand_r_9.add(mesh_hand_r_9);
  meshes["hand-r"] = mesh_hand_r_9;
  colliders["hand-r"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["hand-r"] ??= [];
  destructionGroups["hand-r"].push(node_hand_r_9);
  const socket_hand_r_gun_0 = new THREE.Object3D();
  socket_hand_r_gun_0.name = "gun";
  socket_hand_r_gun_0.position.set(-0.02, -0.02, 0.12);
  socket_hand_r_gun_0.rotation.set(0.0, 0.0, 0.0);
  socket_hand_r_gun_0.userData.socket = {"id": "gun", "localPosition": [-0.02, -0.02, 0.12], "localRotation": [0, 0, 0], "purpose": "weapon grip"};
  node_hand_r_9.add(socket_hand_r_gun_0);
  sockets["hand-r:gun"] = socket_hand_r_gun_0;

  const endpoint_foot_l_10 = makeAttachmentEndpoint(null);
  const node_foot_l_10 = new THREE.Group();
  node_foot_l_10.name = "Foot L__pivot";
  node_foot_l_10.scale.set(1, 1, 1);
  if (endpoint_foot_l_10) {
    node_foot_l_10.position.copy(endpoint_foot_l_10.start);
    node_foot_l_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_foot_l_10.position.set(0.25, 0.1, 0.1);
    node_foot_l_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_foot_l_10.userData.sculptComponent = {"id": "foot-l", "name": "Foot L", "level": "macro", "role": "foot", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.34, "height": 0.21, "depth": 0.42, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.25, 0.1, 0.1], "rotation": [0, 0, 0], "scale": [0.34, 0.21, 0.42]}, "actionProfile": {"animationRole": "step", "pivot": {"mode": "top", "localPosition": [0, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "violet-plastic"}}, "material": "violet-plastic", "materialLayers": ["violet-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 47, 120, 1.0)", "secondaryAlbedo": "rgba(63, 40, 102, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_foot_l_10.userData.actionProfile = {"animationRole": "step", "pivot": {"mode": "top", "localPosition": [0, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "violet-plastic"}};
  (nodes["root"] ?? root).add(node_foot_l_10);
  nodes["foot-l"] = node_foot_l_10;
  const mesh_foot_l_10Geometry = endpoint_foot_l_10
    ? new THREE.CylinderGeometry(endpoint_foot_l_10.endRadius, endpoint_foot_l_10.baseRadius, endpoint_foot_l_10.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_foot_l_10) {
    mesh_foot_l_10Geometry.scale(0.34, 0.21, 0.42);
  }
  const mesh_foot_l_10 = new THREE.Mesh(
    mesh_foot_l_10Geometry,
    materialMap["violet-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_l_10.name = "Foot L";
  if (endpoint_foot_l_10) {
    mesh_foot_l_10.position.copy(endpoint_foot_l_10.midpoint);
    mesh_foot_l_10.quaternion.copy(endpoint_foot_l_10.quaternion);
  }
  mesh_foot_l_10.castShadow = options.castShadow ?? true;
  mesh_foot_l_10.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_l_10.userData.sculptComponent = {"id": "foot-l", "name": "Foot L", "level": "macro", "role": "foot", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.34, "height": 0.21, "depth": 0.42, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.25, 0.1, 0.1], "rotation": [0, 0, 0], "scale": [0.34, 0.21, 0.42]}, "actionProfile": {"animationRole": "step", "pivot": {"mode": "top", "localPosition": [0, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "violet-plastic"}}, "material": "violet-plastic", "materialLayers": ["violet-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 47, 120, 1.0)", "secondaryAlbedo": "rgba(63, 40, 102, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_foot_l_10.add(mesh_foot_l_10);
  meshes["foot-l"] = mesh_foot_l_10;
  colliders["foot-l"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["foot-l"] ??= [];
  destructionGroups["foot-l"].push(node_foot_l_10);

  const endpoint_foot_r_11 = makeAttachmentEndpoint(null);
  const node_foot_r_11 = new THREE.Group();
  node_foot_r_11.name = "Foot R__pivot";
  node_foot_r_11.scale.set(1, 1, 1);
  if (endpoint_foot_r_11) {
    node_foot_r_11.position.copy(endpoint_foot_r_11.start);
    node_foot_r_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_foot_r_11.position.set(-0.25, 0.1, 0.1);
    node_foot_r_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_foot_r_11.userData.sculptComponent = {"id": "foot-r", "name": "Foot R", "level": "macro", "role": "foot", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.34, "height": 0.21, "depth": 0.42, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.25, 0.1, 0.1], "rotation": [0, 0, 0], "scale": [0.34, 0.21, 0.42]}, "actionProfile": {"animationRole": "step", "pivot": {"mode": "top", "localPosition": [0, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "violet-plastic"}}, "material": "violet-plastic", "materialLayers": ["violet-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 47, 120, 1.0)", "secondaryAlbedo": "rgba(63, 40, 102, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_foot_r_11.userData.actionProfile = {"animationRole": "step", "pivot": {"mode": "top", "localPosition": [0, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "violet-plastic"}};
  (nodes["root"] ?? root).add(node_foot_r_11);
  nodes["foot-r"] = node_foot_r_11;
  const mesh_foot_r_11Geometry = endpoint_foot_r_11
    ? new THREE.CylinderGeometry(endpoint_foot_r_11.endRadius, endpoint_foot_r_11.baseRadius, endpoint_foot_r_11.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_foot_r_11) {
    mesh_foot_r_11Geometry.scale(0.34, 0.21, 0.42);
  }
  const mesh_foot_r_11 = new THREE.Mesh(
    mesh_foot_r_11Geometry,
    materialMap["violet-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_r_11.name = "Foot R";
  if (endpoint_foot_r_11) {
    mesh_foot_r_11.position.copy(endpoint_foot_r_11.midpoint);
    mesh_foot_r_11.quaternion.copy(endpoint_foot_r_11.quaternion);
  }
  mesh_foot_r_11.castShadow = options.castShadow ?? true;
  mesh_foot_r_11.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_r_11.userData.sculptComponent = {"id": "foot-r", "name": "Foot R", "level": "macro", "role": "foot", "importance": 0.8, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.34, "height": 0.21, "depth": 0.42, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.25, 0.1, 0.1], "rotation": [0, 0, 0], "scale": [0.34, 0.21, 0.42]}, "actionProfile": {"animationRole": "step", "pivot": {"mode": "top", "localPosition": [0, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foot-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "violet-plastic"}}, "material": "violet-plastic", "materialLayers": ["violet-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 47, 120, 1.0)", "secondaryAlbedo": "rgba(63, 40, 102, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_foot_r_11.add(mesh_foot_r_11);
  meshes["foot-r"] = mesh_foot_r_11;
  colliders["foot-r"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["foot-r"] ??= [];
  destructionGroups["foot-r"].push(node_foot_r_11);

  const endpoint_dish_l_12 = makeAttachmentEndpoint(null);
  const node_dish_l_12 = new THREE.Group();
  node_dish_l_12.name = "Dish L__pivot";
  node_dish_l_12.scale.set(1, 1, 1);
  if (endpoint_dish_l_12) {
    node_dish_l_12.position.copy(endpoint_dish_l_12.start);
    node_dish_l_12.rotation.set(1.5707963267948966, 0.0, -0.35);
  } else {
    node_dish_l_12.position.set(0.42, 0.56, 0.0);
    node_dish_l_12.rotation.set(1.5707963267948966, 0.0, -0.35);
  }
  node_dish_l_12.userData.sculptComponent = {"id": "dish-l", "name": "Dish L", "level": "meso", "role": "ornament", "importance": 0.95, "confidence": 0.8, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "Radar-dish ear: a shallow lathe bowl, open toward the front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.2, -0.45], [0.34, -0.3], [0.43, -0.1], [0.48, 0.15], [0.5, 0.36], [0.53, 0.45], [0.5, 0.5], [0.45, 0.46]], "segments": 28}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "crown-l", "localStart": [0.25, 0.5, 0.0], "localEnd": [0.42, 0.56, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.22, "depth": 0.6, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.42, 0.56, 0.0], "rotation": [1.5707963267948966, 0.0, -0.35], "scale": [0.6, 0.22, 0.6]}, "actionProfile": {"animationRole": "wobble", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "dish-lip", "kind": "bevel", "description": "rolled rim around the dish", "evidenceRef": "detail-inventory/zone-r0c2.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_l_12.userData.actionProfile = {"animationRole": "wobble", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["body"] ?? root).add(node_dish_l_12);
  nodes["dish-l"] = node_dish_l_12;
  const mesh_dish_l_12Geometry = endpoint_dish_l_12
    ? new THREE.CylinderGeometry(endpoint_dish_l_12.endRadius, endpoint_dish_l_12.baseRadius, endpoint_dish_l_12.length, 16, 6)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.2, -0.45], [0.34, -0.3], [0.43, -0.1], [0.48, 0.15], [0.5, 0.36], [0.53, 0.45], [0.5, 0.5], [0.45, 0.46]], "segments": 28});
  if (!endpoint_dish_l_12) {
    mesh_dish_l_12Geometry.scale(0.6, 0.22, 0.6);
  }
  const mesh_dish_l_12 = new THREE.Mesh(
    mesh_dish_l_12Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dish_l_12.name = "Dish L";
  if (endpoint_dish_l_12) {
    mesh_dish_l_12.position.copy(endpoint_dish_l_12.midpoint);
    mesh_dish_l_12.quaternion.copy(endpoint_dish_l_12.quaternion);
  }
  mesh_dish_l_12.castShadow = options.castShadow ?? true;
  mesh_dish_l_12.receiveShadow = options.receiveShadow ?? true;
  mesh_dish_l_12.userData.sculptComponent = {"id": "dish-l", "name": "Dish L", "level": "meso", "role": "ornament", "importance": 0.95, "confidence": 0.8, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "Radar-dish ear: a shallow lathe bowl, open toward the front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.2, -0.45], [0.34, -0.3], [0.43, -0.1], [0.48, 0.15], [0.5, 0.36], [0.53, 0.45], [0.5, 0.5], [0.45, 0.46]], "segments": 28}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "crown-l", "localStart": [0.25, 0.5, 0.0], "localEnd": [0.42, 0.56, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.22, "depth": 0.6, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.42, 0.56, 0.0], "rotation": [1.5707963267948966, 0.0, -0.35], "scale": [0.6, 0.22, 0.6]}, "actionProfile": {"animationRole": "wobble", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "dish-lip", "kind": "bevel", "description": "rolled rim around the dish", "evidenceRef": "detail-inventory/zone-r0c2.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_l_12.add(mesh_dish_l_12);
  meshes["dish-l"] = mesh_dish_l_12;
  colliders["dish-l"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["dish-l"] ??= [];
  destructionGroups["dish-l"].push(node_dish_l_12);

  const endpoint_dish_r_13 = makeAttachmentEndpoint(null);
  const node_dish_r_13 = new THREE.Group();
  node_dish_r_13.name = "Dish R__pivot";
  node_dish_r_13.scale.set(1, 1, 1);
  if (endpoint_dish_r_13) {
    node_dish_r_13.position.copy(endpoint_dish_r_13.start);
    node_dish_r_13.rotation.set(1.5707963267948966, -0.0, 0.35);
  } else {
    node_dish_r_13.position.set(-0.42, 0.56, 0.0);
    node_dish_r_13.rotation.set(1.5707963267948966, -0.0, 0.35);
  }
  node_dish_r_13.userData.sculptComponent = {"id": "dish-r", "name": "Dish R", "level": "meso", "role": "ornament", "importance": 0.95, "confidence": 0.8, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "Radar-dish ear: a shallow lathe bowl, open toward the front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.2, -0.45], [0.34, -0.3], [0.43, -0.1], [0.48, 0.15], [0.5, 0.36], [0.53, 0.45], [0.5, 0.5], [0.45, 0.46]], "segments": 28}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "crown-r", "localStart": [-0.25, 0.5, 0.0], "localEnd": [-0.42, 0.56, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.22, "depth": 0.6, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.42, 0.56, 0.0], "rotation": [1.5707963267948966, -0.0, 0.35], "scale": [0.6, 0.22, 0.6]}, "actionProfile": {"animationRole": "wobble", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "dish-lip", "kind": "bevel", "description": "rolled rim around the dish", "evidenceRef": "detail-inventory/zone-r0c2.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_r_13.userData.actionProfile = {"animationRole": "wobble", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["body"] ?? root).add(node_dish_r_13);
  nodes["dish-r"] = node_dish_r_13;
  const mesh_dish_r_13Geometry = endpoint_dish_r_13
    ? new THREE.CylinderGeometry(endpoint_dish_r_13.endRadius, endpoint_dish_r_13.baseRadius, endpoint_dish_r_13.length, 16, 6)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.2, -0.45], [0.34, -0.3], [0.43, -0.1], [0.48, 0.15], [0.5, 0.36], [0.53, 0.45], [0.5, 0.5], [0.45, 0.46]], "segments": 28});
  if (!endpoint_dish_r_13) {
    mesh_dish_r_13Geometry.scale(0.6, 0.22, 0.6);
  }
  const mesh_dish_r_13 = new THREE.Mesh(
    mesh_dish_r_13Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dish_r_13.name = "Dish R";
  if (endpoint_dish_r_13) {
    mesh_dish_r_13.position.copy(endpoint_dish_r_13.midpoint);
    mesh_dish_r_13.quaternion.copy(endpoint_dish_r_13.quaternion);
  }
  mesh_dish_r_13.castShadow = options.castShadow ?? true;
  mesh_dish_r_13.receiveShadow = options.receiveShadow ?? true;
  mesh_dish_r_13.userData.sculptComponent = {"id": "dish-r", "name": "Dish R", "level": "meso", "role": "ornament", "importance": 0.95, "confidence": 0.8, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "Radar-dish ear: a shallow lathe bowl, open toward the front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.2, -0.45], [0.34, -0.3], [0.43, -0.1], [0.48, 0.15], [0.5, 0.36], [0.53, 0.45], [0.5, 0.5], [0.45, 0.46]], "segments": 28}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "crown-r", "localStart": [-0.25, 0.5, 0.0], "localEnd": [-0.42, 0.56, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.6, "height": 0.22, "depth": 0.6, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.42, 0.56, 0.0], "rotation": [1.5707963267948966, -0.0, 0.35], "scale": [0.6, 0.22, 0.6]}, "actionProfile": {"animationRole": "wobble", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "dish-lip", "kind": "bevel", "description": "rolled rim around the dish", "evidenceRef": "detail-inventory/zone-r0c2.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_r_13.add(mesh_dish_r_13);
  meshes["dish-r"] = mesh_dish_r_13;
  colliders["dish-r"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["dish-r"] ??= [];
  destructionGroups["dish-r"].push(node_dish_r_13);

  const attachment_dish_face_l_14 = {"parentId": "dish-l", "parentSocket": "dish-floor", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.07, 0.0], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.27, "endRadius": 0.27};
  const endpoint_dish_face_l_14 = makeAttachmentEndpoint(attachment_dish_face_l_14);
  const node_dish_face_l_14 = new THREE.Group();
  node_dish_face_l_14.name = "Dish Face L__pivot";
  node_dish_face_l_14.scale.set(1, 1, 1);
  if (endpoint_dish_face_l_14) {
    node_dish_face_l_14.position.copy(endpoint_dish_face_l_14.start);
    node_dish_face_l_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dish_face_l_14.position.set(0.0, 0.0, 0.0);
    node_dish_face_l_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_dish_face_l_14.userData.sculptComponent = {"id": "dish-face-l", "name": "Dish Face L", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cream inner face of the dish: a thin disc set into the bowl.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-l", "attachment": {"parentId": "dish-l", "parentSocket": "dish-floor", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.07, 0.0], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.27, "endRadius": 0.27}, "dimensions": {"width": 0.54, "height": 0.02, "depth": 0.54, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.54, 0.02, 0.54]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-face-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-cream"}}, "material": "dish-cream", "materialLayers": ["dish-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 227, 204, 1.0)", "secondaryAlbedo": "rgba(207, 193, 173, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_face_l_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-face-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-cream"}};
  (nodes["dish-l"] ?? root).add(node_dish_face_l_14);
  nodes["dish-face-l"] = node_dish_face_l_14;
  const mesh_dish_face_l_14Geometry = endpoint_dish_face_l_14
    ? new THREE.CylinderGeometry(endpoint_dish_face_l_14.endRadius, endpoint_dish_face_l_14.baseRadius, endpoint_dish_face_l_14.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_dish_face_l_14) {
    mesh_dish_face_l_14Geometry.scale(0.54, 0.02, 0.54);
  }
  const mesh_dish_face_l_14 = new THREE.Mesh(
    mesh_dish_face_l_14Geometry,
    materialMap["dish-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dish_face_l_14.name = "Dish Face L";
  if (endpoint_dish_face_l_14) {
    mesh_dish_face_l_14.position.copy(endpoint_dish_face_l_14.midpoint);
    mesh_dish_face_l_14.quaternion.copy(endpoint_dish_face_l_14.quaternion);
  }
  mesh_dish_face_l_14.castShadow = options.castShadow ?? true;
  mesh_dish_face_l_14.receiveShadow = options.receiveShadow ?? true;
  mesh_dish_face_l_14.userData.sculptComponent = {"id": "dish-face-l", "name": "Dish Face L", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cream inner face of the dish: a thin disc set into the bowl.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-l", "attachment": {"parentId": "dish-l", "parentSocket": "dish-floor", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.07, 0.0], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.27, "endRadius": 0.27}, "dimensions": {"width": 0.54, "height": 0.02, "depth": 0.54, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.54, 0.02, 0.54]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-face-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-cream"}}, "material": "dish-cream", "materialLayers": ["dish-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 227, 204, 1.0)", "secondaryAlbedo": "rgba(207, 193, 173, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_face_l_14.add(mesh_dish_face_l_14);
  meshes["dish-face-l"] = mesh_dish_face_l_14;
  colliders["dish-face-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["dish-face-l"] ??= [];
  destructionGroups["dish-face-l"].push(node_dish_face_l_14);

  const attachment_dish_face_r_15 = {"parentId": "dish-r", "parentSocket": "dish-floor", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.07, 0.0], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.27, "endRadius": 0.27};
  const endpoint_dish_face_r_15 = makeAttachmentEndpoint(attachment_dish_face_r_15);
  const node_dish_face_r_15 = new THREE.Group();
  node_dish_face_r_15.name = "Dish Face R__pivot";
  node_dish_face_r_15.scale.set(1, 1, 1);
  if (endpoint_dish_face_r_15) {
    node_dish_face_r_15.position.copy(endpoint_dish_face_r_15.start);
    node_dish_face_r_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dish_face_r_15.position.set(0.0, 0.0, 0.0);
    node_dish_face_r_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_dish_face_r_15.userData.sculptComponent = {"id": "dish-face-r", "name": "Dish Face R", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cream inner face of the dish: a thin disc set into the bowl.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-r", "attachment": {"parentId": "dish-r", "parentSocket": "dish-floor", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.07, 0.0], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.27, "endRadius": 0.27}, "dimensions": {"width": 0.54, "height": 0.02, "depth": 0.54, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.54, 0.02, 0.54]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-face-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-cream"}}, "material": "dish-cream", "materialLayers": ["dish-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 227, 204, 1.0)", "secondaryAlbedo": "rgba(207, 193, 173, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_face_r_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-face-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-cream"}};
  (nodes["dish-r"] ?? root).add(node_dish_face_r_15);
  nodes["dish-face-r"] = node_dish_face_r_15;
  const mesh_dish_face_r_15Geometry = endpoint_dish_face_r_15
    ? new THREE.CylinderGeometry(endpoint_dish_face_r_15.endRadius, endpoint_dish_face_r_15.baseRadius, endpoint_dish_face_r_15.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_dish_face_r_15) {
    mesh_dish_face_r_15Geometry.scale(0.54, 0.02, 0.54);
  }
  const mesh_dish_face_r_15 = new THREE.Mesh(
    mesh_dish_face_r_15Geometry,
    materialMap["dish-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dish_face_r_15.name = "Dish Face R";
  if (endpoint_dish_face_r_15) {
    mesh_dish_face_r_15.position.copy(endpoint_dish_face_r_15.midpoint);
    mesh_dish_face_r_15.quaternion.copy(endpoint_dish_face_r_15.quaternion);
  }
  mesh_dish_face_r_15.castShadow = options.castShadow ?? true;
  mesh_dish_face_r_15.receiveShadow = options.receiveShadow ?? true;
  mesh_dish_face_r_15.userData.sculptComponent = {"id": "dish-face-r", "name": "Dish Face R", "level": "micro", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Cream inner face of the dish: a thin disc set into the bowl.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-r", "attachment": {"parentId": "dish-r", "parentSocket": "dish-floor", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.07, 0.0], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.27, "endRadius": 0.27}, "dimensions": {"width": 0.54, "height": 0.02, "depth": 0.54, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.54, 0.02, 0.54]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish-face-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-cream"}}, "material": "dish-cream", "materialLayers": ["dish-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 227, 204, 1.0)", "secondaryAlbedo": "rgba(207, 193, 173, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_dish_face_r_15.add(mesh_dish_face_r_15);
  meshes["dish-face-r"] = mesh_dish_face_r_15;
  colliders["dish-face-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["dish-face-r"] ??= [];
  destructionGroups["dish-face-r"].push(node_dish_face_r_15);

  const attachment_antenna_l_16 = {"parentId": "dish-l", "parentSocket": "dish-centre", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.2, 0.0], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.02};
  const endpoint_antenna_l_16 = makeAttachmentEndpoint(attachment_antenna_l_16);
  const node_antenna_l_16 = new THREE.Group();
  node_antenna_l_16.name = "Antenna L__pivot";
  node_antenna_l_16.scale.set(1, 1, 1);
  if (endpoint_antenna_l_16) {
    node_antenna_l_16.position.copy(endpoint_antenna_l_16.start);
    node_antenna_l_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_antenna_l_16.position.set(0.0, 0.0, 0.0);
    node_antenna_l_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_antenna_l_16.userData.sculptComponent = {"id": "antenna-l", "name": "Antenna L", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Antenna stalk standing out of the dish centre.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-l", "attachment": {"parentId": "dish-l", "parentSocket": "dish-centre", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.2, 0.0], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.02}, "dimensions": {"width": 0.04, "height": 0.16, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.04, 0.16, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_l_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["dish-l"] ?? root).add(node_antenna_l_16);
  nodes["antenna-l"] = node_antenna_l_16;
  const mesh_antenna_l_16Geometry = endpoint_antenna_l_16
    ? new THREE.CylinderGeometry(endpoint_antenna_l_16.endRadius, endpoint_antenna_l_16.baseRadius, endpoint_antenna_l_16.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_antenna_l_16) {
    mesh_antenna_l_16Geometry.scale(0.04, 0.16, 0.04);
  }
  const mesh_antenna_l_16 = new THREE.Mesh(
    mesh_antenna_l_16Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_antenna_l_16.name = "Antenna L";
  if (endpoint_antenna_l_16) {
    mesh_antenna_l_16.position.copy(endpoint_antenna_l_16.midpoint);
    mesh_antenna_l_16.quaternion.copy(endpoint_antenna_l_16.quaternion);
  }
  mesh_antenna_l_16.castShadow = options.castShadow ?? true;
  mesh_antenna_l_16.receiveShadow = options.receiveShadow ?? true;
  mesh_antenna_l_16.userData.sculptComponent = {"id": "antenna-l", "name": "Antenna L", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Antenna stalk standing out of the dish centre.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-l", "attachment": {"parentId": "dish-l", "parentSocket": "dish-centre", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.2, 0.0], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.02}, "dimensions": {"width": 0.04, "height": 0.16, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.04, 0.16, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_l_16.add(mesh_antenna_l_16);
  meshes["antenna-l"] = mesh_antenna_l_16;
  colliders["antenna-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["antenna-l"] ??= [];
  destructionGroups["antenna-l"].push(node_antenna_l_16);

  const attachment_antenna_r_17 = {"parentId": "dish-r", "parentSocket": "dish-centre", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.2, 0.0], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.02};
  const endpoint_antenna_r_17 = makeAttachmentEndpoint(attachment_antenna_r_17);
  const node_antenna_r_17 = new THREE.Group();
  node_antenna_r_17.name = "Antenna R__pivot";
  node_antenna_r_17.scale.set(1, 1, 1);
  if (endpoint_antenna_r_17) {
    node_antenna_r_17.position.copy(endpoint_antenna_r_17.start);
    node_antenna_r_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_antenna_r_17.position.set(0.0, 0.0, 0.0);
    node_antenna_r_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_antenna_r_17.userData.sculptComponent = {"id": "antenna-r", "name": "Antenna R", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Antenna stalk standing out of the dish centre.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-r", "attachment": {"parentId": "dish-r", "parentSocket": "dish-centre", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.2, 0.0], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.02}, "dimensions": {"width": 0.04, "height": 0.16, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.04, 0.16, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_r_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["dish-r"] ?? root).add(node_antenna_r_17);
  nodes["antenna-r"] = node_antenna_r_17;
  const mesh_antenna_r_17Geometry = endpoint_antenna_r_17
    ? new THREE.CylinderGeometry(endpoint_antenna_r_17.endRadius, endpoint_antenna_r_17.baseRadius, endpoint_antenna_r_17.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_antenna_r_17) {
    mesh_antenna_r_17Geometry.scale(0.04, 0.16, 0.04);
  }
  const mesh_antenna_r_17 = new THREE.Mesh(
    mesh_antenna_r_17Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_antenna_r_17.name = "Antenna R";
  if (endpoint_antenna_r_17) {
    mesh_antenna_r_17.position.copy(endpoint_antenna_r_17.midpoint);
    mesh_antenna_r_17.quaternion.copy(endpoint_antenna_r_17.quaternion);
  }
  mesh_antenna_r_17.castShadow = options.castShadow ?? true;
  mesh_antenna_r_17.receiveShadow = options.receiveShadow ?? true;
  mesh_antenna_r_17.userData.sculptComponent = {"id": "antenna-r", "name": "Antenna R", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Antenna stalk standing out of the dish centre.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-r", "attachment": {"parentId": "dish-r", "parentSocket": "dish-centre", "localStart": [0.0, 0.05, 0.0], "localEnd": [0.0, 0.2, 0.0], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.02}, "dimensions": {"width": 0.04, "height": 0.16, "depth": 0.04, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.04, 0.16, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_r_17.add(mesh_antenna_r_17);
  meshes["antenna-r"] = mesh_antenna_r_17;
  colliders["antenna-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["antenna-r"] ??= [];
  destructionGroups["antenna-r"].push(node_antenna_r_17);

  const endpoint_antenna_tip_l_18 = makeAttachmentEndpoint(null);
  const node_antenna_tip_l_18 = new THREE.Group();
  node_antenna_tip_l_18.name = "Antenna Tip L__pivot";
  node_antenna_tip_l_18.scale.set(1, 1, 1);
  if (endpoint_antenna_tip_l_18) {
    node_antenna_tip_l_18.position.copy(endpoint_antenna_tip_l_18.start);
    node_antenna_tip_l_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_antenna_tip_l_18.position.set(0.0, 0.21, 0.0);
    node_antenna_tip_l_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_antenna_tip_l_18.userData.sculptComponent = {"id": "antenna-tip-l", "name": "Antenna Tip L", "level": "micro", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-l", "attachment": null, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.21, 0.0], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-tip-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_tip_l_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-tip-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["dish-l"] ?? root).add(node_antenna_tip_l_18);
  nodes["antenna-tip-l"] = node_antenna_tip_l_18;
  const mesh_antenna_tip_l_18Geometry = endpoint_antenna_tip_l_18
    ? new THREE.CylinderGeometry(endpoint_antenna_tip_l_18.endRadius, endpoint_antenna_tip_l_18.baseRadius, endpoint_antenna_tip_l_18.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_antenna_tip_l_18) {
    mesh_antenna_tip_l_18Geometry.scale(0.09, 0.09, 0.09);
  }
  const mesh_antenna_tip_l_18 = new THREE.Mesh(
    mesh_antenna_tip_l_18Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_antenna_tip_l_18.name = "Antenna Tip L";
  if (endpoint_antenna_tip_l_18) {
    mesh_antenna_tip_l_18.position.copy(endpoint_antenna_tip_l_18.midpoint);
    mesh_antenna_tip_l_18.quaternion.copy(endpoint_antenna_tip_l_18.quaternion);
  }
  mesh_antenna_tip_l_18.castShadow = options.castShadow ?? true;
  mesh_antenna_tip_l_18.receiveShadow = options.receiveShadow ?? true;
  mesh_antenna_tip_l_18.userData.sculptComponent = {"id": "antenna-tip-l", "name": "Antenna Tip L", "level": "micro", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-l", "attachment": null, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.21, 0.0], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-tip-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_tip_l_18.add(mesh_antenna_tip_l_18);
  meshes["antenna-tip-l"] = mesh_antenna_tip_l_18;
  colliders["antenna-tip-l"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["antenna-tip-l"] ??= [];
  destructionGroups["antenna-tip-l"].push(node_antenna_tip_l_18);

  const endpoint_antenna_tip_r_19 = makeAttachmentEndpoint(null);
  const node_antenna_tip_r_19 = new THREE.Group();
  node_antenna_tip_r_19.name = "Antenna Tip R__pivot";
  node_antenna_tip_r_19.scale.set(1, 1, 1);
  if (endpoint_antenna_tip_r_19) {
    node_antenna_tip_r_19.position.copy(endpoint_antenna_tip_r_19.start);
    node_antenna_tip_r_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_antenna_tip_r_19.position.set(0.0, 0.21, 0.0);
    node_antenna_tip_r_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_antenna_tip_r_19.userData.sculptComponent = {"id": "antenna-tip-r", "name": "Antenna Tip R", "level": "micro", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-r", "attachment": null, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.21, 0.0], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-tip-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_tip_r_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-tip-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["dish-r"] ?? root).add(node_antenna_tip_r_19);
  nodes["antenna-tip-r"] = node_antenna_tip_r_19;
  const mesh_antenna_tip_r_19Geometry = endpoint_antenna_tip_r_19
    ? new THREE.CylinderGeometry(endpoint_antenna_tip_r_19.endRadius, endpoint_antenna_tip_r_19.baseRadius, endpoint_antenna_tip_r_19.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_antenna_tip_r_19) {
    mesh_antenna_tip_r_19Geometry.scale(0.09, 0.09, 0.09);
  }
  const mesh_antenna_tip_r_19 = new THREE.Mesh(
    mesh_antenna_tip_r_19Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_antenna_tip_r_19.name = "Antenna Tip R";
  if (endpoint_antenna_tip_r_19) {
    mesh_antenna_tip_r_19.position.copy(endpoint_antenna_tip_r_19.midpoint);
    mesh_antenna_tip_r_19.quaternion.copy(endpoint_antenna_tip_r_19.quaternion);
  }
  mesh_antenna_tip_r_19.castShadow = options.castShadow ?? true;
  mesh_antenna_tip_r_19.receiveShadow = options.receiveShadow ?? true;
  mesh_antenna_tip_r_19.userData.sculptComponent = {"id": "antenna-tip-r", "name": "Antenna Tip R", "level": "micro", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete moulded toy part assembled onto the figure.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "dish-r", "attachment": null, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.21, 0.0], "rotation": [0, 0, 0], "scale": [0.09, 0.09, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "antenna-tip-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_antenna_tip_r_19.add(mesh_antenna_tip_r_19);
  meshes["antenna-tip-r"] = mesh_antenna_tip_r_19;
  colliders["antenna-tip-r"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["antenna-tip-r"] ??= [];
  destructionGroups["antenna-tip-r"].push(node_antenna_tip_r_19);

  const endpoint_phones_band_20 = makeAttachmentEndpoint(null);
  const node_phones_band_20 = new THREE.Group();
  node_phones_band_20.name = "Phones Band__pivot";
  node_phones_band_20.scale.set(1, 1, 1);
  if (endpoint_phones_band_20) {
    node_phones_band_20.position.copy(endpoint_phones_band_20.start);
    node_phones_band_20.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_phones_band_20.position.set(0.0, 0.02, -0.08);
    node_phones_band_20.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_phones_band_20.userData.sculptComponent = {"id": "phones-band", "name": "Phones Band", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Headphone band around the back of the neck; its front half is buried in the head.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.13}, "parent": "body", "attachment": null, "dimensions": {"width": 0.98, "height": 0.84, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.02, -0.08], "rotation": [1.5707963267948966, 0.0, 0.0], "scale": [0.98, 0.84, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "phones-band", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}}, "material": "phone-blue", "materialLayers": ["phone-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 176, 240, 1.0)", "secondaryAlbedo": "rgba(94, 150, 204, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_phones_band_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "phones-band", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}};
  (nodes["body"] ?? root).add(node_phones_band_20);
  nodes["phones-band"] = node_phones_band_20;
  const mesh_phones_band_20Geometry = endpoint_phones_band_20
    ? new THREE.CylinderGeometry(endpoint_phones_band_20.endRadius, endpoint_phones_band_20.baseRadius, endpoint_phones_band_20.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0585, 12, 48);
  if (!endpoint_phones_band_20) {
    mesh_phones_band_20Geometry.scale(0.98, 0.84, 0.09);
  }
  const mesh_phones_band_20 = new THREE.Mesh(
    mesh_phones_band_20Geometry,
    materialMap["phone-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_phones_band_20.name = "Phones Band";
  if (endpoint_phones_band_20) {
    mesh_phones_band_20.position.copy(endpoint_phones_band_20.midpoint);
    mesh_phones_band_20.quaternion.copy(endpoint_phones_band_20.quaternion);
  }
  mesh_phones_band_20.castShadow = options.castShadow ?? true;
  mesh_phones_band_20.receiveShadow = options.receiveShadow ?? true;
  mesh_phones_band_20.userData.sculptComponent = {"id": "phones-band", "name": "Phones Band", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Headphone band around the back of the neck; its front half is buried in the head.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.13}, "parent": "body", "attachment": null, "dimensions": {"width": 0.98, "height": 0.84, "depth": 0.09, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.02, -0.08], "rotation": [1.5707963267948966, 0.0, 0.0], "scale": [0.98, 0.84, 0.09]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "phones-band", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}}, "material": "phone-blue", "materialLayers": ["phone-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 176, 240, 1.0)", "secondaryAlbedo": "rgba(94, 150, 204, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_phones_band_20.add(mesh_phones_band_20);
  meshes["phones-band"] = mesh_phones_band_20;
  colliders["phones-band"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["phones-band"] ??= [];
  destructionGroups["phones-band"].push(node_phones_band_20);

  const attachment_cup_l_21 = {"parentId": "body", "parentSocket": "cheek-l", "localStart": [0.385, 0.04, 0.127], "localEnd": [0.495, 0.04, 0.173], "contactType": "embed", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.125, "endRadius": 0.125};
  const endpoint_cup_l_21 = makeAttachmentEndpoint(attachment_cup_l_21);
  const node_cup_l_21 = new THREE.Group();
  node_cup_l_21.name = "Cup L__pivot";
  node_cup_l_21.scale.set(1, 1, 1);
  if (endpoint_cup_l_21) {
    node_cup_l_21.position.copy(endpoint_cup_l_21.start);
    node_cup_l_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cup_l_21.position.set(0.0, 0.0, 0.0);
    node_cup_l_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_cup_l_21.userData.sculptComponent = {"id": "cup-l", "name": "Cup L", "level": "meso", "role": "detail", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round headphone cup on the cheek, facing out and a little forward.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-l", "localStart": [0.385, 0.04, 0.127], "localEnd": [0.495, 0.04, 0.173], "contactType": "embed", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.125, "endRadius": 0.125}, "dimensions": {"width": 0.25, "height": 0.12, "depth": 0.25, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.25, 0.12, 0.25]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}}, "material": "phone-blue", "materialLayers": ["phone-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 176, 240, 1.0)", "secondaryAlbedo": "rgba(94, 150, 204, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cup_l_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}};
  (nodes["body"] ?? root).add(node_cup_l_21);
  nodes["cup-l"] = node_cup_l_21;
  const mesh_cup_l_21Geometry = endpoint_cup_l_21
    ? new THREE.CylinderGeometry(endpoint_cup_l_21.endRadius, endpoint_cup_l_21.baseRadius, endpoint_cup_l_21.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cup_l_21) {
    mesh_cup_l_21Geometry.scale(0.25, 0.12, 0.25);
  }
  const mesh_cup_l_21 = new THREE.Mesh(
    mesh_cup_l_21Geometry,
    materialMap["phone-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cup_l_21.name = "Cup L";
  if (endpoint_cup_l_21) {
    mesh_cup_l_21.position.copy(endpoint_cup_l_21.midpoint);
    mesh_cup_l_21.quaternion.copy(endpoint_cup_l_21.quaternion);
  }
  mesh_cup_l_21.castShadow = options.castShadow ?? true;
  mesh_cup_l_21.receiveShadow = options.receiveShadow ?? true;
  mesh_cup_l_21.userData.sculptComponent = {"id": "cup-l", "name": "Cup L", "level": "meso", "role": "detail", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round headphone cup on the cheek, facing out and a little forward.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-l", "localStart": [0.385, 0.04, 0.127], "localEnd": [0.495, 0.04, 0.173], "contactType": "embed", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.125, "endRadius": 0.125}, "dimensions": {"width": 0.25, "height": 0.12, "depth": 0.25, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.25, 0.12, 0.25]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cup-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}}, "material": "phone-blue", "materialLayers": ["phone-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 176, 240, 1.0)", "secondaryAlbedo": "rgba(94, 150, 204, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cup_l_21.add(mesh_cup_l_21);
  meshes["cup-l"] = mesh_cup_l_21;
  colliders["cup-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["cup-l"] ??= [];
  destructionGroups["cup-l"].push(node_cup_l_21);

  const attachment_cup_r_22 = {"parentId": "body", "parentSocket": "cheek-r", "localStart": [-0.385, 0.04, 0.127], "localEnd": [-0.495, 0.04, 0.173], "contactType": "embed", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.125, "endRadius": 0.125};
  const endpoint_cup_r_22 = makeAttachmentEndpoint(attachment_cup_r_22);
  const node_cup_r_22 = new THREE.Group();
  node_cup_r_22.name = "Cup R__pivot";
  node_cup_r_22.scale.set(1, 1, 1);
  if (endpoint_cup_r_22) {
    node_cup_r_22.position.copy(endpoint_cup_r_22.start);
    node_cup_r_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cup_r_22.position.set(0.0, 0.0, 0.0);
    node_cup_r_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_cup_r_22.userData.sculptComponent = {"id": "cup-r", "name": "Cup R", "level": "meso", "role": "detail", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round headphone cup on the cheek, facing out and a little forward.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-r", "localStart": [-0.385, 0.04, 0.127], "localEnd": [-0.495, 0.04, 0.173], "contactType": "embed", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.125, "endRadius": 0.125}, "dimensions": {"width": 0.25, "height": 0.12, "depth": 0.25, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.25, 0.12, 0.25]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}}, "material": "phone-blue", "materialLayers": ["phone-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 176, 240, 1.0)", "secondaryAlbedo": "rgba(94, 150, 204, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cup_r_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}};
  (nodes["body"] ?? root).add(node_cup_r_22);
  nodes["cup-r"] = node_cup_r_22;
  const mesh_cup_r_22Geometry = endpoint_cup_r_22
    ? new THREE.CylinderGeometry(endpoint_cup_r_22.endRadius, endpoint_cup_r_22.baseRadius, endpoint_cup_r_22.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cup_r_22) {
    mesh_cup_r_22Geometry.scale(0.25, 0.12, 0.25);
  }
  const mesh_cup_r_22 = new THREE.Mesh(
    mesh_cup_r_22Geometry,
    materialMap["phone-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cup_r_22.name = "Cup R";
  if (endpoint_cup_r_22) {
    mesh_cup_r_22.position.copy(endpoint_cup_r_22.midpoint);
    mesh_cup_r_22.quaternion.copy(endpoint_cup_r_22.quaternion);
  }
  mesh_cup_r_22.castShadow = options.castShadow ?? true;
  mesh_cup_r_22.receiveShadow = options.receiveShadow ?? true;
  mesh_cup_r_22.userData.sculptComponent = {"id": "cup-r", "name": "Cup R", "level": "meso", "role": "detail", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round headphone cup on the cheek, facing out and a little forward.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-r", "localStart": [-0.385, 0.04, 0.127], "localEnd": [-0.495, 0.04, 0.173], "contactType": "embed", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.125, "endRadius": 0.125}, "dimensions": {"width": 0.25, "height": 0.12, "depth": 0.25, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.25, 0.12, 0.25]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cup-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-blue"}}, "material": "phone-blue", "materialLayers": ["phone-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 176, 240, 1.0)", "secondaryAlbedo": "rgba(94, 150, 204, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cup_r_22.add(mesh_cup_r_22);
  meshes["cup-r"] = mesh_cup_r_22;
  colliders["cup-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["cup-r"] ??= [];
  destructionGroups["cup-r"].push(node_cup_r_22);

  const attachment_cap_l_23 = {"parentId": "body", "parentSocket": "cheek-l", "localStart": [0.486, 0.04, 0.169], "localEnd": [0.509, 0.04, 0.179], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.075, "endRadius": 0.075};
  const endpoint_cap_l_23 = makeAttachmentEndpoint(attachment_cap_l_23);
  const node_cap_l_23 = new THREE.Group();
  node_cap_l_23.name = "Cap L__pivot";
  node_cap_l_23.scale.set(1, 1, 1);
  if (endpoint_cap_l_23) {
    node_cap_l_23.position.copy(endpoint_cap_l_23.start);
    node_cap_l_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cap_l_23.position.set(0.0, 0.0, 0.0);
    node_cap_l_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_cap_l_23.userData.sculptComponent = {"id": "cap-l", "name": "Cap L", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Darker blue cap on the outside of the cup.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-l", "localStart": [0.486, 0.04, 0.169], "localEnd": [0.509, 0.04, 0.179], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.075, "endRadius": 0.075}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-dark"}}, "material": "phone-dark", "materialLayers": ["phone-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 127, 219, 1.0)", "secondaryAlbedo": "rgba(54, 108, 186, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cap_l_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-dark"}};
  (nodes["body"] ?? root).add(node_cap_l_23);
  nodes["cap-l"] = node_cap_l_23;
  const mesh_cap_l_23Geometry = endpoint_cap_l_23
    ? new THREE.CylinderGeometry(endpoint_cap_l_23.endRadius, endpoint_cap_l_23.baseRadius, endpoint_cap_l_23.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cap_l_23) {
    mesh_cap_l_23Geometry.scale(0.14, 0.03, 0.14);
  }
  const mesh_cap_l_23 = new THREE.Mesh(
    mesh_cap_l_23Geometry,
    materialMap["phone-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_l_23.name = "Cap L";
  if (endpoint_cap_l_23) {
    mesh_cap_l_23.position.copy(endpoint_cap_l_23.midpoint);
    mesh_cap_l_23.quaternion.copy(endpoint_cap_l_23.quaternion);
  }
  mesh_cap_l_23.castShadow = options.castShadow ?? true;
  mesh_cap_l_23.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_l_23.userData.sculptComponent = {"id": "cap-l", "name": "Cap L", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Darker blue cap on the outside of the cup.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-l", "localStart": [0.486, 0.04, 0.169], "localEnd": [0.509, 0.04, 0.179], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.075, "endRadius": 0.075}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-dark"}}, "material": "phone-dark", "materialLayers": ["phone-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 127, 219, 1.0)", "secondaryAlbedo": "rgba(54, 108, 186, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cap_l_23.add(mesh_cap_l_23);
  meshes["cap-l"] = mesh_cap_l_23;
  colliders["cap-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["cap-l"] ??= [];
  destructionGroups["cap-l"].push(node_cap_l_23);

  const attachment_cap_r_24 = {"parentId": "body", "parentSocket": "cheek-r", "localStart": [-0.486, 0.04, 0.169], "localEnd": [-0.509, 0.04, 0.179], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.075, "endRadius": 0.075};
  const endpoint_cap_r_24 = makeAttachmentEndpoint(attachment_cap_r_24);
  const node_cap_r_24 = new THREE.Group();
  node_cap_r_24.name = "Cap R__pivot";
  node_cap_r_24.scale.set(1, 1, 1);
  if (endpoint_cap_r_24) {
    node_cap_r_24.position.copy(endpoint_cap_r_24.start);
    node_cap_r_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cap_r_24.position.set(0.0, 0.0, 0.0);
    node_cap_r_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_cap_r_24.userData.sculptComponent = {"id": "cap-r", "name": "Cap R", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Darker blue cap on the outside of the cup.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-r", "localStart": [-0.486, 0.04, 0.169], "localEnd": [-0.509, 0.04, 0.179], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.075, "endRadius": 0.075}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-dark"}}, "material": "phone-dark", "materialLayers": ["phone-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 127, 219, 1.0)", "secondaryAlbedo": "rgba(54, 108, 186, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cap_r_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-dark"}};
  (nodes["body"] ?? root).add(node_cap_r_24);
  nodes["cap-r"] = node_cap_r_24;
  const mesh_cap_r_24Geometry = endpoint_cap_r_24
    ? new THREE.CylinderGeometry(endpoint_cap_r_24.endRadius, endpoint_cap_r_24.baseRadius, endpoint_cap_r_24.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cap_r_24) {
    mesh_cap_r_24Geometry.scale(0.14, 0.03, 0.14);
  }
  const mesh_cap_r_24 = new THREE.Mesh(
    mesh_cap_r_24Geometry,
    materialMap["phone-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_r_24.name = "Cap R";
  if (endpoint_cap_r_24) {
    mesh_cap_r_24.position.copy(endpoint_cap_r_24.midpoint);
    mesh_cap_r_24.quaternion.copy(endpoint_cap_r_24.quaternion);
  }
  mesh_cap_r_24.castShadow = options.castShadow ?? true;
  mesh_cap_r_24.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_r_24.userData.sculptComponent = {"id": "cap-r", "name": "Cap R", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Darker blue cap on the outside of the cup.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "cheek-r", "localStart": [-0.486, 0.04, 0.169], "localEnd": [-0.509, 0.04, 0.179], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.075, "endRadius": 0.075}, "dimensions": {"width": 0.14, "height": 0.03, "depth": 0.14, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.14, 0.03, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "phone-dark"}}, "material": "phone-dark", "materialLayers": ["phone-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 127, 219, 1.0)", "secondaryAlbedo": "rgba(54, 108, 186, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_cap_r_24.add(mesh_cap_r_24);
  meshes["cap-r"] = mesh_cap_r_24;
  colliders["cap-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["cap-r"] ??= [];
  destructionGroups["cap-r"].push(node_cap_r_24);

  const endpoint_wing_l_25 = makeAttachmentEndpoint(null);
  const node_wing_l_25 = new THREE.Group();
  node_wing_l_25.name = "Wing L__pivot";
  node_wing_l_25.scale.set(1, 1, 1);
  if (endpoint_wing_l_25) {
    node_wing_l_25.position.copy(endpoint_wing_l_25.start);
    node_wing_l_25.rotation.set(0.0, -0.3, 0.0);
  } else {
    node_wing_l_25.position.set(0.6, -0.04, -0.2);
    node_wing_l_25.rotation.set(0.0, -0.3, 0.0);
  }
  node_wing_l_25.userData.sculptComponent = {"id": "wing-l", "name": "Wing L", "level": "meso", "role": "wing", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Thin bat-wing membrane: an extruded outline with a scalloped trailing edge.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.5, 0.15], [0.0, 0.35], [0.5, 0.5], [0.42, 0.1], [0.3, -0.2], [0.2, -0.5], [0.05, -0.2], [-0.12, -0.35], [-0.28, -0.1], [-0.5, -0.25]], "depth": 1.0}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-l", "localStart": [0.36, -0.04, -0.2], "localEnd": [0.6, -0.04, -0.2], "contactType": "overlap", "overlap": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.42, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.6, -0.04, -0.2], "rotation": [0.0, -0.3, 0.0], "scale": [0.38, 0.42, 0.03]}, "actionProfile": {"animationRole": "flap", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wing-cream"}}, "material": "wing-cream", "materialLayers": ["wing-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 196, 1.0)", "secondaryAlbedo": "rgba(206, 189, 167, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_l_25.userData.actionProfile = {"animationRole": "flap", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wing-cream"}};
  (nodes["body"] ?? root).add(node_wing_l_25);
  nodes["wing-l"] = node_wing_l_25;
  const mesh_wing_l_25Geometry = endpoint_wing_l_25
    ? new THREE.CylinderGeometry(endpoint_wing_l_25.endRadius, endpoint_wing_l_25.baseRadius, endpoint_wing_l_25.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, 0.15], [0.0, 0.35], [0.5, 0.5], [0.42, 0.1], [0.3, -0.2], [0.2, -0.5], [0.05, -0.2], [-0.12, -0.35], [-0.28, -0.1], [-0.5, -0.25]], "depth": 1.0});
  if (!endpoint_wing_l_25) {
    mesh_wing_l_25Geometry.scale(0.38, 0.42, 0.03);
  }
  const mesh_wing_l_25 = new THREE.Mesh(
    mesh_wing_l_25Geometry,
    materialMap["wing-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_l_25.name = "Wing L";
  if (endpoint_wing_l_25) {
    mesh_wing_l_25.position.copy(endpoint_wing_l_25.midpoint);
    mesh_wing_l_25.quaternion.copy(endpoint_wing_l_25.quaternion);
  }
  mesh_wing_l_25.castShadow = options.castShadow ?? true;
  mesh_wing_l_25.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_l_25.userData.sculptComponent = {"id": "wing-l", "name": "Wing L", "level": "meso", "role": "wing", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Thin bat-wing membrane: an extruded outline with a scalloped trailing edge.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.5, 0.15], [0.0, 0.35], [0.5, 0.5], [0.42, 0.1], [0.3, -0.2], [0.2, -0.5], [0.05, -0.2], [-0.12, -0.35], [-0.28, -0.1], [-0.5, -0.25]], "depth": 1.0}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-l", "localStart": [0.36, -0.04, -0.2], "localEnd": [0.6, -0.04, -0.2], "contactType": "overlap", "overlap": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.42, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.6, -0.04, -0.2], "rotation": [0.0, -0.3, 0.0], "scale": [0.38, 0.42, 0.03]}, "actionProfile": {"animationRole": "flap", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wing-cream"}}, "material": "wing-cream", "materialLayers": ["wing-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 196, 1.0)", "secondaryAlbedo": "rgba(206, 189, 167, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_l_25.add(mesh_wing_l_25);
  meshes["wing-l"] = mesh_wing_l_25;
  colliders["wing-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["wing-l"] ??= [];
  destructionGroups["wing-l"].push(node_wing_l_25);

  const endpoint_wing_r_26 = makeAttachmentEndpoint(null);
  const node_wing_r_26 = new THREE.Group();
  node_wing_r_26.name = "Wing R__pivot";
  node_wing_r_26.scale.set(1, 1, 1);
  if (endpoint_wing_r_26) {
    node_wing_r_26.position.copy(endpoint_wing_r_26.start);
    node_wing_r_26.rotation.set(0.0, 0.3, -0.0);
  } else {
    node_wing_r_26.position.set(-0.6, -0.04, -0.2);
    node_wing_r_26.rotation.set(0.0, 0.3, -0.0);
  }
  node_wing_r_26.userData.sculptComponent = {"id": "wing-r", "name": "Wing R", "level": "meso", "role": "wing", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Thin bat-wing membrane: an extruded outline with a scalloped trailing edge.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.5, -0.25], [0.28, -0.1], [0.12, -0.35], [-0.05, -0.2], [-0.2, -0.5], [-0.3, -0.2], [-0.42, 0.1], [-0.5, 0.5], [-0.0, 0.35], [0.5, 0.15]], "depth": 1.0}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-r", "localStart": [-0.36, -0.04, -0.2], "localEnd": [-0.6, -0.04, -0.2], "contactType": "overlap", "overlap": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.42, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.6, -0.04, -0.2], "rotation": [0.0, 0.3, -0.0], "scale": [0.38, 0.42, 0.03]}, "actionProfile": {"animationRole": "flap", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wing-cream"}}, "material": "wing-cream", "materialLayers": ["wing-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 196, 1.0)", "secondaryAlbedo": "rgba(206, 189, 167, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_r_26.userData.actionProfile = {"animationRole": "flap", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wing-cream"}};
  (nodes["body"] ?? root).add(node_wing_r_26);
  nodes["wing-r"] = node_wing_r_26;
  const mesh_wing_r_26Geometry = endpoint_wing_r_26
    ? new THREE.CylinderGeometry(endpoint_wing_r_26.endRadius, endpoint_wing_r_26.baseRadius, endpoint_wing_r_26.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.5, -0.25], [0.28, -0.1], [0.12, -0.35], [-0.05, -0.2], [-0.2, -0.5], [-0.3, -0.2], [-0.42, 0.1], [-0.5, 0.5], [-0.0, 0.35], [0.5, 0.15]], "depth": 1.0});
  if (!endpoint_wing_r_26) {
    mesh_wing_r_26Geometry.scale(0.38, 0.42, 0.03);
  }
  const mesh_wing_r_26 = new THREE.Mesh(
    mesh_wing_r_26Geometry,
    materialMap["wing-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_r_26.name = "Wing R";
  if (endpoint_wing_r_26) {
    mesh_wing_r_26.position.copy(endpoint_wing_r_26.midpoint);
    mesh_wing_r_26.quaternion.copy(endpoint_wing_r_26.quaternion);
  }
  mesh_wing_r_26.castShadow = options.castShadow ?? true;
  mesh_wing_r_26.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_r_26.userData.sculptComponent = {"id": "wing-r", "name": "Wing R", "level": "meso", "role": "wing", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Thin bat-wing membrane: an extruded outline with a scalloped trailing edge.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.5, -0.25], [0.28, -0.1], [0.12, -0.35], [-0.05, -0.2], [-0.2, -0.5], [-0.3, -0.2], [-0.42, 0.1], [-0.5, 0.5], [-0.0, 0.35], [0.5, 0.15]], "depth": 1.0}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-r", "localStart": [-0.36, -0.04, -0.2], "localEnd": [-0.6, -0.04, -0.2], "contactType": "overlap", "overlap": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.42, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.6, -0.04, -0.2], "rotation": [0.0, 0.3, -0.0], "scale": [0.38, 0.42, 0.03]}, "actionProfile": {"animationRole": "flap", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wing-cream"}}, "material": "wing-cream", "materialLayers": ["wing-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 222, 196, 1.0)", "secondaryAlbedo": "rgba(206, 189, 167, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_r_26.add(mesh_wing_r_26);
  meshes["wing-r"] = mesh_wing_r_26;
  colliders["wing-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["wing-r"] ??= [];
  destructionGroups["wing-r"].push(node_wing_r_26);

  const attachment_wing_bone_l_27 = {"parentId": "body", "parentSocket": "back-l", "localStart": [0.4, 0.02, -0.18], "localEnd": [0.76, 0.17, -0.27], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.018};
  const endpoint_wing_bone_l_27 = makeAttachmentEndpoint(attachment_wing_bone_l_27);
  const node_wing_bone_l_27 = new THREE.Group();
  node_wing_bone_l_27.name = "Wing Bone L__pivot";
  node_wing_bone_l_27.scale.set(1, 1, 1);
  if (endpoint_wing_bone_l_27) {
    node_wing_bone_l_27.position.copy(endpoint_wing_bone_l_27.start);
    node_wing_bone_l_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wing_bone_l_27.position.set(0.0, 0.0, 0.0);
    node_wing_bone_l_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_wing_bone_l_27.userData.sculptComponent = {"id": "wing-bone-l", "name": "Wing Bone L", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Wing bone along the top edge of the membrane.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-l", "localStart": [0.4, 0.02, -0.18], "localEnd": [0.76, 0.17, -0.27], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.018}, "dimensions": {"width": 0.06, "height": 0.48, "depth": 0.06, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.06, 0.48, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-bone-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_bone_l_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-bone-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["body"] ?? root).add(node_wing_bone_l_27);
  nodes["wing-bone-l"] = node_wing_bone_l_27;
  const mesh_wing_bone_l_27Geometry = endpoint_wing_bone_l_27
    ? new THREE.CylinderGeometry(endpoint_wing_bone_l_27.endRadius, endpoint_wing_bone_l_27.baseRadius, endpoint_wing_bone_l_27.length, 16, 6)
    : new THREE.ConeGeometry(0.5, 1, 24, 1);
  if (!endpoint_wing_bone_l_27) {
    mesh_wing_bone_l_27Geometry.scale(0.06, 0.48, 0.06);
  }
  const mesh_wing_bone_l_27 = new THREE.Mesh(
    mesh_wing_bone_l_27Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_bone_l_27.name = "Wing Bone L";
  if (endpoint_wing_bone_l_27) {
    mesh_wing_bone_l_27.position.copy(endpoint_wing_bone_l_27.midpoint);
    mesh_wing_bone_l_27.quaternion.copy(endpoint_wing_bone_l_27.quaternion);
  }
  mesh_wing_bone_l_27.castShadow = options.castShadow ?? true;
  mesh_wing_bone_l_27.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_bone_l_27.userData.sculptComponent = {"id": "wing-bone-l", "name": "Wing Bone L", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Wing bone along the top edge of the membrane.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-l", "localStart": [0.4, 0.02, -0.18], "localEnd": [0.76, 0.17, -0.27], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.018}, "dimensions": {"width": 0.06, "height": 0.48, "depth": 0.06, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.06, 0.48, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-bone-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_bone_l_27.add(mesh_wing_bone_l_27);
  meshes["wing-bone-l"] = mesh_wing_bone_l_27;
  colliders["wing-bone-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["wing-bone-l"] ??= [];
  destructionGroups["wing-bone-l"].push(node_wing_bone_l_27);

  const attachment_wing_bone_r_28 = {"parentId": "body", "parentSocket": "back-r", "localStart": [-0.4, 0.02, -0.18], "localEnd": [-0.76, 0.17, -0.27], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.018};
  const endpoint_wing_bone_r_28 = makeAttachmentEndpoint(attachment_wing_bone_r_28);
  const node_wing_bone_r_28 = new THREE.Group();
  node_wing_bone_r_28.name = "Wing Bone R__pivot";
  node_wing_bone_r_28.scale.set(1, 1, 1);
  if (endpoint_wing_bone_r_28) {
    node_wing_bone_r_28.position.copy(endpoint_wing_bone_r_28.start);
    node_wing_bone_r_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wing_bone_r_28.position.set(0.0, 0.0, 0.0);
    node_wing_bone_r_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_wing_bone_r_28.userData.sculptComponent = {"id": "wing-bone-r", "name": "Wing Bone R", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Wing bone along the top edge of the membrane.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-r", "localStart": [-0.4, 0.02, -0.18], "localEnd": [-0.76, 0.17, -0.27], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.018}, "dimensions": {"width": 0.06, "height": 0.48, "depth": 0.06, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.06, 0.48, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-bone-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_bone_r_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-bone-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}};
  (nodes["body"] ?? root).add(node_wing_bone_r_28);
  nodes["wing-bone-r"] = node_wing_bone_r_28;
  const mesh_wing_bone_r_28Geometry = endpoint_wing_bone_r_28
    ? new THREE.CylinderGeometry(endpoint_wing_bone_r_28.endRadius, endpoint_wing_bone_r_28.baseRadius, endpoint_wing_bone_r_28.length, 16, 6)
    : new THREE.ConeGeometry(0.5, 1, 24, 1);
  if (!endpoint_wing_bone_r_28) {
    mesh_wing_bone_r_28Geometry.scale(0.06, 0.48, 0.06);
  }
  const mesh_wing_bone_r_28 = new THREE.Mesh(
    mesh_wing_bone_r_28Geometry,
    materialMap["dish-orange"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_bone_r_28.name = "Wing Bone R";
  if (endpoint_wing_bone_r_28) {
    mesh_wing_bone_r_28.position.copy(endpoint_wing_bone_r_28.midpoint);
    mesh_wing_bone_r_28.quaternion.copy(endpoint_wing_bone_r_28.quaternion);
  }
  mesh_wing_bone_r_28.castShadow = options.castShadow ?? true;
  mesh_wing_bone_r_28.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_bone_r_28.userData.sculptComponent = {"id": "wing-bone-r", "name": "Wing Bone R", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.8, "primitive": "cone", "topologyClass": "assembled-solid", "topologyRationale": "Wing bone along the top edge of the membrane.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "back-r", "localStart": [-0.4, 0.02, -0.18], "localEnd": [-0.76, 0.17, -0.27], "contactType": "socket", "overlap": 0.02, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.018}, "dimensions": {"width": 0.06, "height": 0.48, "depth": 0.06, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.06, 0.48, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wing-bone-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dish-orange"}}, "material": "dish-orange", "materialLayers": ["dish-orange"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 138, 31, 1.0)", "secondaryAlbedo": "rgba(217, 117, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_wing_bone_r_28.add(mesh_wing_bone_r_28);
  meshes["wing-bone-r"] = mesh_wing_bone_r_28;
  colliders["wing-bone-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["wing-bone-r"] ??= [];
  destructionGroups["wing-bone-r"].push(node_wing_bone_r_28);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createEchoLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Echo look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "area/soft box", "direction": "upper front-left of the figure", "evidence": "large soft speculars on crown, mitts and feet face upper-left", "intensity": "high"}, {"id": "fill", "type": "soft fill", "direction": "front-right", "evidence": "shadow side of body stays mid-value, never black", "intensity": "medium"}, {"id": "rim", "type": "faint rim", "direction": "behind right", "evidence": "slight edge lift on the right silhouette", "intensity": "low"}, {"id": "environment", "type": "neutral grey studio sweep", "evidence": "background ~#C9C9C9 with no horizon", "notes": "Review renders use ACES filmic tone mapping at exposure 1.0; the game uses a 3-step toon ramp, so tone mapping is review-only."}, {"id": "ground", "type": "contact shadow", "evidence": "soft ground contact shadow under the feet", "notes": "Game uses a directional shadow map plus ambient occlusion contact darkening."}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createEchoEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameEchoCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createEchoPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureEchoRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createEchoInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
