import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mesh, toon } from './toon';

export const TURRET_COLOR = '#FF8A1F';

/**
 * Wind-Up Turret: a tin toy on a round base with a pop-gun barrel and a big wind-up key on its back.
 * Faces +Z. The `head` child turns to aim; `key` spins while it is wound.
 */
export function createTurretModel(): THREE.Group {
  const g = new THREE.Group();
  const tin = toon(TURRET_COLOR);
  const trim = toon('#FFE45C');
  const dark = toon('#2E1A4F');
  const metal = toon('#C9CED6');

  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.14, 24), dark, [0, 0.07, 0]));
  g.add(mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 32), trim, [0, 0.14, 0], [Math.PI / 2, 0, 0]));
  // Little feet so it reads as a wind-up walker.
  for (const x of [-0.18, 0.18]) g.add(mesh(new RoundedBoxGeometry(0.16, 0.08, 0.24, 2, 0.03), dark, [x, 0.18, 0.05]));

  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.5;
  head.add(mesh(new RoundedBoxGeometry(0.5, 0.42, 0.46, 3, 0.1), tin));
  // Visor with two round eyes.
  head.add(mesh(new RoundedBoxGeometry(0.38, 0.13, 0.06, 2, 0.03), dark, [0, 0.06, 0.23]));
  for (const x of [-0.09, 0.09]) head.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), toon('#FFFFFF'), [x, 0.06, 0.265]));
  // Rivets down the sides.
  for (const x of [-0.255, 0.255]) for (const y of [-0.1, 0.1]) head.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), metal, [x, y, 0]));
  // Pop-gun barrel with a bright muzzle ring.
  head.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.42, 14), metal, [0, -0.06, 0.38], [Math.PI / 2, 0, 0]));
  head.add(mesh(new THREE.TorusGeometry(0.08, 0.028, 8, 18), trim, [0, -0.06, 0.6]));
  // Antenna bobble.
  head.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6), metal, [0.12, 0.29, -0.05]));
  head.add(mesh(new THREE.SphereGeometry(0.045, 10, 8), toon('#FF5FA2'), [0.12, 0.38, -0.05]));

  const key = new THREE.Group();
  key.name = 'key';
  key.position.set(0, 0.02, -0.26);
  key.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), metal, [0, 0, -0.07], [Math.PI / 2, 0, 0]));
  // Two loops of the key bow, side by side.
  for (const x of [-0.1, 0.1]) key.add(mesh(new THREE.TorusGeometry(0.075, 0.025, 8, 18), trim, [x, 0, -0.16]));
  head.add(key);
  g.add(head);
  return g;
}
