import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HEROES, type GunId, type HatId, type HeroId, type UtilId } from '@gg/shared';
import { createHatModel } from './hats';
import { mesh, toon } from './toon';

/**
 * Visual layer for heroes and guns. Game code only talks to this interface, so the
 * placeholder shapes below can be replaced by img2threejs factories one at a time.
 * Convention: models face +Z, Y is up, 1 unit = 1 meter.
 */
export interface HeroSkin {
  root: THREE.Group;
  setGun(gun: GunId): void;
  setHat(hat: HatId): void;
  /**
   * moving: 0..1 movement amount this frame. moveX/moveZ: unit movement direction in the
   * model's own frame (+Z forward). Returns true on a footfall, for dust puffs and sounds.
   */
  animate(dt: number, moving: number, moveX?: number, moveZ?: number): boolean;
  flash(): void;
  setGhost(on: boolean): void;
  dispose(): void;
}

/** Optional animatable pivots; anything missing simply doesn't animate. */
export type HeroParts = Partial<Record<'footL' | 'footR' | 'handL' | 'handR' | 'antenna', THREE.Object3D | null>>;

export type HeroFactory = () => { body: THREE.Group; gunSocket: THREE.Object3D; parts?: HeroParts };
export type GunFactory = () => THREE.Group;

const heroFactories: Partial<Record<HeroId, HeroFactory>> = {};
const gunFactories: Partial<Record<GunId, GunFactory>> = {};
const utilFactories: Partial<Record<UtilId, GunFactory>> = {};

export function registerUtilModel(util: UtilId, f: GunFactory): void {
  utilFactories[util] = f;
}

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
    case 'volt': {
      const cap = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16), toon('#D5D9DE'), [0, 1.42, 0]);
      const bolt = mesh(new THREE.BoxGeometry(0.08, 0.3, 0.04), toon('#FFFFFF'), [0, 0.62, 0.44], [0, 0, 0.4]);
      body.add(cap, bolt);
      break;
    }
    case 'chameleon': {
      const crest = mesh(new THREE.ConeGeometry(0.12, 0.28, 10), toon('#3DDBB4'), [0, 1.42, -0.05]);
      const tail = mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 20), toon('#3DDBB4'), [0.5, 0.6, -0.15], [0, 0.9, 0]);
      body.add(crest, tail);
      break;
    }
    case 'grapple': {
      const helmet = mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#FFE45C'), [0, 1.16, 0]);
      const rope = mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 24), toon('#5B2A86'), [0, 0.7, 0], [Math.PI / 2.4, 0, 0.5]);
      body.add(helmet, rope);
      break;
    }
    case 'echo': {
      for (const side of [-1, 1]) {
        const dish = mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.08, 20), toon('#FF8A1F'), [side * 0.42, 1.36, 0], [Math.PI / 2, 0, -side * 0.35]);
        body.add(dish);
      }
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
    case 'minismg':
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.14, 0.36), toon('#7FCBFF'), [0, 0, 0.1]));
      g.add(mesh(new THREE.BoxGeometry(0.07, 0.2, 0.08), metal, [0, -0.15, 0.12]));
      break;
    case 'thumper':
      g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.42, 14), toon('#FF8A1F'), [0, 0.02, 0.18], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 14), metal, [0, 0.02, -0.02], [0, 0, Math.PI / 2]));
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), metal, [0, -0.14, -0.06]));
      break;
    case 'burst':
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.17, 0.72), toon('#3DDBB4'), [0, 0, 0.2]));
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.24, 0.1), metal, [0, -0.17, 0.06]));
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18), toon('#FFE45C'), [(i - 1) * 0.04, 0.02, 0.62], [Math.PI / 2, 0, 0]));
      break;
    case 'bouncer':
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.14, 0.36), toon('#FF5FA2'), [0, 0, 0.1]));
      g.add(mesh(new THREE.SphereGeometry(0.09, 14, 10), toon('#FFE45C'), [0, 0.02, 0.32]));
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), metal, [0, -0.13, -0.02]));
      break;
    case 'stinger':
      g.add(mesh(new THREE.BoxGeometry(0.11, 0.13, 0.34), toon('#FFE45C'), [0, 0, 0.08]));
      g.add(mesh(new THREE.ConeGeometry(0.05, 0.22, 10), metal, [0, 0, 0.36], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.09, 0.2, 0.09), metal, [0, -0.13, -0.02]));
      break;
    case 'rocket':
      g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.95, 16), toon('#FF5FA2'), [0, 0.08, 0.2], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.ConeGeometry(0.14, 0.2, 16), toon('#FFE45C'), [0, 0.08, 0.76], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), metal, [0, -0.12, 0.05]));
      break;
  }
  return g;
}

function placeholderUtil(util: UtilId): THREE.Group {
  const g = new THREE.Group();
  const colors: Record<UtilId, string> = { frag: '#3DDBB4', flash: '#FFE45C', smoke: '#B48CFF', pad: '#4FB3FF', juice: '#FF5F6D' };
  if (util === 'juice') {
    g.add(mesh(new RoundedBoxGeometry(0.2, 0.28, 0.14, 2, 0.04), toon(colors.juice), [0, 0.14, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16), toon('#FFFFFF'), [0.05, 0.34, 0], [0, 0, -0.3]));
    return g;
  }
  g.add(mesh(new THREE.SphereGeometry(0.16, 14, 10), toon(colors[util]), [0, 0.16, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10), toon('#5B2A86'), [0, 0.34, 0]));
  return g;
}

export function createUtilModel(util: UtilId): THREE.Group {
  return (utilFactories[util] ?? (() => placeholderUtil(util)))();
}

export function createGunModel(gun: GunId): THREE.Group {
  return (gunFactories[gun] ?? (() => placeholderGun(gun)))();
}

// ---------- skin instance ----------

export function createHeroSkin(hero: HeroId): HeroSkin {
  const make: HeroFactory = heroFactories[hero] ?? (() => placeholderHero(hero));
  const { body, gunSocket, parts = {} } = make();
  const rest = new Map<THREE.Object3D, THREE.Euler>();
  const restPos = new Map<THREE.Object3D, THREE.Vector3>();
  for (const p of Object.values(parts)) {
    if (p) {
      rest.set(p, p.rotation.clone());
      restPos.set(p, p.position.clone());
    }
  }
  const pose = (p: THREE.Object3D | null | undefined, x: number, z = 0) => {
    const r = p && rest.get(p);
    if (p && r) p.rotation.set(r.x + x, r.y, r.z + z);
  };
  const place = (p: THREE.Object3D | null | undefined, dx: number, dy: number, dz: number) => {
    const r = p && restPos.get(p);
    if (p && r) p.position.set(r.x + dx, r.y + dy, r.z + dz);
  };
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
  let hatModel: THREE.Group | null = null;
  let currentHat: HatId = 'none';
  // Hats sit on the crown of the head. Antennae and bells are left out of the measurement
  // so the hat doesn't float above them.
  const hatY = (() => {
    const box = new THREE.Box3();
    const skip = parts.antenna;
    body.updateMatrixWorld(true);
    body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (let a: THREE.Object3D | null = o; a; a = a.parent) if (a === skip) return;
      box.expandByObject(o, false);
    });
    return box.isEmpty() ? 1.4 : box.max.y - 0.05;
  })();
  let phase = 0;
  let flashT = 0;
  let squash = 0;
  let leanX = 0;
  let leanZ = 0;
  let idle = 0;

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
    setHat(hat) {
      if (hat === currentHat) return;
      currentHat = hat;
      if (hatModel) bob.remove(hatModel);
      hatModel = createHatModel(hat);
      if (hatModel) {
        hatModel.position.y = hatY;
        bob.add(hatModel);
      }
    },
    animate(dt, moving, moveX = 0, moveZ = 1) {
      const prevSin = Math.sin(phase);
      const spin = hatModel?.getObjectByName('spin');
      if (spin) spin.rotation.y += dt * (6 + moving * 14);
      phase += dt * (5 + moving * 12);
      idle += dt;
      const sin = Math.sin(phase);
      const lift = Math.abs(sin);

      // Lean into the direction of travel, eased so starts and stops feel weighty.
      const ease = 1 - Math.exp(-10 * dt);
      leanX += (moveZ * 0.22 * moving - leanX) * ease;
      leanZ += (-moveX * 0.18 * moving - leanZ) * ease;

      // Bounce: stretch at the top of each hop, squash on landing.
      const hop = moving > 0.05 ? lift * 0.16 * moving : Math.sin(idle * 2.2) * 0.015;
      bob.position.y = hop;
      squash = Math.max(0, squash - dt * 5);
      const hit = 1 + Math.sin(squash * Math.PI) * 0.15;
      const land = moving > 0.05 ? (1 - lift) * 0.09 * moving : 0;
      const stretch = moving > 0.05 ? lift * 0.05 * moving : 0;
      const sy = (2 - hit) * (1 - land + stretch);
      const sxz = hit * (1 + land * 0.6 - stretch * 0.5);
      bob.scale.set(sxz, sy, sxz);
      bob.rotation.x = leanX;
      bob.rotation.z = leanZ + (moving > 0.05 ? sin * 0.07 * moving : 0);

      // Feet stride along the movement direction and stay on the floor (they undo the hop).
      const stride = Math.cos(phase) * 0.15 * moving;
      const liftL = Math.max(0, sin) * 0.1 * moving;
      const liftR = Math.max(0, -sin) * 0.1 * moving;
      place(parts.footL, moveX * stride, liftL - hop, moveZ * stride);
      place(parts.footR, -moveX * stride, liftR - hop, -moveZ * stride);
      pose(parts.footL, -stride * 1.2);
      pose(parts.footR, stride * 1.2);
      // The free mitt swings against the feet; the gun mitt stays put so the gun keeps aiming.
      pose(parts.handL, stride * 2.2, Math.abs(stride) * 0.6);
      // Antennae, hats and bells trail behind the lean, then wobble.
      pose(parts.antenna, -leanX * 1.6 + Math.sin(idle * 3.1) * 0.06, -leanZ * 1.6 + Math.cos(idle * 2.3) * 0.05);

      const stepped = moving > 0.3 && Math.sign(sin) !== Math.sign(prevSin);
      if (flashT > 0) {
        flashT -= dt;
        const on = flashT > 0;
        for (const m of meshes) {
          const mat = m.material as THREE.MeshToonMaterial;
          mat.emissive.setRGB(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0);
          mat.emissiveIntensity = on ? Math.min(1, flashT * 10) : 0;
        }
      }
      return stepped;
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
