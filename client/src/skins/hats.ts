import * as THREE from 'three';
import type { HatId } from '@gg/shared';
import { mesh, toon } from './toon';

/**
 * Unlockable hats, built from primitives in the same molded-plastic style as the heroes.
 * Origin is the point where the hat rests on the head; +Z faces forward.
 */
export function createHatModel(hat: HatId): THREE.Group | null {
  const g = new THREE.Group();
  switch (hat) {
    case 'none':
      return null;
    case 'party': {
      const cone = mesh(new THREE.ConeGeometry(0.2, 0.46, 20), toon('#FF5FA2'), [0, 0.23, 0]);
      g.add(cone);
      // Two lemon stripes and a pom-pom.
      for (const [y, r] of [[0.1, 0.165], [0.24, 0.1]] as const) {
        g.add(mesh(new THREE.TorusGeometry(r, 0.022, 8, 24), toon('#FFE45C'), [0, y, 0], [Math.PI / 2, 0, 0]));
      }
      g.add(mesh(new THREE.SphereGeometry(0.075, 12, 10), toon('#FFE45C'), [0, 0.47, 0]));
      g.rotation.z = -0.18;
      return g;
    }
    case 'propeller': {
      const cap = mesh(new THREE.SphereGeometry(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#4FB3FF'), [0, -0.03, 0]);
      cap.scale.set(1, 0.6, 1);
      const brim = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20, 1, false, -0.9, 1.8), toon('#FF8A1F'), [0, 0, 0.22]);
      const stem = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), toon('#1B1030'), [0, 0.2, 0]);
      const rotor = new THREE.Group();
      rotor.name = 'spin';
      rotor.position.y = 0.28;
      for (const side of [-1, 1]) {
        const blade = mesh(new THREE.BoxGeometry(0.28, 0.02, 0.07), toon(side < 0 ? '#FFE45C' : '#FF5FA2'), [side * 0.15, 0, 0], [side * 0.25, 0, 0]);
        rotor.add(blade);
      }
      rotor.add(mesh(new THREE.SphereGeometry(0.04, 10, 8), toon('#FFE45C')));
      g.add(cap, brim, stem, rotor);
      return g;
    }
    case 'viking': {
      const dome = mesh(new THREE.SphereGeometry(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#B9C2D6'), [0, -0.04, 0]);
      dome.scale.set(1, 0.75, 1);
      const band = mesh(new THREE.TorusGeometry(0.29, 0.035, 8, 28), toon('#FF8A1F'), [0, -0.02, 0], [Math.PI / 2, 0, 0]);
      g.add(dome, band);
      for (const side of [-1, 1]) {
        // Each horn: three shrinking segments curling up and out.
        const horn = new THREE.Group();
        horn.position.set(side * 0.27, 0.06, 0);
        let r = 0.07;
        let x = 0;
        let y = 0;
        for (let i = 0; i < 3; i++) {
          const seg = mesh(new THREE.ConeGeometry(r, 0.14, 12), toon('#FFF4E0'), [x, y, 0], [0, 0, -side * (1.1 - i * 0.45)]);
          horn.add(seg);
          x += side * (0.09 - i * 0.02);
          y += 0.05 + i * 0.04;
          r *= 0.72;
        }
        g.add(horn);
      }
      return g;
    }
    case 'crown': {
      const ring = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 24, 1, true), toon('#FFD23F'), [0, 0.07, 0]);
      (ring.material as THREE.Material).side = THREE.DoubleSide;
      g.add(ring);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.06, 0.14, 8), toon('#FFD23F'), [Math.sin(a) * 0.2, 0.2, Math.cos(a) * 0.2]));
        g.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), toon(i % 2 ? '#3DDBB4' : '#FF5FA2'), [Math.sin(a) * 0.22, 0.07, Math.cos(a) * 0.22]));
      }
      g.rotation.z = 0.12;
      return g;
    }
  }
}

/** Heal pickup: a chunky toy heart with a white cross. */
export function createHealModel(): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.28);
  shape.bezierCurveTo(-0.08, -0.18, -0.32, -0.06, -0.3, 0.1);
  shape.bezierCurveTo(-0.28, 0.27, -0.06, 0.3, 0, 0.14);
  shape.bezierCurveTo(0.06, 0.3, 0.28, 0.27, 0.3, 0.1);
  shape.bezierCurveTo(0.32, -0.06, 0.08, -0.18, 0, -0.28);
  const heart = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 16 }),
    toon('#FF5F6D'),
  );
  heart.position.z = -0.06;
  heart.castShadow = true;
  g.add(heart);
  for (const [w, h] of [[0.2, 0.06], [0.06, 0.2]] as const) {
    g.add(mesh(new THREE.BoxGeometry(w, h, 0.05), toon('#FFFFFF'), [0, 0.03, 0.12]));
  }
  return g;
}
