import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { POWERS, type PowerId } from '@gg/shared';
import { mesh, toon } from './toon';

const EXTRUDE = { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 3, curveSegments: 12 };

/** Sugar Rush: a chunky candy lightning bolt. */
function bolt(): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0.08, 0.36);
  s.lineTo(-0.2, -0.02);
  s.lineTo(-0.02, -0.02);
  s.lineTo(-0.1, -0.36);
  s.lineTo(0.22, 0.06);
  s.lineTo(0.04, 0.06);
  s.lineTo(0.14, 0.36);
  s.closePath();
  const body = mesh(new THREE.ExtrudeGeometry(s, EXTRUDE), toon(POWERS.speed.color), [0, 0, -0.06]);
  g.add(body);
  // Candy stripes across the bolt.
  for (const y of [0.18, -0.16]) g.add(mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), toon('#FFFFFF'), [y > 0 ? 0.0 : 0.02, y, 0.11], [0, 0, -0.5]));
  return g;
}

/** Mega Pop: a spiky starburst with a white core. */
function star(): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  const points = 8;
  for (let i = 0; i <= points * 2; i++) {
    const r = i % 2 === 0 ? 0.34 : 0.17;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  g.add(mesh(new THREE.ExtrudeGeometry(s, EXTRUDE), toon(POWERS.damage.color), [0, 0, -0.06]));
  g.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), toon('#FFFFFF'), [0, 0, 0.08]));
  return g;
}

/** Pillow Armor: a puffy pillow with corner tufts. */
function pillow(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.62, 0.46, 0.2, 4, 0.1), toon(POWERS.armor.color)));
  for (const [x, y] of [[-0.29, 0.21], [0.29, 0.21], [-0.29, -0.21], [0.29, -0.21]] as const) {
    g.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), toon('#FFFFFF'), [x, y, 0]));
  }
  // Stitched seam down the middle.
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.025, 0.02), toon('#FFFFFF'), [0, 0, 0.11]));
  return g;
}

export function createPowerModel(power: PowerId): THREE.Group {
  return power === 'speed' ? bolt() : power === 'damage' ? star() : pillow();
}
