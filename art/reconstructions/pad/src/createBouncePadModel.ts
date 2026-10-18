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

// Generated from ObjectSculptSpec target: Bounce Pad
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createBouncePadModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Bounce Pad";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "hidden", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000", "#000000"], "samplingNotes": "Solid albedo sampled from the de-lit reference region; value changes in the image are shading, not paint."}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 1.0, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "unknown", "finishStyle": "none"},
    options
  );
  materialMap["white"] = createSculptMaterial(
    "white",
    {"id": "white", "name": "white", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F3EEEA", "color": "#F3EEEA", "albedo": {"dominant": "#F3EEEA", "secondary": ["#CFCAC7", "#FFFFFF"], "samplingNotes": "zone-r2c1 base, zone-r0c1 star"}, "colorVariation": {"palette": ["#F3EEEA"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "seam-contact-ao", "region": "where the cap meets the body", "albedoMultiplier": 0.85, "evidenceRef": "detail-inventory/zone-r1c1.png", "notes": "soft contact darkening at the moulded seam"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["grape"] = createSculptMaterial(
    "grape",
    {"id": "grape", "name": "grape", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6A2FA0", "color": "#6A2FA0", "albedo": {"dominant": "#6A2FA0", "secondary": ["#5A2888", "#7534B0"], "samplingNotes": "zone-r2c1 spring coils"}, "colorVariation": {"palette": ["#6A2FA0"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["grape-dark"] = createSculptMaterial(
    "grape-dark",
    {"id": "grape-dark", "name": "grape-dark", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4A2370", "color": "#4A2370", "albedo": {"dominant": "#4A2370", "secondary": ["#3F1E5F", "#51267B"], "samplingNotes": "zone-r2c1 spring core"}, "colorVariation": {"palette": ["#4A2370"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["sky"] = createSculptMaterial(
    "sky",
    {"id": "sky", "name": "sky", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4FB3FF", "color": "#4FB3FF", "albedo": {"dominant": "#4FB3FF", "secondary": ["#4398D9", "#57C5FF"], "samplingNotes": "zone-r1c1 mat"}, "colorVariation": {"palette": ["#4FB3FF"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["yellow"] = createSculptMaterial(
    "yellow",
    {"id": "yellow", "name": "yellow", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#FFD84A", "color": "#FFD84A", "albedo": {"dominant": "#FFD84A", "secondary": ["#D9B83F", "#FFEE51"], "samplingNotes": "zone-r1c0 rim"}, "colorVariation": {"palette": ["#FFD84A"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
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

  const endpoint_base_1 = makeAttachmentEndpoint(null);
  const node_base_1 = new THREE.Group();
  node_base_1.name = "Base__pivot";
  node_base_1.scale.set(1, 1, 1);
  if (endpoint_base_1) {
    node_base_1.position.copy(endpoint_base_1.start);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_1.position.set(0.0, 0.0196, 0.0);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_1.userData.sculptComponent = {"id": "base", "name": "Base", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.4759, -0.4258], [0.5, -0.0499], [0.4759, 0.4488], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2832, "height": 0.0391, "depth": 0.2832, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0196, 0], "rotation": [0, 0, 0], "scale": [0.2832, 0.0391, 0.2832]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white"}}, "material": "white", "materialLayers": ["white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-roundover", "kind": "bevel", "description": "rolled moulded edges that catch a soft highlight", "evidenceRef": "detail-inventory/zone-r1c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 238, 234, 1.0)", "secondaryAlbedo": "rgba(207, 202, 199, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_base_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white"}};
  (nodes["root"] ?? root).add(node_base_1);
  nodes["base"] = node_base_1;
  const mesh_base_1Geometry = endpoint_base_1
    ? new THREE.CylinderGeometry(endpoint_base_1.endRadius, endpoint_base_1.baseRadius, endpoint_base_1.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.4759, -0.4258], [0.5, -0.0499], [0.4759, 0.4488], [0.0, 0.5]], "segments": 28});
  if (!endpoint_base_1) {
    mesh_base_1Geometry.scale(0.2832, 0.0391, 0.2832);
  }
  const mesh_base_1 = new THREE.Mesh(
    mesh_base_1Geometry,
    materialMap["white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_1.name = "Base";
  if (endpoint_base_1) {
    mesh_base_1.position.copy(endpoint_base_1.midpoint);
    mesh_base_1.quaternion.copy(endpoint_base_1.quaternion);
  }
  mesh_base_1.castShadow = options.castShadow ?? true;
  mesh_base_1.receiveShadow = options.receiveShadow ?? true;
  mesh_base_1.userData.sculptComponent = {"id": "base", "name": "Base", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.4759, -0.4258], [0.5, -0.0499], [0.4759, 0.4488], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.2832, "height": 0.0391, "depth": 0.2832, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0196, 0], "rotation": [0, 0, 0], "scale": [0.2832, 0.0391, 0.2832]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white"}}, "material": "white", "materialLayers": ["white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-roundover", "kind": "bevel", "description": "rolled moulded edges that catch a soft highlight", "evidenceRef": "detail-inventory/zone-r1c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 238, 234, 1.0)", "secondaryAlbedo": "rgba(207, 202, 199, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_base_1.add(mesh_base_1);
  meshes["base"] = mesh_base_1;
  colliders["base"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["base"] ??= [];
  destructionGroups["base"].push(node_base_1);

  const endpoint_spring_core_2 = makeAttachmentEndpoint(null);
  const node_spring_core_2 = new THREE.Group();
  node_spring_core_2.name = "Spring Core__pivot";
  node_spring_core_2.scale.set(1, 1, 1);
  if (endpoint_spring_core_2) {
    node_spring_core_2.position.copy(endpoint_spring_core_2.start);
    node_spring_core_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_spring_core_2.position.set(0.0, 0.0928, 0.0);
    node_spring_core_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_spring_core_2.userData.sculptComponent = {"id": "spring-core", "name": "Spring Core", "level": "meso", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0782, "height": 0.1114, "depth": 0.0782, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0928, 0], "rotation": [0, 0, 0], "scale": [0.0782, 0.1114, 0.0782]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spring-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape-dark"}}, "material": "grape-dark", "materialLayers": ["grape-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "seam-step", "kind": "seam", "description": "stepped joint where this part meets the body", "evidenceRef": "detail-inventory/zone-r0c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 35, 112, 1.0)", "secondaryAlbedo": "rgba(63, 30, 95, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_spring_core_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spring-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape-dark"}};
  (nodes["root"] ?? root).add(node_spring_core_2);
  nodes["spring-core"] = node_spring_core_2;
  const mesh_spring_core_2Geometry = endpoint_spring_core_2
    ? new THREE.CylinderGeometry(endpoint_spring_core_2.endRadius, endpoint_spring_core_2.baseRadius, endpoint_spring_core_2.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 28});
  if (!endpoint_spring_core_2) {
    mesh_spring_core_2Geometry.scale(0.0782, 0.1114, 0.0782);
  }
  const mesh_spring_core_2 = new THREE.Mesh(
    mesh_spring_core_2Geometry,
    materialMap["grape-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_spring_core_2.name = "Spring Core";
  if (endpoint_spring_core_2) {
    mesh_spring_core_2.position.copy(endpoint_spring_core_2.midpoint);
    mesh_spring_core_2.quaternion.copy(endpoint_spring_core_2.quaternion);
  }
  mesh_spring_core_2.castShadow = options.castShadow ?? true;
  mesh_spring_core_2.receiveShadow = options.receiveShadow ?? true;
  mesh_spring_core_2.userData.sculptComponent = {"id": "spring-core", "name": "Spring Core", "level": "meso", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.5, -0.5], [0.5, 0.5], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.0782, "height": 0.1114, "depth": 0.0782, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.0928, 0], "rotation": [0, 0, 0], "scale": [0.0782, 0.1114, 0.0782]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spring-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape-dark"}}, "material": "grape-dark", "materialLayers": ["grape-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "seam-step", "kind": "seam", "description": "stepped joint where this part meets the body", "evidenceRef": "detail-inventory/zone-r0c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 35, 112, 1.0)", "secondaryAlbedo": "rgba(63, 30, 95, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_spring_core_2.add(mesh_spring_core_2);
  meshes["spring-core"] = mesh_spring_core_2;
  colliders["spring-core"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["spring-core"] ??= [];
  destructionGroups["spring-core"].push(node_spring_core_2);

  const endpoint_coil_0_3 = makeAttachmentEndpoint(null);
  const node_coil_0_3 = new THREE.Group();
  node_coil_0_3.name = "Coil 0__pivot";
  node_coil_0_3.scale.set(1, 1, 1);
  if (endpoint_coil_0_3) {
    node_coil_0_3.position.copy(endpoint_coil_0_3.start);
    node_coil_0_3.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_coil_0_3.position.set(0.0, 0.0537, 0.0);
    node_coil_0_3.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_coil_0_3.userData.sculptComponent = {"id": "coil-0", "name": "Coil 0", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.0537, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_0_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_coil_0_3);
  nodes["coil-0"] = node_coil_0_3;
  const mesh_coil_0_3Geometry = endpoint_coil_0_3
    ? new THREE.CylinderGeometry(endpoint_coil_0_3.endRadius, endpoint_coil_0_3.baseRadius, endpoint_coil_0_3.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.0821, 8, 16);
  if (!endpoint_coil_0_3) {
    mesh_coil_0_3Geometry.scale(0.1541, 0.1541, 0.1827);
  }
  const mesh_coil_0_3 = new THREE.Mesh(
    mesh_coil_0_3Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coil_0_3.name = "Coil 0";
  if (endpoint_coil_0_3) {
    mesh_coil_0_3.position.copy(endpoint_coil_0_3.midpoint);
    mesh_coil_0_3.quaternion.copy(endpoint_coil_0_3.quaternion);
  }
  mesh_coil_0_3.castShadow = options.castShadow ?? true;
  mesh_coil_0_3.receiveShadow = options.receiveShadow ?? true;
  mesh_coil_0_3.userData.sculptComponent = {"id": "coil-0", "name": "Coil 0", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.0537, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_0_3.add(mesh_coil_0_3);
  meshes["coil-0"] = mesh_coil_0_3;
  colliders["coil-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["coil-0"] ??= [];
  destructionGroups["coil-0"].push(node_coil_0_3);

  const endpoint_coil_1_4 = makeAttachmentEndpoint(null);
  const node_coil_1_4 = new THREE.Group();
  node_coil_1_4.name = "Coil 1__pivot";
  node_coil_1_4.scale.set(1, 1, 1);
  if (endpoint_coil_1_4) {
    node_coil_1_4.position.copy(endpoint_coil_1_4.start);
    node_coil_1_4.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_coil_1_4.position.set(0.0, 0.082, 0.0);
    node_coil_1_4.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_coil_1_4.userData.sculptComponent = {"id": "coil-1", "name": "Coil 1", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.082, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_1_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_coil_1_4);
  nodes["coil-1"] = node_coil_1_4;
  const mesh_coil_1_4Geometry = endpoint_coil_1_4
    ? new THREE.CylinderGeometry(endpoint_coil_1_4.endRadius, endpoint_coil_1_4.baseRadius, endpoint_coil_1_4.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.0821, 8, 16);
  if (!endpoint_coil_1_4) {
    mesh_coil_1_4Geometry.scale(0.1541, 0.1541, 0.1827);
  }
  const mesh_coil_1_4 = new THREE.Mesh(
    mesh_coil_1_4Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coil_1_4.name = "Coil 1";
  if (endpoint_coil_1_4) {
    mesh_coil_1_4.position.copy(endpoint_coil_1_4.midpoint);
    mesh_coil_1_4.quaternion.copy(endpoint_coil_1_4.quaternion);
  }
  mesh_coil_1_4.castShadow = options.castShadow ?? true;
  mesh_coil_1_4.receiveShadow = options.receiveShadow ?? true;
  mesh_coil_1_4.userData.sculptComponent = {"id": "coil-1", "name": "Coil 1", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.082, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_1_4.add(mesh_coil_1_4);
  meshes["coil-1"] = mesh_coil_1_4;
  colliders["coil-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["coil-1"] ??= [];
  destructionGroups["coil-1"].push(node_coil_1_4);

  const endpoint_coil_2_5 = makeAttachmentEndpoint(null);
  const node_coil_2_5 = new THREE.Group();
  node_coil_2_5.name = "Coil 2__pivot";
  node_coil_2_5.scale.set(1, 1, 1);
  if (endpoint_coil_2_5) {
    node_coil_2_5.position.copy(endpoint_coil_2_5.start);
    node_coil_2_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_coil_2_5.position.set(0.0, 0.1104, 0.0);
    node_coil_2_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_coil_2_5.userData.sculptComponent = {"id": "coil-2", "name": "Coil 2", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.1104, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_2_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_coil_2_5);
  nodes["coil-2"] = node_coil_2_5;
  const mesh_coil_2_5Geometry = endpoint_coil_2_5
    ? new THREE.CylinderGeometry(endpoint_coil_2_5.endRadius, endpoint_coil_2_5.baseRadius, endpoint_coil_2_5.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.0821, 8, 16);
  if (!endpoint_coil_2_5) {
    mesh_coil_2_5Geometry.scale(0.1541, 0.1541, 0.1827);
  }
  const mesh_coil_2_5 = new THREE.Mesh(
    mesh_coil_2_5Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coil_2_5.name = "Coil 2";
  if (endpoint_coil_2_5) {
    mesh_coil_2_5.position.copy(endpoint_coil_2_5.midpoint);
    mesh_coil_2_5.quaternion.copy(endpoint_coil_2_5.quaternion);
  }
  mesh_coil_2_5.castShadow = options.castShadow ?? true;
  mesh_coil_2_5.receiveShadow = options.receiveShadow ?? true;
  mesh_coil_2_5.userData.sculptComponent = {"id": "coil-2", "name": "Coil 2", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.1104, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_2_5.add(mesh_coil_2_5);
  meshes["coil-2"] = mesh_coil_2_5;
  colliders["coil-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["coil-2"] ??= [];
  destructionGroups["coil-2"].push(node_coil_2_5);

  const endpoint_coil_3_6 = makeAttachmentEndpoint(null);
  const node_coil_3_6 = new THREE.Group();
  node_coil_3_6.name = "Coil 3__pivot";
  node_coil_3_6.scale.set(1, 1, 1);
  if (endpoint_coil_3_6) {
    node_coil_3_6.position.copy(endpoint_coil_3_6.start);
    node_coil_3_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_coil_3_6.position.set(0.0, 0.1367, 0.0);
    node_coil_3_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_coil_3_6.userData.sculptComponent = {"id": "coil-3", "name": "Coil 3", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.1367, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_3_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_coil_3_6);
  nodes["coil-3"] = node_coil_3_6;
  const mesh_coil_3_6Geometry = endpoint_coil_3_6
    ? new THREE.CylinderGeometry(endpoint_coil_3_6.endRadius, endpoint_coil_3_6.baseRadius, endpoint_coil_3_6.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.0821, 8, 16);
  if (!endpoint_coil_3_6) {
    mesh_coil_3_6Geometry.scale(0.1541, 0.1541, 0.1827);
  }
  const mesh_coil_3_6 = new THREE.Mesh(
    mesh_coil_3_6Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_coil_3_6.name = "Coil 3";
  if (endpoint_coil_3_6) {
    mesh_coil_3_6.position.copy(endpoint_coil_3_6.midpoint);
    mesh_coil_3_6.quaternion.copy(endpoint_coil_3_6.quaternion);
  }
  mesh_coil_3_6.castShadow = options.castShadow ?? true;
  mesh_coil_3_6.receiveShadow = options.receiveShadow ?? true;
  mesh_coil_3_6.userData.sculptComponent = {"id": "coil-3", "name": "Coil 3", "level": "meso", "role": "detail", "importance": 0.75, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1824}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1541, "height": 0.1541, "depth": 0.1827, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.1367, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.1541, 0.1541, 0.1827]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 47, 160, 1.0)", "secondaryAlbedo": "rgba(90, 40, 136, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_coil_3_6.add(mesh_coil_3_6);
  meshes["coil-3"] = mesh_coil_3_6;
  colliders["coil-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["coil-3"] ??= [];
  destructionGroups["coil-3"].push(node_coil_3_6);

  const endpoint_mat_7 = makeAttachmentEndpoint(null);
  const node_mat_7 = new THREE.Group();
  node_mat_7.name = "Mat__pivot";
  node_mat_7.scale.set(1, 1, 1);
  if (endpoint_mat_7) {
    node_mat_7.position.copy(endpoint_mat_7.start);
    node_mat_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_mat_7.position.set(0.0, 0.1689, 0.0);
    node_mat_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_mat_7.userData.sculptComponent = {"id": "mat", "name": "Mat", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.483, -0.5], [0.5, -0.1307], [0.4773, 0.3949], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.3438, "height": 0.0371, "depth": 0.3438, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.1689, 0], "rotation": [0, 0, 0], "scale": [0.3438, 0.0371, 0.3438]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sky"}}, "material": "sky", "materialLayers": ["sky"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(79, 179, 255, 1.0)", "secondaryAlbedo": "rgba(67, 152, 217, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_mat_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sky"}};
  (nodes["root"] ?? root).add(node_mat_7);
  nodes["mat"] = node_mat_7;
  const mesh_mat_7Geometry = endpoint_mat_7
    ? new THREE.CylinderGeometry(endpoint_mat_7.endRadius, endpoint_mat_7.baseRadius, endpoint_mat_7.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.5], [0.483, -0.5], [0.5, -0.1307], [0.4773, 0.3949], [0.0, 0.5]], "segments": 28});
  if (!endpoint_mat_7) {
    mesh_mat_7Geometry.scale(0.3438, 0.0371, 0.3438);
  }
  const mesh_mat_7 = new THREE.Mesh(
    mesh_mat_7Geometry,
    materialMap["sky"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mat_7.name = "Mat";
  if (endpoint_mat_7) {
    mesh_mat_7.position.copy(endpoint_mat_7.midpoint);
    mesh_mat_7.quaternion.copy(endpoint_mat_7.quaternion);
  }
  mesh_mat_7.castShadow = options.castShadow ?? true;
  mesh_mat_7.receiveShadow = options.receiveShadow ?? true;
  mesh_mat_7.userData.sculptComponent = {"id": "mat", "name": "Mat", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Round moulded body traced from the front silhouette and spun around the vertical axis.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, -0.5], [0.483, -0.5], [0.5, -0.1307], [0.4773, 0.3949], [0.0, 0.5]], "segments": 28}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.3438, "height": 0.0371, "depth": 0.3438, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.1689, 0], "rotation": [0, 0, 0], "scale": [0.3438, 0.0371, 0.3438]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sky"}}, "material": "sky", "materialLayers": ["sky"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(79, 179, 255, 1.0)", "secondaryAlbedo": "rgba(67, 152, 217, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_mat_7.add(mesh_mat_7);
  meshes["mat"] = mesh_mat_7;
  colliders["mat"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["mat"] ??= [];
  destructionGroups["mat"].push(node_mat_7);

  const endpoint_rim_8 = makeAttachmentEndpoint(null);
  const node_rim_8 = new THREE.Group();
  node_rim_8.name = "Rim__pivot";
  node_rim_8.scale.set(1, 1, 1);
  if (endpoint_rim_8) {
    node_rim_8.position.copy(endpoint_rim_8.start);
    node_rim_8.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_rim_8.position.set(0.0, 0.17, 0.0);
    node_rim_8.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_rim_8.userData.sculptComponent = {"id": "rim", "name": "Rim", "level": "meso", "role": "detail", "importance": 0.9, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1109}, "parent": "root", "attachment": null, "dimensions": {"width": 0.3907, "height": 0.3907, "depth": 0.4508, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.17, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.3907, 0.3907, 0.4508]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 216, 74, 1.0)", "secondaryAlbedo": "rgba(217, 184, 63, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rim_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}};
  (nodes["root"] ?? root).add(node_rim_8);
  nodes["rim"] = node_rim_8;
  const mesh_rim_8Geometry = endpoint_rim_8
    ? new THREE.CylinderGeometry(endpoint_rim_8.endRadius, endpoint_rim_8.baseRadius, endpoint_rim_8.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.0499, 8, 16);
  if (!endpoint_rim_8) {
    mesh_rim_8Geometry.scale(0.3907, 0.3907, 0.4508);
  }
  const mesh_rim_8 = new THREE.Mesh(
    mesh_rim_8Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_8.name = "Rim";
  if (endpoint_rim_8) {
    mesh_rim_8.position.copy(endpoint_rim_8.midpoint);
    mesh_rim_8.quaternion.copy(endpoint_rim_8.quaternion);
  }
  mesh_rim_8.castShadow = options.castShadow ?? true;
  mesh_rim_8.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_8.userData.sculptComponent = {"id": "rim", "name": "Rim", "level": "meso", "role": "detail", "importance": 0.9, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Moulded ring: torus sized from its traced inner and outer radius.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.1109}, "parent": "root", "attachment": null, "dimensions": {"width": 0.3907, "height": 0.3907, "depth": 0.4508, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.0, 0.17, 0], "rotation": [1.5707963267948966, 0, 0], "scale": [0.3907, 0.3907, 0.4508]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 216, 74, 1.0)", "secondaryAlbedo": "rgba(217, 184, 63, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_rim_8.add(mesh_rim_8);
  meshes["rim"] = mesh_rim_8;
  colliders["rim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["rim"] ??= [];
  destructionGroups["rim"].push(node_rim_8);

  const endpoint_star_9 = makeAttachmentEndpoint(null);
  const node_star_9 = new THREE.Group();
  node_star_9.name = "Star__pivot";
  node_star_9.scale.set(1, 1, 1);
  if (endpoint_star_9) {
    node_star_9.position.copy(endpoint_star_9.start);
    node_star_9.rotation.set(-1.5707963267948966, 0.0, 0.0);
  } else {
    node_star_9.position.set(0.0, 0.1895, 0.0);
    node_star_9.rotation.set(-1.5707963267948966, 0.0, 0.0);
  }
  node_star_9.userData.sculptComponent = {"id": "star", "name": "Star", "level": "meso", "role": "detail", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat star decal raised a little off the mat: an extruded outline laid flat.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.0, 0.0928], [-0.023, 0.0316], [-0.0883, 0.0287], [-0.0372, -0.0121], [-0.0545, -0.0751], [-0.0, -0.0391], [0.0545, -0.0751], [0.0372, -0.0121], [0.0883, 0.0287], [0.023, 0.0316]], "depth": 0.006}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1856, "height": 0.1856, "depth": 0.006, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.1895, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "star", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white"}}, "material": "white", "materialLayers": ["white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 238, 234, 1.0)", "secondaryAlbedo": "rgba(207, 202, 199, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_star_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "star", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white"}};
  (nodes["root"] ?? root).add(node_star_9);
  nodes["star"] = node_star_9;
  const mesh_star_9Geometry = endpoint_star_9
    ? new THREE.CylinderGeometry(endpoint_star_9.endRadius, endpoint_star_9.baseRadius, endpoint_star_9.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.0, 0.0928], [-0.023, 0.0316], [-0.0883, 0.0287], [-0.0372, -0.0121], [-0.0545, -0.0751], [-0.0, -0.0391], [0.0545, -0.0751], [0.0372, -0.0121], [0.0883, 0.0287], [0.023, 0.0316]], "depth": 0.006});
  if (!endpoint_star_9) {
    mesh_star_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_star_9 = new THREE.Mesh(
    mesh_star_9Geometry,
    materialMap["white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_star_9.name = "Star";
  if (endpoint_star_9) {
    mesh_star_9.position.copy(endpoint_star_9.midpoint);
    mesh_star_9.quaternion.copy(endpoint_star_9.quaternion);
  }
  mesh_star_9.castShadow = options.castShadow ?? true;
  mesh_star_9.receiveShadow = options.receiveShadow ?? true;
  mesh_star_9.userData.sculptComponent = {"id": "star", "name": "Star", "level": "meso", "role": "detail", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Flat star decal raised a little off the mat: an extruded outline laid flat.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.0, 0.0928], [-0.023, 0.0316], [-0.0883, 0.0287], [-0.0372, -0.0121], [-0.0545, -0.0751], [-0.0, -0.0391], [0.0545, -0.0751], [0.0372, -0.0121], [0.0883, 0.0287], [0.023, 0.0316]], "depth": 0.006}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.1856, "height": 0.1856, "depth": 0.006, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.1895, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "star", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white"}}, "material": "white", "materialLayers": ["white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 238, 234, 1.0)", "secondaryAlbedo": "rgba(207, 202, 199, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_star_9.add(mesh_star_9);
  meshes["star"] = mesh_star_9;
  colliders["star"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["star"] ??= [];
  destructionGroups["star"].push(node_star_9);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createBouncePadLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Bounce Pad look-dev lights";
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
export function createBouncePadEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameBouncePadCamera(
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
export function createBouncePadPresentationComposer(
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

export function configureBouncePadRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createBouncePadInspectControls(
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
