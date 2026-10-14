import * as THREE from 'three';
import { toonGradient } from '../skins/toon';

/**
 * img2threejs factories emit PBR materials for review renders. In game everything uses the
 * 3-step toon ramp, so swap each material for a toon one with the same colour, vertex colours
 * and emissive. Geometry and hierarchy are untouched.
 */
export function toonify(root: THREE.Object3D): THREE.Object3D {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const src = obj.material as THREE.MeshStandardMaterial;
    if (obj.name === 'Root') {
      obj.visible = false;
      return;
    }
    const toon = new THREE.MeshToonMaterial({
      color: src.color?.clone() ?? new THREE.Color('#ffffff'),
      vertexColors: src.vertexColors,
      emissive: src.emissive?.clone() ?? new THREE.Color('#000000'),
      emissiveIntensity: src.emissiveIntensity ?? 0,
      gradientMap: toonGradient(),
    });
    src.dispose();
    obj.material = toon;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  return root;
}
