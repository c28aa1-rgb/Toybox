import * as THREE from 'three';
import type { HeroId } from '@gg/shared';
import { createFlickerModel } from '../../../art/reconstructions/blink/src/createFlickerModel';
import { registerHeroModel } from '../skins/registry';
import { toonify } from './toonify';

/**
 * Hero models rebuilt from concept art by img2threejs (art/reconstructions/<id>).
 * Each factory runs once; players get clones that share geometry.
 */
const FACTORIES: Partial<Record<HeroId, () => THREE.Group>> = {
  blink: () => createFlickerModel({ textureSize: 8 }),
};

const templates = new Map<HeroId, THREE.Object3D>();

function template(hero: HeroId): THREE.Object3D | null {
  let t = templates.get(hero);
  if (!t) {
    const make = FACTORIES[hero];
    if (!make) return null;
    t = toonify(make());
    templates.set(hero, t);
  }
  return t;
}

export function registerHeroModels(): void {
  for (const hero of Object.keys(FACTORIES) as HeroId[]) {
    registerHeroModel(hero, () => {
      const body = template(hero)!.clone(true) as THREE.Group;
      const byName = (name: string) => body.getObjectByName(name) ?? null;
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
          antenna: byName('Antenna Stalk__pivot'),
        },
      };
    });
  }
}
