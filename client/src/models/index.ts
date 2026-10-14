import * as THREE from 'three';
import type { HeroId } from '@gg/shared';
import { createFlickerModel } from '../../../art/reconstructions/blink/src/createFlickerModel';
import { createSwitchModel } from '../../../art/reconstructions/swap/src/createSwitchModel';
import { createTockModel } from '../../../art/reconstructions/chrono/src/createTockModel';
import { createMirageModel } from '../../../art/reconstructions/decoy/src/createMirageModel';
import { createBrickModel } from '../../../art/reconstructions/builder/src/createBrickModel';
import { registerHeroModel } from '../skins/registry';
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
