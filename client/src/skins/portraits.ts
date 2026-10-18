import * as THREE from 'three';
import { GUN_IDS, HERO_IDS, PAINT_IDS, UTIL_IDS, type GunId, type HeroId, type PaintId, type UtilId } from '@gg/shared';
import { createGunModel, createHeroSkin, createUtilModel } from './registry';

/**
 * Renders each hero and gun once into a PNG data URL for the lobby cards.
 * Uses the same skin registry as the game, so new models show up here automatically.
 */
export function renderPortraits(): { heroes: Record<HeroId, string>; guns: Record<GunId, string>; utils: Record<UtilId, string> } {
  const size = 256;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#FFF1E0', '#5B2A86', 1.8));
  const sun = new THREE.DirectionalLight('#FFFFFF', 2.4);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

  const heroes = {} as Record<HeroId, string>;
  for (const id of HERO_IDS) {
    const skin = createHeroSkin(id);
    skin.setGun('pistol');
    skin.root.rotation.y = -0.45;
    scene.add(skin.root);
    camera.position.set(0, 1.2, 4.6);
    camera.lookAt(0, 0.8, 0);
    renderer.render(scene, camera);
    heroes[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(skin.root);
    skin.dispose();
  }

  const guns = {} as Record<GunId, string>;
  const shoot = (g: THREE.Object3D, yaw: number): string => {
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    const len = box.getSize(new THREE.Vector3()).length();
    g.position.sub(center);
    const holder = new THREE.Group();
    holder.add(g);
    holder.rotation.set(0.25, yaw, 0);
    scene.add(holder);
    camera.position.set(0, 0, len * 2.1);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    scene.remove(holder);
    return renderer.domElement.toDataURL('image/png');
  };
  const utils = {} as Record<UtilId, string>;
  for (const id of UTIL_IDS) utils[id] = shoot(createUtilModel(id), 0.5);
  for (const id of GUN_IDS) {
    const g = createGunModel(id);
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    const len = box.getSize(new THREE.Vector3()).length();
    g.position.sub(center);
    const holder = new THREE.Group();
    holder.add(g);
    holder.rotation.set(0.25, -Math.PI / 2 + 0.3, 0);
    scene.add(holder);
    camera.position.set(0, 0, len * 2.1);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    guns[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(holder);
  }

  renderer.dispose();
  renderer.forceContextLoss();
  return { heroes, guns, utils };
}

const paintCache = new Map<HeroId, Record<PaintId, string>>();

/** One hero in every paint job, for the Customize panel. Rendered on first ask and cached. */
export function renderPaintPortraits(hero: HeroId): Record<PaintId, string> {
  const cached = paintCache.get(hero);
  if (cached) return cached;
  const size = 220;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#FFF1E0', '#5B2A86', 1.8));
  const sun = new THREE.DirectionalLight('#FFFFFF', 2.4);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.2, 4.6);
  camera.lookAt(0, 0.8, 0);
  const out = {} as Record<PaintId, string>;
  for (const paint of PAINT_IDS) {
    const skin = createHeroSkin(hero);
    skin.setGun('pistol');
    skin.setPaint(paint);
    skin.root.rotation.y = -0.45;
    scene.add(skin.root);
    renderer.render(scene, camera);
    out[paint] = renderer.domElement.toDataURL('image/png');
    scene.remove(skin.root);
    skin.dispose();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  paintCache.set(hero, out);
  return out;
}
