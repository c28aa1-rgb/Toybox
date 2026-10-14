import * as THREE from 'three';
import type { GunId, HeroId, UtilId } from '@gg/shared';
import { createFlickerModel } from '../../../art/reconstructions/blink/src/createFlickerModel';
import { createSwitchModel } from '../../../art/reconstructions/swap/src/createSwitchModel';
import { createTockModel } from '../../../art/reconstructions/chrono/src/createTockModel';
import { createMirageModel } from '../../../art/reconstructions/decoy/src/createMirageModel';
import { createBrickModel } from '../../../art/reconstructions/builder/src/createBrickModel';
import { createPeaShooterModel } from '../../../art/reconstructions/pistol/src/createPeaShooterModel';
import { createBuzzboxModel } from '../../../art/reconstructions/smg/src/createBuzzboxModel';
import { createBoomstickModel } from '../../../art/reconstructions/shotgun/src/createBoomstickModel';
import { createLongshotModel } from '../../../art/reconstructions/sniper/src/createLongshotModel';
import { createPartyPopperModel } from '../../../art/reconstructions/rocket/src/createPartyPopperModel';
import { createMiniBuzzModel } from '../../../art/reconstructions/minismg/src/createMiniBuzzModel';
import { createThumperModel } from '../../../art/reconstructions/thumper/src/createThumperModel';
import { createFizzBombModel } from '../../../art/reconstructions/frag/src/createFizzBombModel';
import { createFlashPopModel } from '../../../art/reconstructions/flash/src/createFlashPopModel';
import { createPuffCanModel } from '../../../art/reconstructions/smoke/src/createPuffCanModel';
import { registerGunModel, registerHeroModel, registerUtilModel } from '../skins/registry';
import { toonify } from './toonify';

/**
 * Hero models rebuilt from concept art by img2threejs (art/reconstructions/<id>).
 * Each factory runs once; players get clones that share geometry.
 */
const FACTORIES: Record<HeroId, { make: () => THREE.Group; wobble: string | null }> = {
  blink: { make: () => createFlickerModel({ textureSize: 8 }), wobble: 'Antenna Stalk__pivot' },
  swap: { make: () => createSwitchModel({ textureSize: 8 }), wobble: null },
  chrono: { make: () => createTockModel({ textureSize: 8 }), wobble: 'Bell Stem__pivot' },
  decoy: { make: () => createMirageModel({ textureSize: 8 }), wobble: 'Hat Crown__pivot' },
  builder: { make: () => createBrickModel({ textureSize: 8 }), wobble: null },
};

const templates = new Map<HeroId, THREE.Object3D>();

function template(hero: HeroId): THREE.Object3D {
  let t = templates.get(hero);
  if (!t) {
    t = toonify(FACTORIES[hero].make());
    templates.set(hero, t);
  }
  return t;
}

export function registerHeroModels(): void {
  for (const hero of Object.keys(FACTORIES) as HeroId[]) {
    registerHeroModel(hero, () => {
      const body = template(hero).clone(true) as THREE.Group;
      const byName = (name: string | null) => (name ? body.getObjectByName(name) ?? null : null);
      // Generated sockets are named after their socket id; the gun rides the forward mitt.
      const gunSocket = byName('gun') ?? body;
      return {
        body,
        gunSocket,
        parts: {
          footL: byName('Foot L__pivot'),
          footR: byName('Foot R__pivot'),
          handL: byName('Hand L__pivot'),
          handR: byName('Hand R__pivot'),
          antenna: byName(FACTORIES[hero].wobble),
        },
      };
    });
  }
}

/** Guns are modelled at toy scale in metres with the origin at the grip top, muzzle along +Z. */
const GUN_FACTORIES: Partial<Record<GunId, () => THREE.Group>> = {
  pistol: () => createPeaShooterModel({ textureSize: 8 }),
  minismg: () => createMiniBuzzModel({ textureSize: 8 }),
  thumper: () => createThumperModel({ textureSize: 8 }),
  smg: () => createBuzzboxModel({ textureSize: 8 }),
  shotgun: () => createBoomstickModel({ textureSize: 8 }),
  sniper: () => createLongshotModel({ textureSize: 8 }),
  rocket: () => createPartyPopperModel({ textureSize: 8 }),
};

// Held guns read better a little smaller than their concept scale next to the 1.45 m heroes.
const GUN_SCALE = 0.8;
const gunTemplates = new Map<GunId, THREE.Object3D>();

export function registerGunModels(): void {
  for (const gun of Object.keys(GUN_FACTORIES) as GunId[]) {
    registerGunModel(gun, () => {
      let t = gunTemplates.get(gun);
      if (!t) {
        t = toonify(GUN_FACTORIES[gun]!());
        t.scale.setScalar(GUN_SCALE);
        gunTemplates.set(gun, t);
      }
      const g = new THREE.Group();
      g.add(t.clone(true));
      return g;
    });
  }
}

/** Throwables, origin at the base. Scaled to a fixed height so they read the same in hand, in flight and as pickups. */
const UTIL_FACTORIES: Record<UtilId, () => THREE.Group> = {
  frag: () => createFizzBombModel({ textureSize: 8 }),
  flash: () => createFlashPopModel({ textureSize: 8 }),
  smoke: () => createPuffCanModel({ textureSize: 8 }),
};

const UTIL_HEIGHT = 0.42;
const utilTemplates = new Map<UtilId, THREE.Object3D>();

export function registerUtilModels(): void {
  for (const util of Object.keys(UTIL_FACTORIES) as UtilId[]) {
    registerUtilModel(util, () => {
      let t = utilTemplates.get(util);
      if (!t) {
        t = toonify(UTIL_FACTORIES[util]());
        const box = new THREE.Box3().setFromObject(t);
        t.scale.setScalar(UTIL_HEIGHT / Math.max(0.001, box.max.y - box.min.y));
        utilTemplates.set(util, t);
      }
      const g = new THREE.Group();
      g.add(t.clone(true));
      return g;
    });
  }
}
