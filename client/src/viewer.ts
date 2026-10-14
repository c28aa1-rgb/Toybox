/**
 * Review viewer for img2threejs factories in art/reconstructions/<id>/src/.
 * Query: ?model=blink&az=25&el=8&size=1024&mode=reference|neutral|game
 * Sets window.__ready = true after the first frame so capture scripts can screenshot it.
 */
import * as THREE from 'three';

type FactoryModule = Record<string, unknown>;

const modules = import.meta.glob<FactoryModule>('../../art/reconstructions/*/src/create*Model.ts');

const params = new URLSearchParams(location.search);
const modelId = params.get('model') ?? 'blink';
const az = Number(params.get('az') ?? 0);
const el = Number(params.get('el') ?? 8);
const size = Number(params.get('size') ?? 1024);
const mode = (params.get('mode') ?? 'reference') as 'reference' | 'neutral' | 'game';
const hide = (params.get('hide') ?? '').split(',').filter(Boolean);

async function main(): Promise<void> {
  const entry = Object.entries(modules).find(([path]) => path.includes(`/reconstructions/${modelId}/src/`));
  if (!entry) throw new Error(`No factory for model ${modelId}`);
  const mod = await entry[1]();
  const pick = (suffix: string) => Object.entries(mod).find(([k]) => k.startsWith('create') && k.endsWith(suffix))?.[1];
  const createModel = Object.entries(mod).find(([k]) => /^create\w+Model$/.test(k))?.[1] as (o?: object) => THREE.Group;
  const createLights = pick('LookDevLights') as ((m: string) => THREE.Group) | undefined;
  const frame = Object.entries(mod).find(([k]) => /^frame\w+Camera$/.test(k))?.[1] as
    | ((c: THREE.PerspectiveCamera, o: THREE.Object3D, opts: object) => void)
    | undefined;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (mode !== 'game') renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c9c9c9');
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

  const model = createModel({ castShadow: true, receiveShadow: true });
  for (const name of hide) {
    const node = model.getObjectByName(name);
    if (node) node.visible = false;
  }
  scene.add(model);

  if (createLights && mode !== 'game') scene.add(createLights(mode === 'reference' ? 'reference' : 'neutral'));
  else {
    scene.add(new THREE.HemisphereLight('#FFF1E0', '#5B2A86', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(-3, 6, 4);
    sun.castShadow = true;
    scene.add(sun);
  }

  // No ground plane in review renders: a cast shadow on the backdrop gets segmented as part of
  // the silhouette and skews the IoU / aspect gates. Pass &ground=1 for presentation shots.
  if (params.get('ground') === '1') {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Margin 1.05 matches the concept framing (figure fills ~91% of frame height).
  const margin = Number(params.get('margin') ?? 1.05);
  if (frame) frame(camera, model, { azimuthDeg: az, elevationDeg: el, margin });
  // &match=x0,y0,x1,y1 (normalized, y down) places the render silhouette on the reference
  // silhouette box: zoom to its height, then offset the view to its centre. Only for the
  // reference viewpoint; orbit views keep plain framing.
  const match = params.get('match')?.split(',').map(Number);
  if (match && match.length === 4) matchFraming(camera, model, match as [number, number, number, number], size);
  renderer.render(scene, camera);
  requestAnimationFrame(() => {
    renderer.render(scene, camera);
    (window as unknown as { __ready: boolean }).__ready = true;
  });
}

function projectedBox(camera: THREE.PerspectiveCamera, model: THREE.Object3D): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const v = new THREE.Vector3();
  model.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(camera);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
  });
  return [x0, y0, x1, y1];
}

function matchFraming(camera: THREE.PerspectiveCamera, model: THREE.Object3D, ref: [number, number, number, number], size: number): void {
  // Reference box in NDC (y up).
  const tx = (ref[0] + ref[2]) - 1;
  const ty = 1 - (ref[1] + ref[3]);
  const th = 2 * (ref[3] - ref[1]);
  const [x0, y0, x1, y1] = projectedBox(camera, model);
  camera.zoom = th / (y1 - y0);
  camera.updateProjectionMatrix();
  const [a0, b0, a1, b1] = projectedBox(camera, model);
  const cx = (a0 + a1) / 2;
  const cy = (b0 + b1) / 2;
  camera.setViewOffset(size, size, ((cx - tx) * size) / 2, ((ty - cy) * size) / 2, size, size);
}

main().catch((err) => {
  document.body.textContent = String(err);
  (window as unknown as { __error: string }).__error = String(err);
});
