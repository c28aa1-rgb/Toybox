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

// Generated from ObjectSculptSpec target: Longshot
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createLongshotModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Longshot";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "hidden", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": ["#000000", "#000000"], "samplingNotes": "Solid albedo sampled from the de-lit reference region; value changes in the image are shading, not paint."}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 1.0, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "unknown", "finishStyle": "none"},
    options
  );
  materialMap["mint"] = createSculptMaterial(
    "mint",
    {"id": "mint", "name": "mint", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#3DDBB4", "color": "#3DDBB4", "albedo": {"dominant": "#3DDBB4", "secondary": ["#34BA99", "#43F1C6"], "samplingNotes": "zone-r1c0 stock"}, "colorVariation": {"palette": ["#3DDBB4"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "seam-contact-ao", "region": "where parts meet (grip root, barrel mount)", "albedoMultiplier": 0.85, "evidenceRef": "detail-inventory/zone-r1c1.png", "notes": "soft contact darkening at moulded seams"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["grape"] = createSculptMaterial(
    "grape",
    {"id": "grape", "name": "grape", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#5B2A86", "color": "#5B2A86", "albedo": {"dominant": "#5B2A86", "secondary": ["#4D2472", "#642E93"], "samplingNotes": "zone-r1c2 barrel, zone-r1c1 scope"}, "colorVariation": {"palette": ["#5B2A86"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["yellow"] = createSculptMaterial(
    "yellow",
    {"id": "yellow", "name": "yellow", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#FFE45C", "color": "#FFE45C", "albedo": {"dominant": "#FFE45C", "secondary": ["#D9C24E", "#FFFB65"], "samplingNotes": "zone-r1c0 scope caps"}, "colorVariation": {"palette": ["#FFE45C"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
    options
  );
  materialMap["mint-light"] = createSculptMaterial(
    "mint-light",
    {"id": "mint-light", "name": "mint-light", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6FE6C8", "color": "#6FE6C8", "albedo": {"dominant": "#6FE6C8", "secondary": ["#5EC4AA", "#7AFDDC"], "samplingNotes": "zone-r1c1 fore-end panel"}, "colorVariation": {"palette": ["#6FE6C8"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.03, "map": "uniform-scalar", "localResponse": "uniform gloss; moulded toy plastic has no wear"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.15, "contactShadowBias": 0.3, "notes": "Soft contact darkening where parts meet."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "textureless": {"declared": true, "evidence": ["albedo-samples.json: region medians are flat; value change across the part follows the light falloff, not a pattern", "detail-inventory zones show no grain, print, seam texture or pores at 1254 px"]}, "materialClass": "plastic", "finishStyle": "gloss"},
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
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 0.1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot at the grip top; the hero mitt socket holds this point.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.01, 0.01, 0.01]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "muzzle", "localPosition": [0, 0, 0.79], "localRotation": [0, 0, 0], "purpose": "muzzle flash and bullet origin"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "muzzle", "localPosition": [0, 0, 0.79], "localRotation": [0, 0, 0], "purpose": "muzzle flash and bullet origin"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
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
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Root", "level": "macro", "role": "root", "importance": 0.1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible pivot at the grip top; the hero mitt socket holds this point.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.01, "height": 0.01, "depth": 0.01, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.01, 0.01, 0.01]}, "actionProfile": {"animationRole": "root-motion", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "muzzle", "localPosition": [0, 0, 0.79], "localRotation": [0, 0, 0], "purpose": "muzzle flash and bullet origin"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);
  const socket_root_muzzle_0 = new THREE.Object3D();
  socket_root_muzzle_0.name = "muzzle";
  socket_root_muzzle_0.position.set(0.0, 0.0, 0.79);
  socket_root_muzzle_0.rotation.set(0.0, 0.0, 0.0);
  socket_root_muzzle_0.userData.socket = {"id": "muzzle", "localPosition": [0, 0, 0.79], "localRotation": [0, 0, 0], "purpose": "muzzle flash and bullet origin"};
  node_root_0.add(socket_root_muzzle_0);
  sockets["root:muzzle"] = socket_root_muzzle_0;

  const endpoint_stock_1 = makeAttachmentEndpoint(null);
  const node_stock_1 = new THREE.Group();
  node_stock_1.name = "Stock__pivot";
  node_stock_1.scale.set(1, 1, 1);
  if (endpoint_stock_1) {
    node_stock_1.position.copy(endpoint_stock_1.start);
    node_stock_1.rotation.set(0.0, -1.5707963267948966, 0.0);
  } else {
    node_stock_1.position.set(0.045, 0.0, 0.0);
    node_stock_1.rotation.set(0.0, -1.5707963267948966, 0.0);
  }
  node_stock_1.userData.sculptComponent = {"id": "stock", "name": "Stock", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.5134, 0.0737], [-0.2868, 0.0819], [-0.1857, 0.0382], [0.3605, 0.0983], [0.3605, 0.0], [-0.1584, -0.0218], [-0.2021, -0.0765], [-0.3113, -0.0819], [-0.4315, -0.1202], [-0.5053, -0.1202]], "depth": 0.09}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.09, "height": 0.2185, "depth": 0.8739, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.045, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}}, "material": "mint", "materialLayers": ["mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-roundover", "kind": "bevel", "description": "rolled moulded edges that catch a soft highlight along the outline", "evidenceRef": "detail-inventory/zone-r1c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(61, 219, 180, 1.0)", "secondaryAlbedo": "rgba(52, 186, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stock_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}};
  (nodes["root"] ?? root).add(node_stock_1);
  nodes["stock"] = node_stock_1;
  const mesh_stock_1Geometry = endpoint_stock_1
    ? new THREE.CylinderGeometry(endpoint_stock_1.endRadius, endpoint_stock_1.baseRadius, endpoint_stock_1.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.5134, 0.0737], [-0.2868, 0.0819], [-0.1857, 0.0382], [0.3605, 0.0983], [0.3605, 0.0], [-0.1584, -0.0218], [-0.2021, -0.0765], [-0.3113, -0.0819], [-0.4315, -0.1202], [-0.5053, -0.1202]], "depth": 0.09});
  if (!endpoint_stock_1) {
    mesh_stock_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_stock_1 = new THREE.Mesh(
    mesh_stock_1Geometry,
    materialMap["mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stock_1.name = "Stock";
  if (endpoint_stock_1) {
    mesh_stock_1.position.copy(endpoint_stock_1.midpoint);
    mesh_stock_1.quaternion.copy(endpoint_stock_1.quaternion);
  }
  mesh_stock_1.castShadow = options.castShadow ?? true;
  mesh_stock_1.receiveShadow = options.receiveShadow ?? true;
  mesh_stock_1.userData.sculptComponent = {"id": "stock", "name": "Stock", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.5134, 0.0737], [-0.2868, 0.0819], [-0.1857, 0.0382], [0.3605, 0.0983], [0.3605, 0.0], [-0.1584, -0.0218], [-0.2021, -0.0765], [-0.3113, -0.0819], [-0.4315, -0.1202], [-0.5053, -0.1202]], "depth": 0.09}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.09, "height": 0.2185, "depth": 0.8739, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.045, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}}, "material": "mint", "materialLayers": ["mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-roundover", "kind": "bevel", "description": "rolled moulded edges that catch a soft highlight along the outline", "evidenceRef": "detail-inventory/zone-r1c1.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(61, 219, 180, 1.0)", "secondaryAlbedo": "rgba(52, 186, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_stock_1.add(mesh_stock_1);
  meshes["stock"] = mesh_stock_1;
  colliders["stock"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["stock"] ??= [];
  destructionGroups["stock"].push(node_stock_1);

  const attachment_barrel_2 = {"parentId": "root", "parentSocket": "barrel-mount", "localStart": [0.0, 0.0574, 0.355], "localEnd": [0.0, 0.0574, 0.6882], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0246, "endRadius": 0.0246};
  const endpoint_barrel_2 = makeAttachmentEndpoint(attachment_barrel_2);
  const node_barrel_2 = new THREE.Group();
  node_barrel_2.name = "Barrel__pivot";
  node_barrel_2.scale.set(1, 1, 1);
  if (endpoint_barrel_2) {
    node_barrel_2.position.copy(endpoint_barrel_2.start);
    node_barrel_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_barrel_2.position.set(0.0, 0.0, 0.0);
    node_barrel_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_barrel_2.userData.sculptComponent = {"id": "barrel", "name": "Barrel", "level": "meso", "role": "tube", "importance": 0.9, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "barrel-mount", "localStart": [0.0, 0.0574, 0.355], "localEnd": [0.0, 0.0574, 0.6882], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0246, "endRadius": 0.0246}, "dimensions": {"width": 0.0492, "height": 0.0492, "depth": 0.3332, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.0492, 0.0492, 0.3332]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_barrel_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_barrel_2);
  nodes["barrel"] = node_barrel_2;
  const mesh_barrel_2Geometry = endpoint_barrel_2
    ? new THREE.CylinderGeometry(endpoint_barrel_2.endRadius, endpoint_barrel_2.baseRadius, endpoint_barrel_2.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_barrel_2) {
    mesh_barrel_2Geometry.scale(0.0492, 0.0492, 0.3332);
  }
  const mesh_barrel_2 = new THREE.Mesh(
    mesh_barrel_2Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_barrel_2.name = "Barrel";
  if (endpoint_barrel_2) {
    mesh_barrel_2.position.copy(endpoint_barrel_2.midpoint);
    mesh_barrel_2.quaternion.copy(endpoint_barrel_2.quaternion);
  }
  mesh_barrel_2.castShadow = options.castShadow ?? true;
  mesh_barrel_2.receiveShadow = options.receiveShadow ?? true;
  mesh_barrel_2.userData.sculptComponent = {"id": "barrel", "name": "Barrel", "level": "meso", "role": "tube", "importance": 0.9, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "barrel-mount", "localStart": [0.0, 0.0574, 0.355], "localEnd": [0.0, 0.0574, 0.6882], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0246, "endRadius": 0.0246}, "dimensions": {"width": 0.0492, "height": 0.0492, "depth": 0.3332, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.0492, 0.0492, 0.3332]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_barrel_2.add(mesh_barrel_2);
  meshes["barrel"] = mesh_barrel_2;
  colliders["barrel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["barrel"] ??= [];
  destructionGroups["barrel"].push(node_barrel_2);

  const attachment_muzzle_3 = {"parentId": "root", "parentSocket": "muzzle-mount", "localStart": [0.0, 0.0574, 0.6718], "localEnd": [0.0, 0.0574, 0.7866], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0492, "endRadius": 0.0492};
  const endpoint_muzzle_3 = makeAttachmentEndpoint(attachment_muzzle_3);
  const node_muzzle_3 = new THREE.Group();
  node_muzzle_3.name = "Muzzle__pivot";
  node_muzzle_3.scale.set(1, 1, 1);
  if (endpoint_muzzle_3) {
    node_muzzle_3.position.copy(endpoint_muzzle_3.start);
    node_muzzle_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_muzzle_3.position.set(0.0, 0.0, 0.0);
    node_muzzle_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_muzzle_3.userData.sculptComponent = {"id": "muzzle", "name": "Muzzle", "level": "meso", "role": "tube", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "muzzle-mount", "localStart": [0.0, 0.0574, 0.6718], "localEnd": [0.0, 0.0574, 0.7866], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0492, "endRadius": 0.0492}, "dimensions": {"width": 0.0984, "height": 0.0984, "depth": 0.1147, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.0984, 0.0984, 0.1147]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_muzzle_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_muzzle_3);
  nodes["muzzle"] = node_muzzle_3;
  const mesh_muzzle_3Geometry = endpoint_muzzle_3
    ? new THREE.CylinderGeometry(endpoint_muzzle_3.endRadius, endpoint_muzzle_3.baseRadius, endpoint_muzzle_3.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_muzzle_3) {
    mesh_muzzle_3Geometry.scale(0.0984, 0.0984, 0.1147);
  }
  const mesh_muzzle_3 = new THREE.Mesh(
    mesh_muzzle_3Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_muzzle_3.name = "Muzzle";
  if (endpoint_muzzle_3) {
    mesh_muzzle_3.position.copy(endpoint_muzzle_3.midpoint);
    mesh_muzzle_3.quaternion.copy(endpoint_muzzle_3.quaternion);
  }
  mesh_muzzle_3.castShadow = options.castShadow ?? true;
  mesh_muzzle_3.receiveShadow = options.receiveShadow ?? true;
  mesh_muzzle_3.userData.sculptComponent = {"id": "muzzle", "name": "Muzzle", "level": "meso", "role": "tube", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "muzzle-mount", "localStart": [0.0, 0.0574, 0.6718], "localEnd": [0.0, 0.0574, 0.7866], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0492, "endRadius": 0.0492}, "dimensions": {"width": 0.0984, "height": 0.0984, "depth": 0.1147, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.0984, 0.0984, 0.1147]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_muzzle_3.add(mesh_muzzle_3);
  meshes["muzzle"] = mesh_muzzle_3;
  colliders["muzzle"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["muzzle"] ??= [];
  destructionGroups["muzzle"].push(node_muzzle_3);

  const attachment_scope_4 = {"parentId": "root", "parentSocket": "scope-mount", "localStart": [0.0, 0.1939, -0.1639], "localEnd": [0.0, 0.1939, 0.2731], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0382, "endRadius": 0.0382};
  const endpoint_scope_4 = makeAttachmentEndpoint(attachment_scope_4);
  const node_scope_4 = new THREE.Group();
  node_scope_4.name = "Scope__pivot";
  node_scope_4.scale.set(1, 1, 1);
  if (endpoint_scope_4) {
    node_scope_4.position.copy(endpoint_scope_4.start);
    node_scope_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_scope_4.position.set(0.0, 0.0, 0.0);
    node_scope_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_scope_4.userData.sculptComponent = {"id": "scope", "name": "Scope", "level": "meso", "role": "tube", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "scope-mount", "localStart": [0.0, 0.1939, -0.1639], "localEnd": [0.0, 0.1939, 0.2731], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0382, "endRadius": 0.0382}, "dimensions": {"width": 0.0764, "height": 0.0764, "depth": 0.437, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.0764, 0.0764, 0.437]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_scope_4);
  nodes["scope"] = node_scope_4;
  const mesh_scope_4Geometry = endpoint_scope_4
    ? new THREE.CylinderGeometry(endpoint_scope_4.endRadius, endpoint_scope_4.baseRadius, endpoint_scope_4.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_scope_4) {
    mesh_scope_4Geometry.scale(0.0764, 0.0764, 0.437);
  }
  const mesh_scope_4 = new THREE.Mesh(
    mesh_scope_4Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scope_4.name = "Scope";
  if (endpoint_scope_4) {
    mesh_scope_4.position.copy(endpoint_scope_4.midpoint);
    mesh_scope_4.quaternion.copy(endpoint_scope_4.quaternion);
  }
  mesh_scope_4.castShadow = options.castShadow ?? true;
  mesh_scope_4.receiveShadow = options.receiveShadow ?? true;
  mesh_scope_4.userData.sculptComponent = {"id": "scope", "name": "Scope", "level": "meso", "role": "tube", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "scope-mount", "localStart": [0.0, 0.1939, -0.1639], "localEnd": [0.0, 0.1939, 0.2731], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0382, "endRadius": 0.0382}, "dimensions": {"width": 0.0764, "height": 0.0764, "depth": 0.437, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.0764, 0.0764, 0.437]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_4.add(mesh_scope_4);
  meshes["scope"] = mesh_scope_4;
  colliders["scope"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["scope"] ??= [];
  destructionGroups["scope"].push(node_scope_4);

  const attachment_scope_cap_rear_5 = {"parentId": "root", "parentSocket": "scope-cap-rear-mount", "localStart": [0.0, 0.1939, -0.2267], "localEnd": [0.0, 0.1939, -0.1475], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0519, "endRadius": 0.0519};
  const endpoint_scope_cap_rear_5 = makeAttachmentEndpoint(attachment_scope_cap_rear_5);
  const node_scope_cap_rear_5 = new THREE.Group();
  node_scope_cap_rear_5.name = "Scope Cap Rear__pivot";
  node_scope_cap_rear_5.scale.set(1, 1, 1);
  if (endpoint_scope_cap_rear_5) {
    node_scope_cap_rear_5.position.copy(endpoint_scope_cap_rear_5.start);
    node_scope_cap_rear_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_scope_cap_rear_5.position.set(0.0, 0.0, 0.0);
    node_scope_cap_rear_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_scope_cap_rear_5.userData.sculptComponent = {"id": "scope-cap-rear", "name": "Scope Cap Rear", "level": "meso", "role": "tube", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "scope-cap-rear-mount", "localStart": [0.0, 0.1939, -0.2267], "localEnd": [0.0, 0.1939, -0.1475], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0519, "endRadius": 0.0519}, "dimensions": {"width": 0.1038, "height": 0.1038, "depth": 0.0792, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.1038, 0.1038, 0.0792]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-cap-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_cap_rear_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-cap-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}};
  (nodes["root"] ?? root).add(node_scope_cap_rear_5);
  nodes["scope-cap-rear"] = node_scope_cap_rear_5;
  const mesh_scope_cap_rear_5Geometry = endpoint_scope_cap_rear_5
    ? new THREE.CylinderGeometry(endpoint_scope_cap_rear_5.endRadius, endpoint_scope_cap_rear_5.baseRadius, endpoint_scope_cap_rear_5.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_scope_cap_rear_5) {
    mesh_scope_cap_rear_5Geometry.scale(0.1038, 0.1038, 0.0792);
  }
  const mesh_scope_cap_rear_5 = new THREE.Mesh(
    mesh_scope_cap_rear_5Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scope_cap_rear_5.name = "Scope Cap Rear";
  if (endpoint_scope_cap_rear_5) {
    mesh_scope_cap_rear_5.position.copy(endpoint_scope_cap_rear_5.midpoint);
    mesh_scope_cap_rear_5.quaternion.copy(endpoint_scope_cap_rear_5.quaternion);
  }
  mesh_scope_cap_rear_5.castShadow = options.castShadow ?? true;
  mesh_scope_cap_rear_5.receiveShadow = options.receiveShadow ?? true;
  mesh_scope_cap_rear_5.userData.sculptComponent = {"id": "scope-cap-rear", "name": "Scope Cap Rear", "level": "meso", "role": "tube", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "scope-cap-rear-mount", "localStart": [0.0, 0.1939, -0.2267], "localEnd": [0.0, 0.1939, -0.1475], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0519, "endRadius": 0.0519}, "dimensions": {"width": 0.1038, "height": 0.1038, "depth": 0.0792, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.1038, 0.1038, 0.0792]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-cap-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_cap_rear_5.add(mesh_scope_cap_rear_5);
  meshes["scope-cap-rear"] = mesh_scope_cap_rear_5;
  colliders["scope-cap-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["scope-cap-rear"] ??= [];
  destructionGroups["scope-cap-rear"].push(node_scope_cap_rear_5);

  const attachment_scope_cap_front_6 = {"parentId": "root", "parentSocket": "scope-cap-front-mount", "localStart": [0.0, 0.1939, 0.254], "localEnd": [0.0, 0.1939, 0.3223], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0519, "endRadius": 0.0519};
  const endpoint_scope_cap_front_6 = makeAttachmentEndpoint(attachment_scope_cap_front_6);
  const node_scope_cap_front_6 = new THREE.Group();
  node_scope_cap_front_6.name = "Scope Cap Front__pivot";
  node_scope_cap_front_6.scale.set(1, 1, 1);
  if (endpoint_scope_cap_front_6) {
    node_scope_cap_front_6.position.copy(endpoint_scope_cap_front_6.start);
    node_scope_cap_front_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_scope_cap_front_6.position.set(0.0, 0.0, 0.0);
    node_scope_cap_front_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_scope_cap_front_6.userData.sculptComponent = {"id": "scope-cap-front", "name": "Scope Cap Front", "level": "meso", "role": "tube", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "scope-cap-front-mount", "localStart": [0.0, 0.1939, 0.254], "localEnd": [0.0, 0.1939, 0.3223], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0519, "endRadius": 0.0519}, "dimensions": {"width": 0.1038, "height": 0.1038, "depth": 0.0683, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.1038, 0.1038, 0.0683]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-cap-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_cap_front_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-cap-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}};
  (nodes["root"] ?? root).add(node_scope_cap_front_6);
  nodes["scope-cap-front"] = node_scope_cap_front_6;
  const mesh_scope_cap_front_6Geometry = endpoint_scope_cap_front_6
    ? new THREE.CylinderGeometry(endpoint_scope_cap_front_6.endRadius, endpoint_scope_cap_front_6.baseRadius, endpoint_scope_cap_front_6.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_scope_cap_front_6) {
    mesh_scope_cap_front_6Geometry.scale(0.1038, 0.1038, 0.0683);
  }
  const mesh_scope_cap_front_6 = new THREE.Mesh(
    mesh_scope_cap_front_6Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scope_cap_front_6.name = "Scope Cap Front";
  if (endpoint_scope_cap_front_6) {
    mesh_scope_cap_front_6.position.copy(endpoint_scope_cap_front_6.midpoint);
    mesh_scope_cap_front_6.quaternion.copy(endpoint_scope_cap_front_6.quaternion);
  }
  mesh_scope_cap_front_6.castShadow = options.castShadow ?? true;
  mesh_scope_cap_front_6.receiveShadow = options.receiveShadow ?? true;
  mesh_scope_cap_front_6.userData.sculptComponent = {"id": "scope-cap-front", "name": "Scope Cap Front", "level": "meso", "role": "tube", "importance": 0.7, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round barrel/tube along the gun axis, built as an attachment cylinder from its rear to its front.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "scope-cap-front-mount", "localStart": [0.0, 0.1939, 0.254], "localEnd": [0.0, 0.1939, 0.3223], "contactType": "embed", "overlap": 0.01, "gapTolerance": 0.01, "evidenceRefs": ["full-object"], "baseRadius": 0.0519, "endRadius": 0.0519}, "dimensions": {"width": 0.1038, "height": 0.1038, "depth": 0.0683, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [0.1038, 0.1038, 0.0683]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-cap-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_cap_front_6.add(mesh_scope_cap_front_6);
  meshes["scope-cap-front"] = mesh_scope_cap_front_6;
  colliders["scope-cap-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["scope-cap-front"] ??= [];
  destructionGroups["scope-cap-front"].push(node_scope_cap_front_6);

  const endpoint_scope_mount_a_7 = makeAttachmentEndpoint(null);
  const node_scope_mount_a_7 = new THREE.Group();
  node_scope_mount_a_7.name = "Scope Mount A__pivot";
  node_scope_mount_a_7.scale.set(1, 1, 1);
  if (endpoint_scope_mount_a_7) {
    node_scope_mount_a_7.position.copy(endpoint_scope_mount_a_7.start);
    node_scope_mount_a_7.rotation.set(0.0, -1.5707963267948966, 0.0);
  } else {
    node_scope_mount_a_7.position.set(0.025, 0.0, 0.0);
    node_scope_mount_a_7.rotation.set(0.0, -1.5707963267948966, 0.0);
  }
  node_scope_mount_a_7.userData.sculptComponent = {"id": "scope-mount-a", "name": "Scope Mount A", "level": "micro", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.0273, 0.1092], [0.0261, 0.103], [0.0225, 0.0977], [0.0172, 0.0941], [0.0109, 0.0929], [-0.0328, 0.0929], [-0.039, 0.0941], [-0.0444, 0.0977], [-0.0479, 0.103], [-0.0492, 0.1092], [-0.0492, 0.1912], [-0.0479, 0.1974], [-0.0444, 0.2028], [-0.039, 0.2063], [-0.0328, 0.2076], [0.0109, 0.2076], [0.0172, 0.2063], [0.0225, 0.2028], [0.0261, 0.1974], [0.0273, 0.1912]], "depth": 0.05}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.05, "height": 0.1147, "depth": 0.0765, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.025, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-mount-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}}, "material": "mint", "materialLayers": ["mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(61, 219, 180, 1.0)", "secondaryAlbedo": "rgba(52, 186, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_mount_a_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-mount-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}};
  (nodes["root"] ?? root).add(node_scope_mount_a_7);
  nodes["scope-mount-a"] = node_scope_mount_a_7;
  const mesh_scope_mount_a_7Geometry = endpoint_scope_mount_a_7
    ? new THREE.CylinderGeometry(endpoint_scope_mount_a_7.endRadius, endpoint_scope_mount_a_7.baseRadius, endpoint_scope_mount_a_7.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.0273, 0.1092], [0.0261, 0.103], [0.0225, 0.0977], [0.0172, 0.0941], [0.0109, 0.0929], [-0.0328, 0.0929], [-0.039, 0.0941], [-0.0444, 0.0977], [-0.0479, 0.103], [-0.0492, 0.1092], [-0.0492, 0.1912], [-0.0479, 0.1974], [-0.0444, 0.2028], [-0.039, 0.2063], [-0.0328, 0.2076], [0.0109, 0.2076], [0.0172, 0.2063], [0.0225, 0.2028], [0.0261, 0.1974], [0.0273, 0.1912]], "depth": 0.05});
  if (!endpoint_scope_mount_a_7) {
    mesh_scope_mount_a_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_scope_mount_a_7 = new THREE.Mesh(
    mesh_scope_mount_a_7Geometry,
    materialMap["mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scope_mount_a_7.name = "Scope Mount A";
  if (endpoint_scope_mount_a_7) {
    mesh_scope_mount_a_7.position.copy(endpoint_scope_mount_a_7.midpoint);
    mesh_scope_mount_a_7.quaternion.copy(endpoint_scope_mount_a_7.quaternion);
  }
  mesh_scope_mount_a_7.castShadow = options.castShadow ?? true;
  mesh_scope_mount_a_7.receiveShadow = options.receiveShadow ?? true;
  mesh_scope_mount_a_7.userData.sculptComponent = {"id": "scope-mount-a", "name": "Scope Mount A", "level": "micro", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.0273, 0.1092], [0.0261, 0.103], [0.0225, 0.0977], [0.0172, 0.0941], [0.0109, 0.0929], [-0.0328, 0.0929], [-0.039, 0.0941], [-0.0444, 0.0977], [-0.0479, 0.103], [-0.0492, 0.1092], [-0.0492, 0.1912], [-0.0479, 0.1974], [-0.0444, 0.2028], [-0.039, 0.2063], [-0.0328, 0.2076], [0.0109, 0.2076], [0.0172, 0.2063], [0.0225, 0.2028], [0.0261, 0.1974], [0.0273, 0.1912]], "depth": 0.05}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.05, "height": 0.1147, "depth": 0.0765, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.025, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-mount-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}}, "material": "mint", "materialLayers": ["mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(61, 219, 180, 1.0)", "secondaryAlbedo": "rgba(52, 186, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_mount_a_7.add(mesh_scope_mount_a_7);
  meshes["scope-mount-a"] = mesh_scope_mount_a_7;
  colliders["scope-mount-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["scope-mount-a"] ??= [];
  destructionGroups["scope-mount-a"].push(node_scope_mount_a_7);

  const endpoint_scope_mount_b_8 = makeAttachmentEndpoint(null);
  const node_scope_mount_b_8 = new THREE.Group();
  node_scope_mount_b_8.name = "Scope Mount B__pivot";
  node_scope_mount_b_8.scale.set(1, 1, 1);
  if (endpoint_scope_mount_b_8) {
    node_scope_mount_b_8.position.copy(endpoint_scope_mount_b_8.start);
    node_scope_mount_b_8.rotation.set(0.0, -1.5707963267948966, 0.0);
  } else {
    node_scope_mount_b_8.position.set(0.025, 0.0, 0.0);
    node_scope_mount_b_8.rotation.set(0.0, -1.5707963267948966, 0.0);
  }
  node_scope_mount_b_8.userData.sculptComponent = {"id": "scope-mount-b", "name": "Scope Mount B", "level": "micro", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.1693, 0.1147], [0.1681, 0.1084], [0.1645, 0.1031], [0.1592, 0.0996], [0.1529, 0.0983], [0.1256, 0.0983], [0.1194, 0.0996], [0.114, 0.1031], [0.1105, 0.1084], [0.1092, 0.1147], [0.1092, 0.1857], [0.1105, 0.192], [0.114, 0.1973], [0.1194, 0.2009], [0.1256, 0.2021], [0.1529, 0.2021], [0.1592, 0.2009], [0.1645, 0.1973], [0.1681, 0.192], [0.1693, 0.1857]], "depth": 0.05}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.05, "height": 0.1038, "depth": 0.0601, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.025, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-mount-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}}, "material": "mint", "materialLayers": ["mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(61, 219, 180, 1.0)", "secondaryAlbedo": "rgba(52, 186, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_mount_b_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-mount-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}};
  (nodes["root"] ?? root).add(node_scope_mount_b_8);
  nodes["scope-mount-b"] = node_scope_mount_b_8;
  const mesh_scope_mount_b_8Geometry = endpoint_scope_mount_b_8
    ? new THREE.CylinderGeometry(endpoint_scope_mount_b_8.endRadius, endpoint_scope_mount_b_8.baseRadius, endpoint_scope_mount_b_8.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.1693, 0.1147], [0.1681, 0.1084], [0.1645, 0.1031], [0.1592, 0.0996], [0.1529, 0.0983], [0.1256, 0.0983], [0.1194, 0.0996], [0.114, 0.1031], [0.1105, 0.1084], [0.1092, 0.1147], [0.1092, 0.1857], [0.1105, 0.192], [0.114, 0.1973], [0.1194, 0.2009], [0.1256, 0.2021], [0.1529, 0.2021], [0.1592, 0.2009], [0.1645, 0.1973], [0.1681, 0.192], [0.1693, 0.1857]], "depth": 0.05});
  if (!endpoint_scope_mount_b_8) {
    mesh_scope_mount_b_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_scope_mount_b_8 = new THREE.Mesh(
    mesh_scope_mount_b_8Geometry,
    materialMap["mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_scope_mount_b_8.name = "Scope Mount B";
  if (endpoint_scope_mount_b_8) {
    mesh_scope_mount_b_8.position.copy(endpoint_scope_mount_b_8.midpoint);
    mesh_scope_mount_b_8.quaternion.copy(endpoint_scope_mount_b_8.quaternion);
  }
  mesh_scope_mount_b_8.castShadow = options.castShadow ?? true;
  mesh_scope_mount_b_8.receiveShadow = options.receiveShadow ?? true;
  mesh_scope_mount_b_8.userData.sculptComponent = {"id": "scope-mount-b", "name": "Scope Mount B", "level": "micro", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.1693, 0.1147], [0.1681, 0.1084], [0.1645, 0.1031], [0.1592, 0.0996], [0.1529, 0.0983], [0.1256, 0.0983], [0.1194, 0.0996], [0.114, 0.1031], [0.1105, 0.1084], [0.1092, 0.1147], [0.1092, 0.1857], [0.1105, 0.192], [0.114, 0.1973], [0.1194, 0.2009], [0.1256, 0.2021], [0.1529, 0.2021], [0.1592, 0.2009], [0.1645, 0.1973], [0.1681, 0.192], [0.1693, 0.1857]], "depth": 0.05}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.05, "height": 0.1038, "depth": 0.0601, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.025, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "scope-mount-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint"}}, "material": "mint", "materialLayers": ["mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(61, 219, 180, 1.0)", "secondaryAlbedo": "rgba(52, 186, 153, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_scope_mount_b_8.add(mesh_scope_mount_b_8);
  meshes["scope-mount-b"] = mesh_scope_mount_b_8;
  colliders["scope-mount-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["scope-mount-b"] ??= [];
  destructionGroups["scope-mount-b"].push(node_scope_mount_b_8);

  const endpoint_grip_9 = makeAttachmentEndpoint(null);
  const node_grip_9 = new THREE.Group();
  node_grip_9.name = "Grip__pivot";
  node_grip_9.scale.set(1, 1, 1);
  if (endpoint_grip_9) {
    node_grip_9.position.copy(endpoint_grip_9.start);
    node_grip_9.rotation.set(0.0, -1.5707963267948966, 0.0);
  } else {
    node_grip_9.position.set(0.035, 0.0, 0.0);
    node_grip_9.rotation.set(0.0, -1.5707963267948966, 0.0);
  }
  node_grip_9.userData.sculptComponent = {"id": "grip", "name": "Grip", "level": "macro", "role": "grip", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.041, 0.0], [0.0437, 0.0], [0.0929, -0.1092], [0.0055, -0.1311], [-0.0273, -0.0546]], "depth": 0.07}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.07, "height": 0.1311, "depth": 0.1339, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.035, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-taper", "kind": "contour", "description": "narrows toward its lower end", "evidenceRef": "detail-inventory/zone-r2c0.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_grip_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}};
  (nodes["root"] ?? root).add(node_grip_9);
  nodes["grip"] = node_grip_9;
  const mesh_grip_9Geometry = endpoint_grip_9
    ? new THREE.CylinderGeometry(endpoint_grip_9.endRadius, endpoint_grip_9.baseRadius, endpoint_grip_9.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.041, 0.0], [0.0437, 0.0], [0.0929, -0.1092], [0.0055, -0.1311], [-0.0273, -0.0546]], "depth": 0.07});
  if (!endpoint_grip_9) {
    mesh_grip_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grip_9 = new THREE.Mesh(
    mesh_grip_9Geometry,
    materialMap["grape"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_9.name = "Grip";
  if (endpoint_grip_9) {
    mesh_grip_9.position.copy(endpoint_grip_9.midpoint);
    mesh_grip_9.quaternion.copy(endpoint_grip_9.quaternion);
  }
  mesh_grip_9.castShadow = options.castShadow ?? true;
  mesh_grip_9.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_9.userData.sculptComponent = {"id": "grip", "name": "Grip", "level": "macro", "role": "grip", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.041, 0.0], [0.0437, 0.0], [0.0929, -0.1092], [0.0055, -0.1311], [-0.0273, -0.0546]], "depth": 0.07}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.07, "height": 0.1311, "depth": 0.1339, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.035, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grape"}}, "material": "grape", "materialLayers": ["grape"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-taper", "kind": "contour", "description": "narrows toward its lower end", "evidenceRef": "detail-inventory/zone-r2c0.png"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(91, 42, 134, 1.0)", "secondaryAlbedo": "rgba(77, 36, 114, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_grip_9.add(mesh_grip_9);
  meshes["grip"] = mesh_grip_9;
  colliders["grip"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["grip"] ??= [];
  destructionGroups["grip"].push(node_grip_9);

  const endpoint_trigger_10 = makeAttachmentEndpoint(null);
  const node_trigger_10 = new THREE.Group();
  node_trigger_10.name = "Trigger__pivot";
  node_trigger_10.scale.set(1, 1, 1);
  if (endpoint_trigger_10) {
    node_trigger_10.position.copy(endpoint_trigger_10.start);
    node_trigger_10.rotation.set(0.0, -1.5707963267948966, 0.0);
  } else {
    node_trigger_10.position.set(0.015, 0.0, 0.0);
    node_trigger_10.rotation.set(0.0, -1.5707963267948966, 0.0);
  }
  node_trigger_10.userData.sculptComponent = {"id": "trigger", "name": "Trigger", "level": "micro", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.1639, 0.0], [-0.1202, 0.0], [-0.1092, -0.0492], [-0.142, -0.0655]], "depth": 0.03}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.03, "height": 0.0655, "depth": 0.0547, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.015, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "trigger", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_trigger_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "trigger", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}};
  (nodes["root"] ?? root).add(node_trigger_10);
  nodes["trigger"] = node_trigger_10;
  const mesh_trigger_10Geometry = endpoint_trigger_10
    ? new THREE.CylinderGeometry(endpoint_trigger_10.endRadius, endpoint_trigger_10.baseRadius, endpoint_trigger_10.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.1639, 0.0], [-0.1202, 0.0], [-0.1092, -0.0492], [-0.142, -0.0655]], "depth": 0.03});
  if (!endpoint_trigger_10) {
    mesh_trigger_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_trigger_10 = new THREE.Mesh(
    mesh_trigger_10Geometry,
    materialMap["yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_trigger_10.name = "Trigger";
  if (endpoint_trigger_10) {
    mesh_trigger_10.position.copy(endpoint_trigger_10.midpoint);
    mesh_trigger_10.quaternion.copy(endpoint_trigger_10.quaternion);
  }
  mesh_trigger_10.castShadow = options.castShadow ?? true;
  mesh_trigger_10.receiveShadow = options.receiveShadow ?? true;
  mesh_trigger_10.userData.sculptComponent = {"id": "trigger", "name": "Trigger", "level": "micro", "role": "body", "importance": 0.5, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[-0.1639, 0.0], [-0.1202, 0.0], [-0.1092, -0.0492], [-0.142, -0.0655]], "depth": 0.03}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.03, "height": 0.0655, "depth": 0.0547, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.015, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "trigger", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow"}}, "material": "yellow", "materialLayers": ["yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 228, 92, 1.0)", "secondaryAlbedo": "rgba(217, 194, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_trigger_10.add(mesh_trigger_10);
  meshes["trigger"] = mesh_trigger_10;
  colliders["trigger"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["trigger"] ??= [];
  destructionGroups["trigger"].push(node_trigger_10);

  const endpoint_side_panel_11 = makeAttachmentEndpoint(null);
  const node_side_panel_11 = new THREE.Group();
  node_side_panel_11.name = "Side Panel__pivot";
  node_side_panel_11.scale.set(1, 1, 1);
  if (endpoint_side_panel_11) {
    node_side_panel_11.position.copy(endpoint_side_panel_11.start);
    node_side_panel_11.rotation.set(0.0, -1.5707963267948966, 0.0);
  } else {
    node_side_panel_11.position.set(0.057, 0.0, 0.0);
    node_side_panel_11.rotation.set(0.0, -1.5707963267948966, 0.0);
  }
  node_side_panel_11.userData.sculptComponent = {"id": "side-panel", "name": "Side Panel", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.2731, 0.0437], [0.271, 0.0332], [0.2651, 0.0244], [0.2562, 0.0185], [0.2458, 0.0164], [0.0137, 0.0164], [0.0032, 0.0185], [-0.0057, 0.0244], [-0.0116, 0.0332], [-0.0137, 0.0437], [-0.0137, 0.0437], [-0.0116, 0.0541], [-0.0057, 0.063], [0.0032, 0.0689], [0.0137, 0.071], [0.2458, 0.071], [0.2562, 0.0689], [0.2651, 0.063], [0.271, 0.0541], [0.2731, 0.0437]], "depth": 0.114}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.114, "height": 0.0546, "depth": 0.2868, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.057, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint-light"}}, "material": "mint-light", "materialLayers": ["mint-light"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 230, 200, 1.0)", "secondaryAlbedo": "rgba(94, 196, 170, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_side_panel_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint-light"}};
  (nodes["root"] ?? root).add(node_side_panel_11);
  nodes["side-panel"] = node_side_panel_11;
  const mesh_side_panel_11Geometry = endpoint_side_panel_11
    ? new THREE.CylinderGeometry(endpoint_side_panel_11.endRadius, endpoint_side_panel_11.baseRadius, endpoint_side_panel_11.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.2731, 0.0437], [0.271, 0.0332], [0.2651, 0.0244], [0.2562, 0.0185], [0.2458, 0.0164], [0.0137, 0.0164], [0.0032, 0.0185], [-0.0057, 0.0244], [-0.0116, 0.0332], [-0.0137, 0.0437], [-0.0137, 0.0437], [-0.0116, 0.0541], [-0.0057, 0.063], [0.0032, 0.0689], [0.0137, 0.071], [0.2458, 0.071], [0.2562, 0.0689], [0.2651, 0.063], [0.271, 0.0541], [0.2731, 0.0437]], "depth": 0.114});
  if (!endpoint_side_panel_11) {
    mesh_side_panel_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_side_panel_11 = new THREE.Mesh(
    mesh_side_panel_11Geometry,
    materialMap["mint-light"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_side_panel_11.name = "Side Panel";
  if (endpoint_side_panel_11) {
    mesh_side_panel_11.position.copy(endpoint_side_panel_11.midpoint);
    mesh_side_panel_11.quaternion.copy(endpoint_side_panel_11.quaternion);
  }
  mesh_side_panel_11.castShadow = options.castShadow ?? true;
  mesh_side_panel_11.receiveShadow = options.receiveShadow ?? true;
  mesh_side_panel_11.userData.sculptComponent = {"id": "side-panel", "name": "Side Panel", "level": "micro", "role": "body", "importance": 0.4, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Moulded toy part traced from the side profile and extruded across its thickness.", "geometryDescriptor": {"topologyIntent": "stylized toy part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "profile2D": {"points": [[0.2731, 0.0437], [0.271, 0.0332], [0.2651, 0.0244], [0.2562, 0.0185], [0.2458, 0.0164], [0.0137, 0.0164], [0.0032, 0.0185], [-0.0057, 0.0244], [-0.0116, 0.0332], [-0.0137, 0.0437], [-0.0137, 0.0437], [-0.0116, 0.0541], [-0.0057, 0.063], [0.0032, 0.0689], [0.0137, 0.071], [0.2458, 0.071], [0.2562, 0.0689], [0.2651, 0.063], [0.271, 0.0541], [0.2731, 0.0437]], "depth": 0.114}}, "parent": "root", "attachment": null, "dimensions": {"width": 0.114, "height": 0.0546, "depth": 0.2868, "units": "meters", "confidence": 0.8}, "transform": {"position": [0.057, 0, 0], "rotation": [0, -1.5707963267948966, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "mint-light"}}, "material": "mint-light", "materialLayers": ["mint-light"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Smooth moulded plastic; no relief."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 230, 200, 1.0)", "secondaryAlbedo": "rgba(94, 196, 170, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9, "evidenceRefs": ["full-object"]}};
  node_side_panel_11.add(mesh_side_panel_11);
  meshes["side-panel"] = mesh_side_panel_11;
  colliders["side-panel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "simplified proxy"};
  destructionGroups["side-panel"] ??= [];
  destructionGroups["side-panel"].push(node_side_panel_11);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createLongshotLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Longshot look-dev lights";
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
export function createLongshotEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameLongshotCamera(
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
export function createLongshotPresentationComposer(
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

export function configureLongshotRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createLongshotInspectControls(
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
