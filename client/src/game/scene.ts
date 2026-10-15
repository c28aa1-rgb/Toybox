import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { MapDef } from '@gg/shared';
import { toon } from '../skins/toon';

export const PALETTE = {
  grape: '#5B2A86',
  tangerine: '#FF8A1F',
  bubblegum: '#FF5FA2',
  mint: '#3DDBB4',
  sky: '#4FB3FF',
  lemon: '#FFE45C',
  ink: '#1B1030',
  mat: '#2E1A4F',
};

const BLOCK_COLORS = [PALETTE.sky, PALETTE.bubblegum, PALETTE.tangerine, PALETTE.mint, PALETTE.lemon];
export const WALL_HEIGHT = 1.3;

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  outline: OutlineEffect;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: THREE.Group;
  sun: THREE.DirectionalLight;
  /** Builds (or rebuilds) the arena for a map. */
  setMap(map: MapDef): void;
  resize(): void;
  dispose(): void;
}

/** Map sim (x, y) to Three.js (x, 0, z). */
export function toWorld(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x, h, y);
}

export function createScene(container: HTMLElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('game-canvas');

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'game-labels';
  container.appendChild(labels.domElement);

  const outline = new OutlineEffect(renderer, {
    defaultThickness: 0.0042,
    defaultColor: new THREE.Color(PALETTE.ink).toArray(),
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#24123F');
  scene.fog = new THREE.Fog('#24123F', 38, 70);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);

  const hemi = new THREE.HemisphereLight('#FFF1E0', '#5B2A86', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFFFFF', 2.2);
  // The sun follows the camera (see GameClient.updateCamera), so a modest shadow box keeps
  // shadows crisp on every map size.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -26;
  sc.right = 26;
  sc.top = 22;
  sc.bottom = -22;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);

  const world = new THREE.Group();
  scene.add(world);
  let arena: THREE.Group | null = null;
  const setMap = (map: MapDef) => {
    if (arena) world.remove(arena);
    arena = new THREE.Group();
    buildArena(arena, map);
    world.add(arena);
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // Pull the camera back on narrow screens so the play area stays visible.
    camera.fov = w / h < 1.3 ? 46 : 36;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return {
    renderer, labels, outline, scene, camera, world, sun, setMap, resize,
    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}

function playMatTexture(map: MapDef): THREE.CanvasTexture {
  const ARENA_W = map.w;
  const ARENA_H = map.h;
  const px = 64; // pixels per meter
  const c = document.createElement('canvas');
  c.width = ARENA_W * px / 2;
  c.height = ARENA_H * px / 2;
  const g = c.getContext('2d')!;
  const s = px / 2;
  g.fillStyle = '#3A2366';
  g.fillRect(0, 0, c.width, c.height);
  // Two-tone checker every 2 m, like a foam play mat.
  for (let y = 0; y < ARENA_H / 2; y++) {
    for (let x = 0; x < ARENA_W / 2; x++) {
      if ((x + y) % 2 === 0) {
        g.fillStyle = '#41286F';
        g.fillRect(x * s * 2, y * s * 2, s * 2, s * 2);
      }
    }
  }
  // Puzzle-mat seams.
  g.strokeStyle = 'rgba(27, 16, 48, 0.35)';
  g.lineWidth = 2;
  for (let x = 0; x <= ARENA_W; x += 4) {
    g.beginPath();
    g.moveTo(x * s, 0);
    g.lineTo(x * s, c.height);
    g.stroke();
  }
  for (let y = 0; y <= ARENA_H; y += 4) {
    g.beginPath();
    g.moveTo(0, y * s);
    g.lineTo(c.width, y * s);
    g.stroke();
  }
  // Center ring.
  g.strokeStyle = 'rgba(255, 228, 92, 0.35)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(c.width / 2, c.height / 2, 5.5 * s, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildArena(world: THREE.Group, map: MapDef): void {
  const ARENA_W = map.w;
  const ARENA_H = map.h;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_W, ARENA_H),
    new THREE.MeshToonMaterial({ map: playMatTexture(map) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ARENA_W / 2, 0, ARENA_H / 2);
  floor.receiveShadow = true;
  (floor.material as THREE.Material & { userData: Record<string, unknown> }).userData.outlineParameters = { visible: false };
  world.add(floor);

  const under = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_W + 3, 1.2, ARENA_H + 3),
    toon('#1B1030'),
  );
  under.position.set(ARENA_W / 2, -0.62, ARENA_H / 2);
  world.add(under);

  map.walls.forEach((w, i) => {
    const isBorder = i < 4; // map.walls lists the four borders first
    const height = isBorder ? 0.9 : WALL_HEIGHT;
    const color = isBorder ? PALETTE.grape : BLOCK_COLORS[i % BLOCK_COLORS.length];
    const geo = new RoundedBoxGeometry(w.w, height, w.h, 3, Math.min(0.18, w.w / 3, w.h / 3));
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(w.x + w.w / 2, height / 2, w.y + w.h / 2);
    m.castShadow = !isBorder;
    m.receiveShadow = true;
    world.add(m);
    if (!isBorder) {
      // Toy-brick studs on top.
      const studGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14);
      const nx = Math.max(1, Math.floor(w.w / 0.9));
      const nz = Math.max(1, Math.floor(w.h / 0.9));
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const stud = new THREE.Mesh(studGeo, toon(color));
          stud.position.set(
            w.x + (w.w / nx) * (ix + 0.5),
            height + 0.06,
            w.y + (w.h / nz) * (iz + 0.5),
          );
          world.add(stud);
        }
      }
    }
  });

}
