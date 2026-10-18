import * as THREE from 'three';
import { mesh, toon } from './toon';

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
