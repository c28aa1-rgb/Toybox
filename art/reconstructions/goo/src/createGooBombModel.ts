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

// Generated from ObjectSculptSpec target: Goo Bomb
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createGooBombModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Goo Bomb";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "hidden", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000", "#000000"], "samplingNotes": "Solid albedo sampled from the de-lit reference region; value changes in the image are shading, not paint."}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 1.0, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "unknown", "finishStyle": "none"},
    options
  );
  materialMap["lime"] = createSculptMaterial(
    "lime",
    {"id": "lime", "name": "lime", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#9BE35E", "color": "#9BE35E", "albedo": {"dominant": "#9BE35E", "secondary": ["#84C150", "#AAFA67"], "samplingNotes": "zone-r2c1 jar"}, "colorVariation": {"palette": ["#9BE35E"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "seam-contact-ao", "region": "where the cap meets the body", "albedoMultiplier": 0.85, "evidenceRef": "detail-inventory/zone-r1c1.png", "notes": "soft contact darkening at the moulded seam"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["grape"] = createSculptMaterial(
    "grape",
    {"id": "grape", "name": "grape", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6A2FA0", "color": "#6A2FA0", "albedo": {"dominant": "#6A2FA0", "secondary": ["#5A2888", "#7534B0"], "samplingNotes": "zone-r0c1 lid"}, "colorVariation": {"palette": ["#6A2FA0"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["goo"] = createSculptMaterial(
    "goo",
    {"id": "goo", "name": "goo", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6FD046", "color": "#6FD046", "albedo": {"dominant": "#6FD046", "secondary": ["#5EB13C", "#7AE54D"], "samplingNotes": "zone-r1c1 drips"}, "colorVariation": {"palette": ["#6FD046"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["yellow"] = createSculptMaterial(
    "yellow",
    {"id": "yellow", "name": "yellow", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#FFE45C", "color": "#FFE45C", "albedo": {"dominant": "#FFE45C", "secondary": ["#D9C24E", "#FFFB65"], "samplingNotes": "zone-r0c2 ring pull"}, "colorVariation": {"palette": ["#FFE45C"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
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
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 0.1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot at the bottom centre; the throw simulation moves this point.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.01, 0.01, 0.01]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
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
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 0.1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot at the bottom centre; the throw simulation moves this point.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.01, 0.01, 0.01]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
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
    node_body_1.position.set(0.0, 0.0874, 0.0);
    node_body_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_body_1.userData.sculptComponent = {"id": "body", "name": "Body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.3279, -0.4886], [0.4303, -0.4205], [0.4877, -0.2614], [0.5, -0.0343], [0.4836, 0.1928], [0.4426, 0.3919], [0.3893, 0.4886], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2422, "height": 0.1748, "depth": 0.2422, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0874, 0], "rotation": [0, 0, 0], "scale": [0.2422, 0.1748, 0.2422]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lime"}}, "material": "lime", "materialLayers": ["lime"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-roundover", "kind": "bevel", "description": "rolled moulded edges that catch a soft highlight", "evidenceRef": "detail-inventory/zone-r1c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(155, 227, 94, 1.0)", "secondaryAlbedo": "rgba(132, 193, 80, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_body_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lime"}};
  (nodes["root"] ?? root).add(node_body_1);
  nodes["body"] = node_body_1;
  const mesh_body_1Geometry = endpoint_body_1
    ? new THREE.CylinderGeometry(endpoint_body_1.endRadius, endpoint_body_1.baseRadius, endpoint_body_1.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.3279, -0.4886], [0.4303, -0.4205], [0.4877, -0.2614], [0.5, -0.0343], [0.4836, 0.1928], [0.4426, 0.3919], [0.3893, 0.4886], [0.0, 0.5]], "segments": 28});
  if (!endpoint_body_1) {
    mesh_body_1Geometry.scale(0.2422, 0.1748, 0.2422);
  }
  const mesh_body_1 = new THREE.Mesh(
    mesh_body_1Geometry,
    materialMap["lime"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_1.name = "Body";
  if (endpoint_body_1) {
    mesh_body_1.position.copy(endpoint_body_1.midpoint);
    mesh_body_1.quaternion.copy(endpoint_body_1.quaternion);
  }
  mesh_body_1.castShadow = options.castShadow ?? true;
  mesh_body_1.receiveShadow = options.receiveShadow ?? true;
  mesh_body_1.userData.sculptComponent = {"id": "body", "name": "Body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.3279, -0.4886], [0.4303, -0.4205], [0.4877, -0.2614], [0.5, -0.0343], [0.4836, 0.1928], [0.4426, 0.3919], [0.3893, 0.4886], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2422, "height": 0.1748, "depth": 0.2422, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0874, 0], "rotation": [0, 0, 0], "scale": [0.2422, 0.1748, 0.2422]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lime"}}, "material": "lime", "materialLayers": ["lime"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-roundover", "kind": "bevel", "description": "rolled moulded edges that catch a soft highlight", "evidenceRef": "detail-inventory/zone-r1c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(155, 227, 94, 1.0)", "secondaryAlbedo": "rgba(132, 193, 80, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_body_1.add(mesh_body_1);
  meshes["body"] = mesh_body_1;
  colliders["body"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_body_1);

  const endpoint_lid_2 = makeAttachmentEndpoint(null);
  const node_lid_2 = new THREE.Group();
  node_lid_2.name = "Lid__pivot";
  node_lid_2.scale.set(1, 1, 1);
  if (endpoint_lid_2) {
    node_lid_2.position.copy(endpoint_lid_2.start);
    node_lid_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_2.position.set(0.0, 0.2036, 0.0);
    node_lid_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_2.userData.sculptComponent = {"id": "lid", "name": "Lid", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.5, -0.5], [0.5, 0.339], [0.4583, 0.4837], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1906, "height": 0.0615, "depth": 0.1906, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.2036, 0], "rotation": [0, 0, 0], "scale": [0.1906, 0.0615, 0.1906]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "seam-step", "kind": "seam", "description": "stepped joint where this part meets the body", "evidenceRef": "detail-inventory/zone-r0c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_2);
  nodes["lid"] = node_lid_2;
  const mesh_lid_2Geometry = endpoint_lid_2
    ? new THREE.CylinderGeometry(endpoint_lid_2.endRadius, endpoint_lid_2.baseRadius, endpoint_lid_2.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.5, -0.5], [0.5, 0.339], [0.4583, 0.4837], [0.0, 0.5]], "segments": 28});
  if (!endpoint_lid_2) {
    mesh_lid_2Geometry.scale(0.1906, 0.0615, 0.1906);
  }
  const mesh_lid_2 = new THREE.Mesh(
    mesh_lid_2Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_2.name = "Lid";
  if (endpoint_lid_2) {
    mesh_lid_2.position.copy(endpoint_lid_2.midpoint);
    mesh_lid_2.quaternion.copy(endpoint_lid_2.quaternion);
  }
  mesh_lid_2.castShadow = options.castShadow ?? true;
  mesh_lid_2.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_2.userData.sculptComponent = {"id": "lid", "name": "Lid", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.5, -0.5], [0.5, 0.339], [0.4583, 0.4837], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1906, "height": 0.0615, "depth": 0.1906, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.2036, 0], "rotation": [0, 0, 0], "scale": [0.1906, 0.0615, 0.1906]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "seam-step", "kind": "seam", "description": "stepped joint where this part meets the body", "evidenceRef": "detail-inventory/zone-r0c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_2.add(mesh_lid_2);
  meshes["lid"] = mesh_lid_2;
  colliders["lid"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid"] ??= [];
  destructionGroups["lid"].push(node_lid_2);

  const endpoint_goo_collar_3 = makeAttachmentEndpoint(null);
  const node_goo_collar_3 = new THREE.Group();
  node_goo_collar_3.name = "Goo Collar__pivot";
  node_goo_collar_3.scale.set(1, 1, 1);
  if (endpoint_goo_collar_3) {
    node_goo_collar_3.position.copy(endpoint_goo_collar_3.start);
    node_goo_collar_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_goo_collar_3.position.set(0.0, 0.1509, 0.0);
    node_goo_collar_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_goo_collar_3.userData.sculptComponent = {"id": "goo-collar", "name": "Goo Collar", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.484, -0.4597], [0.5, -0.0988], [0.468, 0.2802], [0.4, 0.4819], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2482, "height": 0.0496, "depth": 0.2482, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.1509, 0], "rotation": [0, 0, 0], "scale": [0.2482, 0.0496, 0.2482]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "goo-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_goo_collar_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "goo-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_goo_collar_3);
  nodes["goo-collar"] = node_goo_collar_3;
  const mesh_goo_collar_3Geometry = endpoint_goo_collar_3
    ? new THREE.CylinderGeometry(endpoint_goo_collar_3.endRadius, endpoint_goo_collar_3.baseRadius, endpoint_goo_collar_3.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.484, -0.4597], [0.5, -0.0988], [0.468, 0.2802], [0.4, 0.4819], [0.0, 0.5]], "segments": 28});
  if (!endpoint_goo_collar_3) {
    mesh_goo_collar_3Geometry.scale(0.2482, 0.0496, 0.2482);
  }
  const mesh_goo_collar_3 = new THREE.Mesh(
    mesh_goo_collar_3Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_goo_collar_3.name = "Goo Collar";
  if (endpoint_goo_collar_3) {
    mesh_goo_collar_3.position.copy(endpoint_goo_collar_3.midpoint);
    mesh_goo_collar_3.quaternion.copy(endpoint_goo_collar_3.quaternion);
  }
  mesh_goo_collar_3.castShadow = options.castShadow ?? true;
  mesh_goo_collar_3.receiveShadow = options.receiveShadow ?? true;
  mesh_goo_collar_3.userData.sculptComponent = {"id": "goo-collar", "name": "Goo Collar", "level": "meso", "role": "body", "importance": 0.75, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.484, -0.4597], [0.5, -0.0988], [0.468, 0.2802], [0.4, 0.4819], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2482, "height": 0.0496, "depth": 0.2482, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.1509, 0], "rotation": [0, 0, 0], "scale": [0.2482, 0.0496, 0.2482]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "goo-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_goo_collar_3.add(mesh_goo_collar_3);
  meshes["goo-collar"] = mesh_goo_collar_3;
  colliders["goo-collar"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["goo-collar"] ??= [];
  destructionGroups["goo-collar"].push(node_goo_collar_3);

  const endpoint_drip_0_4 = makeAttachmentEndpoint(null);
  const node_drip_0_4 = new THREE.Group();
  node_drip_0_4.name = "Drip 0__pivot";
  node_drip_0_4.scale.set(1, 1, 1);
  if (endpoint_drip_0_4) {
    node_drip_0_4.position.copy(endpoint_drip_0_4.start);
    node_drip_0_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_drip_0_4.position.set(0.0, 0.1107, 0.1152);
    node_drip_0_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_drip_0_4.userData.sculptComponent = {"id": "drip-0", "name": "Drip 0", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0685, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.1107, 0.1152], "rotation": [0, 0.0, 0], "scale": [0.0298, 0.0685, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_0_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_0_4);
  nodes["drip-0"] = node_drip_0_4;
  const mesh_drip_0_4Geometry = endpoint_drip_0_4
    ? new THREE.CylinderGeometry(endpoint_drip_0_4.endRadius, endpoint_drip_0_4.baseRadius, endpoint_drip_0_4.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_0_4) {
    mesh_drip_0_4Geometry.scale(0.0298, 0.0685, 0.0199);
  }
  const mesh_drip_0_4 = new THREE.Mesh(
    mesh_drip_0_4Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_0_4.name = "Drip 0";
  if (endpoint_drip_0_4) {
    mesh_drip_0_4.position.copy(endpoint_drip_0_4.midpoint);
    mesh_drip_0_4.quaternion.copy(endpoint_drip_0_4.quaternion);
  }
  mesh_drip_0_4.castShadow = options.castShadow ?? true;
  mesh_drip_0_4.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_0_4.userData.sculptComponent = {"id": "drip-0", "name": "Drip 0", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0685, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.1107, 0.1152], "rotation": [0, 0.0, 0], "scale": [0.0298, 0.0685, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_0_4.add(mesh_drip_0_4);
  meshes["drip-0"] = mesh_drip_0_4;
  colliders["drip-0"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-0"] ??= [];
  destructionGroups["drip-0"].push(node_drip_0_4);

  const endpoint_drip_1_5 = makeAttachmentEndpoint(null);
  const node_drip_1_5 = new THREE.Group();
  node_drip_1_5.name = "Drip 1__pivot";
  node_drip_1_5.scale.set(1, 1, 1);
  if (endpoint_drip_1_5) {
    node_drip_1_5.position.copy(endpoint_drip_1_5.start);
    node_drip_1_5.rotation.set(0.0, 0.75, 0.0);
  } else {
    node_drip_1_5.position.set(0.0785, 0.1191, 0.0843);
    node_drip_1_5.rotation.set(0.0, 0.75, 0.0);
  }
  node_drip_1_5.userData.sculptComponent = {"id": "drip-1", "name": "Drip 1", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0516, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0785, 0.1191, 0.0843], "rotation": [0, 0.75, 0], "scale": [0.0298, 0.0516, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_1_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_1_5);
  nodes["drip-1"] = node_drip_1_5;
  const mesh_drip_1_5Geometry = endpoint_drip_1_5
    ? new THREE.CylinderGeometry(endpoint_drip_1_5.endRadius, endpoint_drip_1_5.baseRadius, endpoint_drip_1_5.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_1_5) {
    mesh_drip_1_5Geometry.scale(0.0298, 0.0516, 0.0199);
  }
  const mesh_drip_1_5 = new THREE.Mesh(
    mesh_drip_1_5Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_1_5.name = "Drip 1";
  if (endpoint_drip_1_5) {
    mesh_drip_1_5.position.copy(endpoint_drip_1_5.midpoint);
    mesh_drip_1_5.quaternion.copy(endpoint_drip_1_5.quaternion);
  }
  mesh_drip_1_5.castShadow = options.castShadow ?? true;
  mesh_drip_1_5.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_1_5.userData.sculptComponent = {"id": "drip-1", "name": "Drip 1", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0516, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0785, 0.1191, 0.0843], "rotation": [0, 0.75, 0], "scale": [0.0298, 0.0516, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_1_5.add(mesh_drip_1_5);
  meshes["drip-1"] = mesh_drip_1_5;
  colliders["drip-1"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-1"] ??= [];
  destructionGroups["drip-1"].push(node_drip_1_5);

  const endpoint_drip_2_6 = makeAttachmentEndpoint(null);
  const node_drip_2_6 = new THREE.Group();
  node_drip_2_6.name = "Drip 2__pivot";
  node_drip_2_6.scale.set(1, 1, 1);
  if (endpoint_drip_2_6) {
    node_drip_2_6.position.copy(endpoint_drip_2_6.start);
    node_drip_2_6.rotation.set(0.0, 1.45, 0.0);
  } else {
    node_drip_2_6.position.set(0.1144, 0.1142, 0.0139);
    node_drip_2_6.rotation.set(0.0, 1.45, 0.0);
  }
  node_drip_2_6.userData.sculptComponent = {"id": "drip-2", "name": "Drip 2", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0616, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.1144, 0.1142, 0.0139], "rotation": [0, 1.45, 0], "scale": [0.0298, 0.0616, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_2_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_2_6);
  nodes["drip-2"] = node_drip_2_6;
  const mesh_drip_2_6Geometry = endpoint_drip_2_6
    ? new THREE.CylinderGeometry(endpoint_drip_2_6.endRadius, endpoint_drip_2_6.baseRadius, endpoint_drip_2_6.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_2_6) {
    mesh_drip_2_6Geometry.scale(0.0298, 0.0616, 0.0199);
  }
  const mesh_drip_2_6 = new THREE.Mesh(
    mesh_drip_2_6Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_2_6.name = "Drip 2";
  if (endpoint_drip_2_6) {
    mesh_drip_2_6.position.copy(endpoint_drip_2_6.midpoint);
    mesh_drip_2_6.quaternion.copy(endpoint_drip_2_6.quaternion);
  }
  mesh_drip_2_6.castShadow = options.castShadow ?? true;
  mesh_drip_2_6.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_2_6.userData.sculptComponent = {"id": "drip-2", "name": "Drip 2", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0616, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.1144, 0.1142, 0.0139], "rotation": [0, 1.45, 0], "scale": [0.0298, 0.0616, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_2_6.add(mesh_drip_2_6);
  meshes["drip-2"] = mesh_drip_2_6;
  colliders["drip-2"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-2"] ??= [];
  destructionGroups["drip-2"].push(node_drip_2_6);

  const endpoint_drip_3_7 = makeAttachmentEndpoint(null);
  const node_drip_3_7 = new THREE.Group();
  node_drip_3_7.name = "Drip 3__pivot";
  node_drip_3_7.scale.set(1, 1, 1);
  if (endpoint_drip_3_7) {
    node_drip_3_7.position.copy(endpoint_drip_3_7.start);
    node_drip_3_7.rotation.set(0.0, 2.2, 0.0);
  } else {
    node_drip_3_7.position.set(0.0931, 0.1221, -0.0678);
    node_drip_3_7.rotation.set(0.0, 2.2, 0.0);
  }
  node_drip_3_7.userData.sculptComponent = {"id": "drip-3", "name": "Drip 3", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0457, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0931, 0.1221, -0.0678], "rotation": [0, 2.2, 0], "scale": [0.0298, 0.0457, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_3_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_3_7);
  nodes["drip-3"] = node_drip_3_7;
  const mesh_drip_3_7Geometry = endpoint_drip_3_7
    ? new THREE.CylinderGeometry(endpoint_drip_3_7.endRadius, endpoint_drip_3_7.baseRadius, endpoint_drip_3_7.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_3_7) {
    mesh_drip_3_7Geometry.scale(0.0298, 0.0457, 0.0199);
  }
  const mesh_drip_3_7 = new THREE.Mesh(
    mesh_drip_3_7Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_3_7.name = "Drip 3";
  if (endpoint_drip_3_7) {
    mesh_drip_3_7.position.copy(endpoint_drip_3_7.midpoint);
    mesh_drip_3_7.quaternion.copy(endpoint_drip_3_7.quaternion);
  }
  mesh_drip_3_7.castShadow = options.castShadow ?? true;
  mesh_drip_3_7.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_3_7.userData.sculptComponent = {"id": "drip-3", "name": "Drip 3", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0457, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0931, 0.1221, -0.0678], "rotation": [0, 2.2, 0], "scale": [0.0298, 0.0457, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_3_7.add(mesh_drip_3_7);
  meshes["drip-3"] = mesh_drip_3_7;
  colliders["drip-3"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-3"] ??= [];
  destructionGroups["drip-3"].push(node_drip_3_7);

  const endpoint_drip_4_8 = makeAttachmentEndpoint(null);
  const node_drip_4_8 = new THREE.Group();
  node_drip_4_8.name = "Drip 4__pivot";
  node_drip_4_8.scale.set(1, 1, 1);
  if (endpoint_drip_4_8) {
    node_drip_4_8.position.copy(endpoint_drip_4_8.start);
    node_drip_4_8.rotation.set(0.0, 2.95, 0.0);
  } else {
    node_drip_4_8.position.set(0.0219, 0.1132, -0.1131);
    node_drip_4_8.rotation.set(0.0, 2.95, 0.0);
  }
  node_drip_4_8.userData.sculptComponent = {"id": "drip-4", "name": "Drip 4", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0635, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0219, 0.1132, -0.1131], "rotation": [0, 2.95, 0], "scale": [0.0298, 0.0635, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_4_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_4_8);
  nodes["drip-4"] = node_drip_4_8;
  const mesh_drip_4_8Geometry = endpoint_drip_4_8
    ? new THREE.CylinderGeometry(endpoint_drip_4_8.endRadius, endpoint_drip_4_8.baseRadius, endpoint_drip_4_8.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_4_8) {
    mesh_drip_4_8Geometry.scale(0.0298, 0.0635, 0.0199);
  }
  const mesh_drip_4_8 = new THREE.Mesh(
    mesh_drip_4_8Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_4_8.name = "Drip 4";
  if (endpoint_drip_4_8) {
    mesh_drip_4_8.position.copy(endpoint_drip_4_8.midpoint);
    mesh_drip_4_8.quaternion.copy(endpoint_drip_4_8.quaternion);
  }
  mesh_drip_4_8.castShadow = options.castShadow ?? true;
  mesh_drip_4_8.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_4_8.userData.sculptComponent = {"id": "drip-4", "name": "Drip 4", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0635, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0219, 0.1132, -0.1131], "rotation": [0, 2.95, 0], "scale": [0.0298, 0.0635, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_4_8.add(mesh_drip_4_8);
  meshes["drip-4"] = mesh_drip_4_8;
  colliders["drip-4"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-4"] ??= [];
  destructionGroups["drip-4"].push(node_drip_4_8);

  const endpoint_drip_5_9 = makeAttachmentEndpoint(null);
  const node_drip_5_9 = new THREE.Group();
  node_drip_5_9.name = "Drip 5__pivot";
  node_drip_5_9.scale.set(1, 1, 1);
  if (endpoint_drip_5_9) {
    node_drip_5_9.position.copy(endpoint_drip_5_9.start);
    node_drip_5_9.rotation.set(0.0, 3.7, 0.0);
  } else {
    node_drip_5_9.position.set(-0.061, 0.1201, -0.0977);
    node_drip_5_9.rotation.set(0.0, 3.7, 0.0);
  }
  node_drip_5_9.userData.sculptComponent = {"id": "drip-5", "name": "Drip 5", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0496, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.061, 0.1201, -0.0977], "rotation": [0, 3.7, 0], "scale": [0.0298, 0.0496, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_5_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_5_9);
  nodes["drip-5"] = node_drip_5_9;
  const mesh_drip_5_9Geometry = endpoint_drip_5_9
    ? new THREE.CylinderGeometry(endpoint_drip_5_9.endRadius, endpoint_drip_5_9.baseRadius, endpoint_drip_5_9.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_5_9) {
    mesh_drip_5_9Geometry.scale(0.0298, 0.0496, 0.0199);
  }
  const mesh_drip_5_9 = new THREE.Mesh(
    mesh_drip_5_9Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_5_9.name = "Drip 5";
  if (endpoint_drip_5_9) {
    mesh_drip_5_9.position.copy(endpoint_drip_5_9.midpoint);
    mesh_drip_5_9.quaternion.copy(endpoint_drip_5_9.quaternion);
  }
  mesh_drip_5_9.castShadow = options.castShadow ?? true;
  mesh_drip_5_9.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_5_9.userData.sculptComponent = {"id": "drip-5", "name": "Drip 5", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0496, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.061, 0.1201, -0.0977], "rotation": [0, 3.7, 0], "scale": [0.0298, 0.0496, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_5_9.add(mesh_drip_5_9);
  meshes["drip-5"] = mesh_drip_5_9;
  colliders["drip-5"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-5"] ??= [];
  destructionGroups["drip-5"].push(node_drip_5_9);

  const endpoint_drip_6_10 = makeAttachmentEndpoint(null);
  const node_drip_6_10 = new THREE.Group();
  node_drip_6_10.name = "Drip 6__pivot";
  node_drip_6_10.scale.set(1, 1, 1);
  if (endpoint_drip_6_10) {
    node_drip_6_10.position.copy(endpoint_drip_6_10.start);
    node_drip_6_10.rotation.set(0.0, 4.4, 0.0);
  } else {
    node_drip_6_10.position.set(-0.1096, 0.1152, -0.0354);
    node_drip_6_10.rotation.set(0.0, 4.4, 0.0);
  }
  node_drip_6_10.userData.sculptComponent = {"id": "drip-6", "name": "Drip 6", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0596, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.1096, 0.1152, -0.0354], "rotation": [0, 4.4, 0], "scale": [0.0298, 0.0596, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_6_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_6_10);
  nodes["drip-6"] = node_drip_6_10;
  const mesh_drip_6_10Geometry = endpoint_drip_6_10
    ? new THREE.CylinderGeometry(endpoint_drip_6_10.endRadius, endpoint_drip_6_10.baseRadius, endpoint_drip_6_10.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_6_10) {
    mesh_drip_6_10Geometry.scale(0.0298, 0.0596, 0.0199);
  }
  const mesh_drip_6_10 = new THREE.Mesh(
    mesh_drip_6_10Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_6_10.name = "Drip 6";
  if (endpoint_drip_6_10) {
    mesh_drip_6_10.position.copy(endpoint_drip_6_10.midpoint);
    mesh_drip_6_10.quaternion.copy(endpoint_drip_6_10.quaternion);
  }
  mesh_drip_6_10.castShadow = options.castShadow ?? true;
  mesh_drip_6_10.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_6_10.userData.sculptComponent = {"id": "drip-6", "name": "Drip 6", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0596, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.1096, 0.1152, -0.0354], "rotation": [0, 4.4, 0], "scale": [0.0298, 0.0596, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_6_10.add(mesh_drip_6_10);
  meshes["drip-6"] = mesh_drip_6_10;
  colliders["drip-6"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-6"] ??= [];
  destructionGroups["drip-6"].push(node_drip_6_10);

  const endpoint_drip_7_11 = makeAttachmentEndpoint(null);
  const node_drip_7_11 = new THREE.Group();
  node_drip_7_11.name = "Drip 7__pivot";
  node_drip_7_11.scale.set(1, 1, 1);
  if (endpoint_drip_7_11) {
    node_drip_7_11.position.copy(endpoint_drip_7_11.start);
    node_drip_7_11.rotation.set(0.0, 5.2, 0.0);
  } else {
    node_drip_7_11.position.set(-0.1018, 0.1211, 0.054);
    node_drip_7_11.rotation.set(0.0, 5.2, 0.0);
  }
  node_drip_7_11.userData.sculptComponent = {"id": "drip-7", "name": "Drip 7", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0477, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.1018, 0.1211, 0.054], "rotation": [0, 5.2, 0], "scale": [0.0298, 0.0477, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_7_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}};
  (nodes["root"] ?? root).add(node_drip_7_11);
  nodes["drip-7"] = node_drip_7_11;
  const mesh_drip_7_11Geometry = endpoint_drip_7_11
    ? new THREE.CylinderGeometry(endpoint_drip_7_11.endRadius, endpoint_drip_7_11.baseRadius, endpoint_drip_7_11.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_drip_7_11) {
    mesh_drip_7_11Geometry.scale(0.0298, 0.0477, 0.0199);
  }
  const mesh_drip_7_11 = new THREE.Mesh(
    mesh_drip_7_11Geometry,
    materialMap["goo"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drip_7_11.name = "Drip 7";
  if (endpoint_drip_7_11) {
    mesh_drip_7_11.position.copy(endpoint_drip_7_11.midpoint);
    mesh_drip_7_11.quaternion.copy(endpoint_drip_7_11.quaternion);
  }
  mesh_drip_7_11.castShadow = options.castShadow ?? true;
  mesh_drip_7_11.receiveShadow = options.receiveShadow ?? true;
  mesh_drip_7_11.userData.sculptComponent = {"id": "drip-7", "name": "Drip 7", "level": "meso", "role": "detail", "importance": 0.55, "confidence": 0.8, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Drip of goo hanging from the collar, flattened against the jar wall.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0298, "height": 0.0477, "depth": 0.0199, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.1018, 0.1211, 0.054], "rotation": [0, 5.2, 0], "scale": [0.0298, 0.0477, 0.0199]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drip-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "goo"}}, "material": "goo", "materialLayers": ["goo"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 208, 70, 1.0)", "secondaryAlbedo": "rgba(94, 177, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_drip_7_11.add(mesh_drip_7_11);
  meshes["drip-7"] = mesh_drip_7_11;
  colliders["drip-7"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["drip-7"] ??= [];
  destructionGroups["drip-7"].push(node_drip_7_11);

  const endpoint_lid_ridge_0_12 = makeAttachmentEndpoint(null);
  const node_lid_ridge_0_12 = new THREE.Group();
  node_lid_ridge_0_12.name = "Lid Ridge 0__pivot";
  node_lid_ridge_0_12.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_0_12) {
    node_lid_ridge_0_12.position.copy(endpoint_lid_ridge_0_12.start);
    node_lid_ridge_0_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_0_12.position.set(0.0, 0.2026, 0.0933);
    node_lid_ridge_0_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_0_12.userData.sculptComponent = {"id": "lid-ridge-0", "name": "Lid Ridge 0", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.2026, 0.0933], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_0_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_0_12);
  nodes["lid-ridge-0"] = node_lid_ridge_0_12;
  const mesh_lid_ridge_0_12Geometry = endpoint_lid_ridge_0_12
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_0_12.endRadius, endpoint_lid_ridge_0_12.baseRadius, endpoint_lid_ridge_0_12.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_0_12) {
    mesh_lid_ridge_0_12Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_0_12 = new THREE.Mesh(
    mesh_lid_ridge_0_12Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_0_12.name = "Lid Ridge 0";
  if (endpoint_lid_ridge_0_12) {
    mesh_lid_ridge_0_12.position.copy(endpoint_lid_ridge_0_12.midpoint);
    mesh_lid_ridge_0_12.quaternion.copy(endpoint_lid_ridge_0_12.quaternion);
  }
  mesh_lid_ridge_0_12.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_0_12.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_0_12.userData.sculptComponent = {"id": "lid-ridge-0", "name": "Lid Ridge 0", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.2026, 0.0933], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_0_12.add(mesh_lid_ridge_0_12);
  meshes["lid-ridge-0"] = mesh_lid_ridge_0_12;
  colliders["lid-ridge-0"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-0"] ??= [];
  destructionGroups["lid-ridge-0"].push(node_lid_ridge_0_12);

  const endpoint_lid_ridge_1_13 = makeAttachmentEndpoint(null);
  const node_lid_ridge_1_13 = new THREE.Group();
  node_lid_ridge_1_13.name = "Lid Ridge 1__pivot";
  node_lid_ridge_1_13.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_1_13) {
    node_lid_ridge_1_13.position.copy(endpoint_lid_ridge_1_13.start);
    node_lid_ridge_1_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_1_13.position.set(0.0466, 0.2026, 0.0808);
    node_lid_ridge_1_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_1_13.userData.sculptComponent = {"id": "lid-ridge-1", "name": "Lid Ridge 1", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0466, 0.2026, 0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_1_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_1_13);
  nodes["lid-ridge-1"] = node_lid_ridge_1_13;
  const mesh_lid_ridge_1_13Geometry = endpoint_lid_ridge_1_13
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_1_13.endRadius, endpoint_lid_ridge_1_13.baseRadius, endpoint_lid_ridge_1_13.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_1_13) {
    mesh_lid_ridge_1_13Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_1_13 = new THREE.Mesh(
    mesh_lid_ridge_1_13Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_1_13.name = "Lid Ridge 1";
  if (endpoint_lid_ridge_1_13) {
    mesh_lid_ridge_1_13.position.copy(endpoint_lid_ridge_1_13.midpoint);
    mesh_lid_ridge_1_13.quaternion.copy(endpoint_lid_ridge_1_13.quaternion);
  }
  mesh_lid_ridge_1_13.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_1_13.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_1_13.userData.sculptComponent = {"id": "lid-ridge-1", "name": "Lid Ridge 1", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0466, 0.2026, 0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_1_13.add(mesh_lid_ridge_1_13);
  meshes["lid-ridge-1"] = mesh_lid_ridge_1_13;
  colliders["lid-ridge-1"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-1"] ??= [];
  destructionGroups["lid-ridge-1"].push(node_lid_ridge_1_13);

  const endpoint_lid_ridge_2_14 = makeAttachmentEndpoint(null);
  const node_lid_ridge_2_14 = new THREE.Group();
  node_lid_ridge_2_14.name = "Lid Ridge 2__pivot";
  node_lid_ridge_2_14.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_2_14) {
    node_lid_ridge_2_14.position.copy(endpoint_lid_ridge_2_14.start);
    node_lid_ridge_2_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_2_14.position.set(0.0808, 0.2026, 0.0467);
    node_lid_ridge_2_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_2_14.userData.sculptComponent = {"id": "lid-ridge-2", "name": "Lid Ridge 2", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0808, 0.2026, 0.0467], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_2_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_2_14);
  nodes["lid-ridge-2"] = node_lid_ridge_2_14;
  const mesh_lid_ridge_2_14Geometry = endpoint_lid_ridge_2_14
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_2_14.endRadius, endpoint_lid_ridge_2_14.baseRadius, endpoint_lid_ridge_2_14.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_2_14) {
    mesh_lid_ridge_2_14Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_2_14 = new THREE.Mesh(
    mesh_lid_ridge_2_14Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_2_14.name = "Lid Ridge 2";
  if (endpoint_lid_ridge_2_14) {
    mesh_lid_ridge_2_14.position.copy(endpoint_lid_ridge_2_14.midpoint);
    mesh_lid_ridge_2_14.quaternion.copy(endpoint_lid_ridge_2_14.quaternion);
  }
  mesh_lid_ridge_2_14.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_2_14.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_2_14.userData.sculptComponent = {"id": "lid-ridge-2", "name": "Lid Ridge 2", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0808, 0.2026, 0.0467], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_2_14.add(mesh_lid_ridge_2_14);
  meshes["lid-ridge-2"] = mesh_lid_ridge_2_14;
  colliders["lid-ridge-2"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-2"] ??= [];
  destructionGroups["lid-ridge-2"].push(node_lid_ridge_2_14);

  const endpoint_lid_ridge_3_15 = makeAttachmentEndpoint(null);
  const node_lid_ridge_3_15 = new THREE.Group();
  node_lid_ridge_3_15.name = "Lid Ridge 3__pivot";
  node_lid_ridge_3_15.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_3_15) {
    node_lid_ridge_3_15.position.copy(endpoint_lid_ridge_3_15.start);
    node_lid_ridge_3_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_3_15.position.set(0.0933, 0.2026, 0.0);
    node_lid_ridge_3_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_3_15.userData.sculptComponent = {"id": "lid-ridge-3", "name": "Lid Ridge 3", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0933, 0.2026, 0.0], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_3_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_3_15);
  nodes["lid-ridge-3"] = node_lid_ridge_3_15;
  const mesh_lid_ridge_3_15Geometry = endpoint_lid_ridge_3_15
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_3_15.endRadius, endpoint_lid_ridge_3_15.baseRadius, endpoint_lid_ridge_3_15.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_3_15) {
    mesh_lid_ridge_3_15Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_3_15 = new THREE.Mesh(
    mesh_lid_ridge_3_15Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_3_15.name = "Lid Ridge 3";
  if (endpoint_lid_ridge_3_15) {
    mesh_lid_ridge_3_15.position.copy(endpoint_lid_ridge_3_15.midpoint);
    mesh_lid_ridge_3_15.quaternion.copy(endpoint_lid_ridge_3_15.quaternion);
  }
  mesh_lid_ridge_3_15.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_3_15.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_3_15.userData.sculptComponent = {"id": "lid-ridge-3", "name": "Lid Ridge 3", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0933, 0.2026, 0.0], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_3_15.add(mesh_lid_ridge_3_15);
  meshes["lid-ridge-3"] = mesh_lid_ridge_3_15;
  colliders["lid-ridge-3"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-3"] ??= [];
  destructionGroups["lid-ridge-3"].push(node_lid_ridge_3_15);

  const endpoint_lid_ridge_4_16 = makeAttachmentEndpoint(null);
  const node_lid_ridge_4_16 = new THREE.Group();
  node_lid_ridge_4_16.name = "Lid Ridge 4__pivot";
  node_lid_ridge_4_16.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_4_16) {
    node_lid_ridge_4_16.position.copy(endpoint_lid_ridge_4_16.start);
    node_lid_ridge_4_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_4_16.position.set(0.0808, 0.2026, -0.0466);
    node_lid_ridge_4_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_4_16.userData.sculptComponent = {"id": "lid-ridge-4", "name": "Lid Ridge 4", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0808, 0.2026, -0.0466], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_4_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_4_16);
  nodes["lid-ridge-4"] = node_lid_ridge_4_16;
  const mesh_lid_ridge_4_16Geometry = endpoint_lid_ridge_4_16
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_4_16.endRadius, endpoint_lid_ridge_4_16.baseRadius, endpoint_lid_ridge_4_16.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_4_16) {
    mesh_lid_ridge_4_16Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_4_16 = new THREE.Mesh(
    mesh_lid_ridge_4_16Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_4_16.name = "Lid Ridge 4";
  if (endpoint_lid_ridge_4_16) {
    mesh_lid_ridge_4_16.position.copy(endpoint_lid_ridge_4_16.midpoint);
    mesh_lid_ridge_4_16.quaternion.copy(endpoint_lid_ridge_4_16.quaternion);
  }
  mesh_lid_ridge_4_16.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_4_16.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_4_16.userData.sculptComponent = {"id": "lid-ridge-4", "name": "Lid Ridge 4", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0808, 0.2026, -0.0466], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_4_16.add(mesh_lid_ridge_4_16);
  meshes["lid-ridge-4"] = mesh_lid_ridge_4_16;
  colliders["lid-ridge-4"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-4"] ??= [];
  destructionGroups["lid-ridge-4"].push(node_lid_ridge_4_16);

  const endpoint_lid_ridge_5_17 = makeAttachmentEndpoint(null);
  const node_lid_ridge_5_17 = new THREE.Group();
  node_lid_ridge_5_17.name = "Lid Ridge 5__pivot";
  node_lid_ridge_5_17.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_5_17) {
    node_lid_ridge_5_17.position.copy(endpoint_lid_ridge_5_17.start);
    node_lid_ridge_5_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_5_17.position.set(0.0466, 0.2026, -0.0808);
    node_lid_ridge_5_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_5_17.userData.sculptComponent = {"id": "lid-ridge-5", "name": "Lid Ridge 5", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0466, 0.2026, -0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_5_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_5_17);
  nodes["lid-ridge-5"] = node_lid_ridge_5_17;
  const mesh_lid_ridge_5_17Geometry = endpoint_lid_ridge_5_17
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_5_17.endRadius, endpoint_lid_ridge_5_17.baseRadius, endpoint_lid_ridge_5_17.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_5_17) {
    mesh_lid_ridge_5_17Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_5_17 = new THREE.Mesh(
    mesh_lid_ridge_5_17Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_5_17.name = "Lid Ridge 5";
  if (endpoint_lid_ridge_5_17) {
    mesh_lid_ridge_5_17.position.copy(endpoint_lid_ridge_5_17.midpoint);
    mesh_lid_ridge_5_17.quaternion.copy(endpoint_lid_ridge_5_17.quaternion);
  }
  mesh_lid_ridge_5_17.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_5_17.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_5_17.userData.sculptComponent = {"id": "lid-ridge-5", "name": "Lid Ridge 5", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0466, 0.2026, -0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_5_17.add(mesh_lid_ridge_5_17);
  meshes["lid-ridge-5"] = mesh_lid_ridge_5_17;
  colliders["lid-ridge-5"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-5"] ??= [];
  destructionGroups["lid-ridge-5"].push(node_lid_ridge_5_17);

  const endpoint_lid_ridge_6_18 = makeAttachmentEndpoint(null);
  const node_lid_ridge_6_18 = new THREE.Group();
  node_lid_ridge_6_18.name = "Lid Ridge 6__pivot";
  node_lid_ridge_6_18.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_6_18) {
    node_lid_ridge_6_18.position.copy(endpoint_lid_ridge_6_18.start);
    node_lid_ridge_6_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_6_18.position.set(0.0, 0.2026, -0.0933);
    node_lid_ridge_6_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_6_18.userData.sculptComponent = {"id": "lid-ridge-6", "name": "Lid Ridge 6", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.2026, -0.0933], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_6_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_6_18);
  nodes["lid-ridge-6"] = node_lid_ridge_6_18;
  const mesh_lid_ridge_6_18Geometry = endpoint_lid_ridge_6_18
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_6_18.endRadius, endpoint_lid_ridge_6_18.baseRadius, endpoint_lid_ridge_6_18.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_6_18) {
    mesh_lid_ridge_6_18Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_6_18 = new THREE.Mesh(
    mesh_lid_ridge_6_18Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_6_18.name = "Lid Ridge 6";
  if (endpoint_lid_ridge_6_18) {
    mesh_lid_ridge_6_18.position.copy(endpoint_lid_ridge_6_18.midpoint);
    mesh_lid_ridge_6_18.quaternion.copy(endpoint_lid_ridge_6_18.quaternion);
  }
  mesh_lid_ridge_6_18.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_6_18.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_6_18.userData.sculptComponent = {"id": "lid-ridge-6", "name": "Lid Ridge 6", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.2026, -0.0933], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_6_18.add(mesh_lid_ridge_6_18);
  meshes["lid-ridge-6"] = mesh_lid_ridge_6_18;
  colliders["lid-ridge-6"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-6"] ??= [];
  destructionGroups["lid-ridge-6"].push(node_lid_ridge_6_18);

  const endpoint_lid_ridge_7_19 = makeAttachmentEndpoint(null);
  const node_lid_ridge_7_19 = new THREE.Group();
  node_lid_ridge_7_19.name = "Lid Ridge 7__pivot";
  node_lid_ridge_7_19.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_7_19) {
    node_lid_ridge_7_19.position.copy(endpoint_lid_ridge_7_19.start);
    node_lid_ridge_7_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_7_19.position.set(-0.0466, 0.2026, -0.0808);
    node_lid_ridge_7_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_7_19.userData.sculptComponent = {"id": "lid-ridge-7", "name": "Lid Ridge 7", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0466, 0.2026, -0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_7_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_7_19);
  nodes["lid-ridge-7"] = node_lid_ridge_7_19;
  const mesh_lid_ridge_7_19Geometry = endpoint_lid_ridge_7_19
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_7_19.endRadius, endpoint_lid_ridge_7_19.baseRadius, endpoint_lid_ridge_7_19.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_7_19) {
    mesh_lid_ridge_7_19Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_7_19 = new THREE.Mesh(
    mesh_lid_ridge_7_19Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_7_19.name = "Lid Ridge 7";
  if (endpoint_lid_ridge_7_19) {
    mesh_lid_ridge_7_19.position.copy(endpoint_lid_ridge_7_19.midpoint);
    mesh_lid_ridge_7_19.quaternion.copy(endpoint_lid_ridge_7_19.quaternion);
  }
  mesh_lid_ridge_7_19.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_7_19.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_7_19.userData.sculptComponent = {"id": "lid-ridge-7", "name": "Lid Ridge 7", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0466, 0.2026, -0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_7_19.add(mesh_lid_ridge_7_19);
  meshes["lid-ridge-7"] = mesh_lid_ridge_7_19;
  colliders["lid-ridge-7"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-7"] ??= [];
  destructionGroups["lid-ridge-7"].push(node_lid_ridge_7_19);

  const endpoint_lid_ridge_8_20 = makeAttachmentEndpoint(null);
  const node_lid_ridge_8_20 = new THREE.Group();
  node_lid_ridge_8_20.name = "Lid Ridge 8__pivot";
  node_lid_ridge_8_20.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_8_20) {
    node_lid_ridge_8_20.position.copy(endpoint_lid_ridge_8_20.start);
    node_lid_ridge_8_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_8_20.position.set(-0.0808, 0.2026, -0.0467);
    node_lid_ridge_8_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_8_20.userData.sculptComponent = {"id": "lid-ridge-8", "name": "Lid Ridge 8", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0808, 0.2026, -0.0467], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_8_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_8_20);
  nodes["lid-ridge-8"] = node_lid_ridge_8_20;
  const mesh_lid_ridge_8_20Geometry = endpoint_lid_ridge_8_20
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_8_20.endRadius, endpoint_lid_ridge_8_20.baseRadius, endpoint_lid_ridge_8_20.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_8_20) {
    mesh_lid_ridge_8_20Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_8_20 = new THREE.Mesh(
    mesh_lid_ridge_8_20Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_8_20.name = "Lid Ridge 8";
  if (endpoint_lid_ridge_8_20) {
    mesh_lid_ridge_8_20.position.copy(endpoint_lid_ridge_8_20.midpoint);
    mesh_lid_ridge_8_20.quaternion.copy(endpoint_lid_ridge_8_20.quaternion);
  }
  mesh_lid_ridge_8_20.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_8_20.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_8_20.userData.sculptComponent = {"id": "lid-ridge-8", "name": "Lid Ridge 8", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0808, 0.2026, -0.0467], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-8", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_8_20.add(mesh_lid_ridge_8_20);
  meshes["lid-ridge-8"] = mesh_lid_ridge_8_20;
  colliders["lid-ridge-8"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-8"] ??= [];
  destructionGroups["lid-ridge-8"].push(node_lid_ridge_8_20);

  const endpoint_lid_ridge_9_21 = makeAttachmentEndpoint(null);
  const node_lid_ridge_9_21 = new THREE.Group();
  node_lid_ridge_9_21.name = "Lid Ridge 9__pivot";
  node_lid_ridge_9_21.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_9_21) {
    node_lid_ridge_9_21.position.copy(endpoint_lid_ridge_9_21.start);
    node_lid_ridge_9_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_9_21.position.set(-0.0933, 0.2026, -0.0);
    node_lid_ridge_9_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_9_21.userData.sculptComponent = {"id": "lid-ridge-9", "name": "Lid Ridge 9", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0933, 0.2026, -0.0], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_9_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_9_21);
  nodes["lid-ridge-9"] = node_lid_ridge_9_21;
  const mesh_lid_ridge_9_21Geometry = endpoint_lid_ridge_9_21
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_9_21.endRadius, endpoint_lid_ridge_9_21.baseRadius, endpoint_lid_ridge_9_21.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_9_21) {
    mesh_lid_ridge_9_21Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_9_21 = new THREE.Mesh(
    mesh_lid_ridge_9_21Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_9_21.name = "Lid Ridge 9";
  if (endpoint_lid_ridge_9_21) {
    mesh_lid_ridge_9_21.position.copy(endpoint_lid_ridge_9_21.midpoint);
    mesh_lid_ridge_9_21.quaternion.copy(endpoint_lid_ridge_9_21.quaternion);
  }
  mesh_lid_ridge_9_21.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_9_21.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_9_21.userData.sculptComponent = {"id": "lid-ridge-9", "name": "Lid Ridge 9", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0933, 0.2026, -0.0], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-9", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_9_21.add(mesh_lid_ridge_9_21);
  meshes["lid-ridge-9"] = mesh_lid_ridge_9_21;
  colliders["lid-ridge-9"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-9"] ??= [];
  destructionGroups["lid-ridge-9"].push(node_lid_ridge_9_21);

  const endpoint_lid_ridge_10_22 = makeAttachmentEndpoint(null);
  const node_lid_ridge_10_22 = new THREE.Group();
  node_lid_ridge_10_22.name = "Lid Ridge 10__pivot";
  node_lid_ridge_10_22.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_10_22) {
    node_lid_ridge_10_22.position.copy(endpoint_lid_ridge_10_22.start);
    node_lid_ridge_10_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_10_22.position.set(-0.0808, 0.2026, 0.0467);
    node_lid_ridge_10_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_10_22.userData.sculptComponent = {"id": "lid-ridge-10", "name": "Lid Ridge 10", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0808, 0.2026, 0.0467], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_10_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_10_22);
  nodes["lid-ridge-10"] = node_lid_ridge_10_22;
  const mesh_lid_ridge_10_22Geometry = endpoint_lid_ridge_10_22
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_10_22.endRadius, endpoint_lid_ridge_10_22.baseRadius, endpoint_lid_ridge_10_22.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_10_22) {
    mesh_lid_ridge_10_22Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_10_22 = new THREE.Mesh(
    mesh_lid_ridge_10_22Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_10_22.name = "Lid Ridge 10";
  if (endpoint_lid_ridge_10_22) {
    mesh_lid_ridge_10_22.position.copy(endpoint_lid_ridge_10_22.midpoint);
    mesh_lid_ridge_10_22.quaternion.copy(endpoint_lid_ridge_10_22.quaternion);
  }
  mesh_lid_ridge_10_22.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_10_22.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_10_22.userData.sculptComponent = {"id": "lid-ridge-10", "name": "Lid Ridge 10", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0808, 0.2026, 0.0467], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_10_22.add(mesh_lid_ridge_10_22);
  meshes["lid-ridge-10"] = mesh_lid_ridge_10_22;
  colliders["lid-ridge-10"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-10"] ??= [];
  destructionGroups["lid-ridge-10"].push(node_lid_ridge_10_22);

  const endpoint_lid_ridge_11_23 = makeAttachmentEndpoint(null);
  const node_lid_ridge_11_23 = new THREE.Group();
  node_lid_ridge_11_23.name = "Lid Ridge 11__pivot";
  node_lid_ridge_11_23.scale.set(1, 1, 1);
  if (endpoint_lid_ridge_11_23) {
    node_lid_ridge_11_23.position.copy(endpoint_lid_ridge_11_23.start);
    node_lid_ridge_11_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lid_ridge_11_23.position.set(-0.0467, 0.2026, 0.0808);
    node_lid_ridge_11_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_lid_ridge_11_23.userData.sculptComponent = {"id": "lid-ridge-11", "name": "Lid Ridge 11", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0467, 0.2026, 0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_11_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_lid_ridge_11_23);
  nodes["lid-ridge-11"] = node_lid_ridge_11_23;
  const mesh_lid_ridge_11_23Geometry = endpoint_lid_ridge_11_23
    ? new THREE.CylinderGeometry(endpoint_lid_ridge_11_23.endRadius, endpoint_lid_ridge_11_23.baseRadius, endpoint_lid_ridge_11_23.length, 8, 4)
    : buildLatheGeometry({"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12});
  if (!endpoint_lid_ridge_11_23) {
    mesh_lid_ridge_11_23Geometry.scale(0.0218, 0.0536, 0.0218);
  }
  const mesh_lid_ridge_11_23 = new THREE.Mesh(
    mesh_lid_ridge_11_23Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lid_ridge_11_23.name = "Lid Ridge 11";
  if (endpoint_lid_ridge_11_23) {
    mesh_lid_ridge_11_23.position.copy(endpoint_lid_ridge_11_23.midpoint);
    mesh_lid_ridge_11_23.quaternion.copy(endpoint_lid_ridge_11_23.quaternion);
  }
  mesh_lid_ridge_11_23.castShadow = options.castShadow ?? true;
  mesh_lid_ridge_11_23.receiveShadow = options.receiveShadow ?? true;
  mesh_lid_ridge_11_23.userData.sculptComponent = {"id": "lid-ridge-11", "name": "Lid Ridge 11", "level": "micro", "role": "detail", "importance": 0.35, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "One of a ring of identical moulded pieces spaced around the axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 12}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0218, "height": 0.0536, "depth": 0.0218, "units": "meters", "confidence": 0.8}, "transform": {"position": [-0.0467, 0.2026, 0.0808], "rotation": [0, 0, 0], "scale": [0.0218, 0.0536, 0.0218]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lid-ridge-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_lid_ridge_11_23.add(mesh_lid_ridge_11_23);
  meshes["lid-ridge-11"] = mesh_lid_ridge_11_23;
  colliders["lid-ridge-11"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["lid-ridge-11"] ??= [];
  destructionGroups["lid-ridge-11"].push(node_lid_ridge_11_23);

  const endpoint_spout_24 = makeAttachmentEndpoint(null);
  const node_spout_24 = new THREE.Group();
  node_spout_24.name = "Spout__pivot";
  node_spout_24.scale.set(1, 1, 1);
  if (endpoint_spout_24) {
    node_spout_24.position.copy(endpoint_spout_24.start);
    node_spout_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_spout_24.position.set(0.0, 0.0, -0.025);
    node_spout_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_spout_24.userData.sculptComponent = {"id": "spout", "name": "Spout", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat moulded part traced from the front view and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.0179, 0.2353], [-0.0179, 0.2701], [-0.0099, 0.278], [0.0179, 0.278], [0.0258, 0.2701], [0.0258, 0.2353]], "depth": 0.05}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0437, "height": 0.0427, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, -0.025], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spout", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_spout_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spout", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}};
  (nodes["root"] ?? root).add(node_spout_24);
  nodes["spout"] = node_spout_24;
  const mesh_spout_24Geometry = endpoint_spout_24
    ? new THREE.CylinderGeometry(endpoint_spout_24.endRadius, endpoint_spout_24.baseRadius, endpoint_spout_24.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.0179, 0.2353], [-0.0179, 0.2701], [-0.0099, 0.278], [0.0179, 0.278], [0.0258, 0.2701], [0.0258, 0.2353]], "depth": 0.05});
  if (!endpoint_spout_24) {
    mesh_spout_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_spout_24 = new THREE.Mesh(
    mesh_spout_24Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_spout_24.name = "Spout";
  if (endpoint_spout_24) {
    mesh_spout_24.position.copy(endpoint_spout_24.midpoint);
    mesh_spout_24.quaternion.copy(endpoint_spout_24.quaternion);
  }
  mesh_spout_24.castShadow = options.castShadow ?? true;
  mesh_spout_24.receiveShadow = options.receiveShadow ?? true;
  mesh_spout_24.userData.sculptComponent = {"id": "spout", "name": "Spout", "level": "meso", "role": "detail", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat moulded part traced from the front view and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.0179, 0.2353], [-0.0179, 0.2701], [-0.0099, 0.278], [0.0179, 0.278], [0.0258, 0.2701], [0.0258, 0.2353]], "depth": 0.05}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0437, "height": 0.0427, "depth": 0.05, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, -0.025], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spout", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_spout_24.add(mesh_spout_24);
  meshes["spout"] = mesh_spout_24;
  colliders["spout"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["spout"] ??= [];
  destructionGroups["spout"].push(node_spout_24);

  const endpoint_spout_bar_25 = makeAttachmentEndpoint(null);
  const node_spout_bar_25 = new THREE.Group();
  node_spout_bar_25.name = "Spout Bar__pivot";
  node_spout_bar_25.scale.set(1, 1, 1);
  if (endpoint_spout_bar_25) {
    node_spout_bar_25.position.copy(endpoint_spout_bar_25.start);
    node_spout_bar_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_spout_bar_25.position.set(0.0, 0.0, -0.015);
    node_spout_bar_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_spout_bar_25.userData.sculptComponent = {"id": "spout-bar", "name": "Spout Bar", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat moulded part traced from the front view and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.0179, 0.2721], [0.0715, 0.2681], [0.0774, 0.2522], [0.0218, 0.2482]], "depth": 0.03}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0595, "height": 0.0239, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, -0.015], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spout-bar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_spout_bar_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spout-bar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}};
  (nodes["root"] ?? root).add(node_spout_bar_25);
  nodes["spout-bar"] = node_spout_bar_25;
  const mesh_spout_bar_25Geometry = endpoint_spout_bar_25
    ? new THREE.CylinderGeometry(endpoint_spout_bar_25.endRadius, endpoint_spout_bar_25.baseRadius, endpoint_spout_bar_25.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.0179, 0.2721], [0.0715, 0.2681], [0.0774, 0.2522], [0.0218, 0.2482]], "depth": 0.03});
  if (!endpoint_spout_bar_25) {
    mesh_spout_bar_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_spout_bar_25 = new THREE.Mesh(
    mesh_spout_bar_25Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_spout_bar_25.name = "Spout Bar";
  if (endpoint_spout_bar_25) {
    mesh_spout_bar_25.position.copy(endpoint_spout_bar_25.midpoint);
    mesh_spout_bar_25.quaternion.copy(endpoint_spout_bar_25.quaternion);
  }
  mesh_spout_bar_25.castShadow = options.castShadow ?? true;
  mesh_spout_bar_25.receiveShadow = options.receiveShadow ?? true;
  mesh_spout_bar_25.userData.sculptComponent = {"id": "spout-bar", "name": "Spout Bar", "level": "micro", "role": "detail", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat moulded part traced from the front view and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.0179, 0.2721], [0.0715, 0.2681], [0.0774, 0.2522], [0.0218, 0.2482]], "depth": 0.03}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0595, "height": 0.0239, "depth": 0.03, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, -0.015], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spout-bar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_spout_bar_25.add(mesh_spout_bar_25);
  meshes["spout-bar"] = mesh_spout_bar_25;
  colliders["spout-bar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["spout-bar"] ??= [];
  destructionGroups["spout-bar"].push(node_spout_bar_25);

  const endpoint_ring_pull_26 = makeAttachmentEndpoint(null);
  const node_ring_pull_26 = new THREE.Group();
  node_ring_pull_26.name = "Ring Pull__pivot";
  node_ring_pull_26.scale.set(1, 1, 1);
  if (endpoint_ring_pull_26) {
    node_ring_pull_26.position.copy(endpoint_ring_pull_26.start);
    node_ring_pull_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ring_pull_26.position.set(0.1092, 0.2452, 0.0);
    node_ring_pull_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_ring_pull_26.userData.sculptComponent = {"id": "ring-pull", "name": "Ring Pull", "level": "meso", "role": "detail", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1363}, "parent": "root", "attachment": null, "dimensions": {"width": 0.097, "height": 0.097, "depth": 0.163, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.1092, 0.2452, 0], "rotation": [0, 0, 0], "scale": [0.097, 0.097, 0.163]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-pull", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_ring_pull_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-pull", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}};
  (nodes["root"] ?? root).add(node_ring_pull_26);
  nodes["ring-pull"] = node_ring_pull_26;
  const mesh_ring_pull_26Geometry = endpoint_ring_pull_26
    ? new THREE.CylinderGeometry(endpoint_ring_pull_26.endRadius, endpoint_ring_pull_26.baseRadius, endpoint_ring_pull_26.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.0613, 8, 16);
  if (!endpoint_ring_pull_26) {
    mesh_ring_pull_26Geometry.scale(0.097, 0.097, 0.163);
  }
  const mesh_ring_pull_26 = new THREE.Mesh(
    mesh_ring_pull_26Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ring_pull_26.name = "Ring Pull";
  if (endpoint_ring_pull_26) {
    mesh_ring_pull_26.position.copy(endpoint_ring_pull_26.midpoint);
    mesh_ring_pull_26.quaternion.copy(endpoint_ring_pull_26.quaternion);
  }
  mesh_ring_pull_26.castShadow = options.castShadow ?? true;
  mesh_ring_pull_26.receiveShadow = options.receiveShadow ?? true;
  mesh_ring_pull_26.userData.sculptComponent = {"id": "ring-pull", "name": "Ring Pull", "level": "meso", "role": "detail", "importance": 0.8, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1363}, "parent": "root", "attachment": null, "dimensions": {"width": 0.097, "height": 0.097, "depth": 0.163, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.1092, 0.2452, 0], "rotation": [0, 0, 0], "scale": [0.097, 0.097, 0.163]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ring-pull", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_ring_pull_26.add(mesh_ring_pull_26);
  meshes["ring-pull"] = mesh_ring_pull_26;
  colliders["ring-pull"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["ring-pull"] ??= [];
  destructionGroups["ring-pull"].push(node_ring_pull_26);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createGooBombLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Goo Bomb look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "area/soft box", "direction": "upper front-left", "evidence": "broad speculars along the top edges", "intensity": "high"}, {"id": "fill", "type": "soft fill", "direction": "front-right", "evidence": "undersides stay mid-value", "intensity": "medium"}, {"id": "rim", "type": "faint rim", "direction": "behind", "evidence": "slight lift on the lower silhouette", "intensity": "low"}, {"id": "environment", "type": "neutral grey studio sweep", "evidence": "background ~#C9CDD3", "notes": "Review renders use ACES filmic tone mapping at exposure 1.0; the game uses a toon ramp."}, {"id": "ground", "type": "contact shadow", "evidence": "no ground plane in the reference", "notes": "Game uses a directional shadow map and ambient occlusion contact darkening."}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createGooBombEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameGooBombCamera(
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
export function createGooBombPresentationComposer(
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

export function configureGooBombRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createGooBombInspectControls(
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
