import * as THREE from 'three';
import { HEROES, type GunId, type HeroId } from '@gg/shared';
import { mesh, toon } from './toon';

/**
 * Visual layer for heroes and guns. Game code only talks to this interface, so the
 * placeholder shapes below can be replaced by img2threejs factories one at a time.
 * Convention: models face +Z, Y is up, 1 unit = 1 meter.
 */
export interface HeroSkin {
  root: THREE.Group;
  setGun(gun: GunId): void;
  /** moving: 0..1 movement amount this frame. */
  animate(dt: number, moving: number): void;
  flash(): void;
  setGhost(on: boolean): void;
  dispose(): void;
}

export type HeroFactory = () => { body: THREE.Group; gunSocket: THREE.Object3D };
export type GunFactory = () => THREE.Group;

const heroFactories: Partial<Record<HeroId, HeroFactory>> = {};
const gunFactories: Partial<Record<GunId, GunFactory>> = {};

export function registerHeroModel(hero: HeroId, f: HeroFactory): void {
  heroFactories[hero] = f;
}

export function registerGunModel(gun: GunId, f: GunFactory): void {
  gunFactories[gun] = f;
}

// ---------- placeholder heroes ----------

const INK = '#1B1030';

function placeholderHero(hero: HeroId): { body: THREE.Group; gunSocket: THREE.Object3D } {
  const color = HEROES[hero].color;
  const body = new THREE.Group();

  const trunk = mesh(new THREE.CapsuleGeometry(0.48, 0.42, 6, 16), toon(color), [0, 0.72, 0]);
  trunk.name = 'trunk';
  body.add(trunk);
  const belly = mesh(new THREE.SphereGeometry(0.36, 16, 12), toon('#FFF4E0'), [0, 0.62, 0.2]);
  belly.scale.set(1, 1.05, 0.55);
  body.add(belly);

  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.12, 12, 10), toon('#FFFFFF'), [side * 0.17, 1.02, 0.4]);
    const pupil = mesh(new THREE.SphereGeometry(0.06, 10, 8), toon(INK), [side * 0.17, 1.02, 0.5]);
    body.add(eye, pupil);
    const foot = mesh(new THREE.SphereGeometry(0.17, 12, 8), toon(INK), [side * 0.22, 0.12, 0.05]);
    foot.scale.set(1, 0.6, 1.3);
    foot.name = side < 0 ? 'footL' : 'footR';
    body.add(foot);
  }

  switch (hero) {
    case 'blink': {
      const stalk = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35), toon(INK), [0, 1.42, 0]);
      const tip = mesh(new THREE.OctahedronGeometry(0.14), toon('#FFE45C'), [0, 1.64, 0]);
      body.add(stalk, tip);
      break;
    }
    case 'swap': {
      const band = mesh(new THREE.TorusGeometry(0.49, 0.06, 8, 24), toon('#4FB3FF'), [0, 0.86, 0], [Math.PI / 2, 0, 0]);
      const arrowA = mesh(new THREE.ConeGeometry(0.12, 0.25, 8), toon('#4FB3FF'), [0.3, 1.38, 0], [0, 0, -Math.PI / 2]);
      const arrowB = mesh(new THREE.ConeGeometry(0.12, 0.25, 8), toon('#FFFFFF'), [-0.3, 1.38, 0], [0, 0, Math.PI / 2]);
      body.add(band, arrowA, arrowB);
      break;
    }
    case 'chrono': {
      const face = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), toon('#FFFFFF'), [0, 0.62, 0.42], [Math.PI / 2, 0, 0]);
      const hand = mesh(new THREE.BoxGeometry(0.03, 0.16, 0.02), toon(INK), [0, 0.68, 0.46]);
      const bell = mesh(new THREE.SphereGeometry(0.13, 12, 8), toon('#FFE45C'), [0, 1.4, 0]);
      body.add(face, hand, bell);
      break;
    }
    case 'decoy': {
      const mask = mesh(new THREE.BoxGeometry(0.6, 0.16, 0.12), toon(INK), [0, 1.02, 0.42]);
      const hatBrim = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), toon('#5B2A86'), [0, 1.28, 0]);
      const hatTop = mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.32, 20), toon('#5B2A86'), [0, 1.45, 0]);
      body.add(mask, hatBrim, hatTop);
      break;
    }
    case 'builder': {
      const helmet = mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#FFE45C'), [0, 1.18, 0]);
      const brim = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 20), toon('#FFE45C'), [0, 1.18, 0.05]);
      body.add(helmet, brim);
      break;
    }
  }

  const gunSocket = new THREE.Object3D();
  gunSocket.position.set(0.42, 0.66, 0.32);
  body.add(gunSocket);
  return { body, gunSocket };
}

// ---------- placeholder guns ----------

function placeholderGun(gun: GunId): THREE.Group {
  const g = new THREE.Group();
  const metal = toon('#3A3150');
  const accent = toon('#FF8A1F');
  switch (gun) {
    case 'pistol':
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.14, 0.42), accent, [0, 0, 0.12]));
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), metal, [0, -0.13, -0.02]));
      break;
    case 'smg':
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.16, 0.6), toon('#4FB3FF'), [0, 0, 0.18]));
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.26, 0.1), metal, [0, -0.18, 0.2]));
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2), metal, [0, 0.02, 0.56], [Math.PI / 2, 0, 0]));
      break;
    case 'shotgun':
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8), metal, [s * 0.06, 0.03, 0.32], [Math.PI / 2, 0, 0]));
      }
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.16, 0.36), toon('#B5652B'), [0, -0.02, -0.08]));
      break;
    case 'sniper':
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2), metal, [0, 0, 0.5], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.16, 0.5), toon('#3DDBB4'), [0, -0.02, -0.05]));
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34), metal, [0, 0.14, 0.12], [Math.PI / 2, 0, 0]));
      break;
    case 'rocket':
      g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.95, 16), toon('#FF5FA2'), [0, 0.08, 0.2], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.ConeGeometry(0.14, 0.2, 16), toon('#FFE45C'), [0, 0.08, 0.76], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), metal, [0, -0.12, 0.05]));
      break;
  }
  return g;
}

export function createGunModel(gun: GunId): THREE.Group {
  return (gunFactories[gun] ?? (() => placeholderGun(gun)))();
}

// ---------- skin instance ----------

export function createHeroSkin(hero: HeroId): HeroSkin {
  const { body, gunSocket } = (heroFactories[hero] ?? (() => placeholderHero(hero)))();
  const root = new THREE.Group();
  const bob = new THREE.Group();
  bob.add(body);
  root.add(bob);

  // Per-instance materials so a hit flash on one player doesn't flash everyone.
  const meshes: THREE.Mesh[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = (o.material as THREE.Material).clone();
      meshes.push(o);
    }
  });

  let gunModel: THREE.Group | null = null;
  let currentGun: GunId | null = null;
  let phase = 0;
  let flashT = 0;
  let squash = 0;

  return {
    root,
    setGun(gun) {
      if (gun === currentGun) return;
      currentGun = gun;
      if (gunModel) gunSocket.remove(gunModel);
      gunModel = createGunModel(gun);
      gunSocket.add(gunModel);
      squash = 1;
    },
    animate(dt, moving) {
      phase += dt * (6 + moving * 10);
      const hop = moving > 0.05 ? Math.abs(Math.sin(phase)) * 0.12 * moving : Math.sin(phase * 0.5) * 0.02;
      bob.position.y = hop;
      squash = Math.max(0, squash - dt * 5);
      const s = 1 + Math.sin(squash * Math.PI) * 0.15;
      bob.scale.set(s, 2 - s, s);
      bob.rotation.z = moving > 0.05 ? Math.sin(phase) * 0.08 * moving : 0;
      if (flashT > 0) {
        flashT -= dt;
        const on = flashT > 0;
        for (const m of meshes) {
          const mat = m.material as THREE.MeshToonMaterial;
          mat.emissive.setRGB(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0);
          mat.emissiveIntensity = on ? Math.min(1, flashT * 10) : 0;
        }
      }
    },
    flash() {
      flashT = 0.09;
      squash = 0.6;
    },
    setGhost(on) {
      for (const m of meshes) {
        const mat = m.material as THREE.MeshToonMaterial;
        mat.transparent = on;
        mat.opacity = on ? 0.45 : 1;
      }
    },
    dispose() {
      for (const m of meshes) (m.material as THREE.Material).dispose();
    },
  };
}
