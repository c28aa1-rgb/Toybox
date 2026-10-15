import * as THREE from 'three';
import { POWER, POWERS, POWER_IDS, type PowerId, type Snapshot } from '@gg/shared';
import { createPowerModel } from '../skins/powers';
import type { Particles, Rings } from './fx';
import type { Sfx } from './audio';

/** 24×24 icon paths, shared by the HUD chips and the off-screen markers. */
export const POWER_ICONS: Record<PowerId, string> = {
  speed: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  damage: 'M12 1l2.5 5.5L20 4l-2.5 5.5L23 12l-5.5 2.5L20 20l-5.5-2.5L12 23l-2.5-5.5L4 20l2.5-5.5L1 12l5.5-2.5L4 4l5.5 2.5z',
  armor: 'M5 6c2-1.5 12-1.5 14 0 1.5 2 1.5 10 0 12-2 1.5-12 1.5-14 0-1.5-2-1.5-10 0-12z',
};

const DROP_HEIGHT = 13;
const HOVER_Y = 0.9;

/** Materials that should skip the toon outline pass. */
function flat(color: THREE.ColorRepresentation, opacity: number, additive = false): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.userData.outlineParameters = { visible: false };
  return m;
}

const GEO = {
  ring: new THREE.RingGeometry(0.88, 1, 48),
  disc: new THREE.CircleGeometry(1, 40),
  beam: new THREE.CylinderGeometry(1, 1, DROP_HEIGHT, 24, 1, true),
  shell: new THREE.SphereGeometry(0.62, 24, 16),
  halo: new THREE.TorusGeometry(0.72, 0.035, 8, 40),
  chevron: (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.22, 0.2);
    s.lineTo(-0.22, 0.2);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  })(),
};

interface DropView {
  root: THREE.Group;
  item: THREE.Group;
  model: THREE.Object3D;
  marker: THREE.Group;
  fill: THREE.Mesh;
  beam: THREE.Mesh;
  shadow: THREE.Mesh;
  glow: THREE.Mesh;
  halo: THREE.Mesh;
  power: PowerId;
  x: number;
  y: number;
  born: number;
  landAt: number;
  landed: boolean;
  /** Seen already on the floor (joined mid-round): skip the fall and the landing burst. */
  late: boolean;
  materials: THREE.Material[];
}

export interface PowerFxHooks {
  particles: Particles;
  rings: Rings;
  sfx: Sfx;
  /** 0..1, how close a point is to the camera's focus. */
  nearness(x: number, y: number): number;
  shake(amount: number): void;
  reducedMotion(): boolean;
}

/**
 * Power-ups on the floor. A drop is telegraphed by a target ring and a beam of light while the
 * toy falls out of the sky; it lands with a squash, a shockwave and confetti, then hovers in a bubble.
 */
export class PowerDrops {
  private views = new Map<number, DropView>();

  constructor(private world: THREE.Object3D, private hooks: PowerFxHooks) {}

  update(snap: Snapshot, clock: number, dt: number): void {
    const seen = new Set<number>();
    for (const k of snap.pickups) {
      if (k.kind !== 'power') continue;
      seen.add(k.id);
      let v = this.views.get(k.id);
      if (!v) {
        v = this.create(k.id, k.item as PowerId, k.x, k.y, clock, k.readyIn ?? 0);
        this.views.set(k.id, v);
      }
      this.animate(v, clock, dt, k.expiresIn);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.root.removeFromParent();
      for (const m of v.materials) m.dispose();
      this.views.delete(id);
    }
  }

  /** Every power-up on the map, landed or falling, for the off-screen markers. */
  list(): { id: number; power: PowerId; x: number; y: number }[] {
    return [...this.views.entries()].map(([id, v]) => ({ id, power: v.power, x: v.x, y: v.y }));
  }

  dispose(): void {
    for (const v of this.views.values()) {
      v.root.removeFromParent();
      for (const m of v.materials) m.dispose();
    }
    this.views.clear();
  }

  private create(id: number, power: PowerId, x: number, y: number, clock: number, readyIn: number): DropView {
    const color = POWERS[power].color;
    const materials: THREE.Material[] = [];
    const mat = (c: THREE.ColorRepresentation, o: number, add = false) => {
      const m = flat(c, o, add);
      materials.push(m);
      return m;
    };
    const root = new THREE.Group();
    root.position.set(x, 0, y);

    // Ground target: an outer ring, a disc that fills up as the drop nears, and chevrons closing in.
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(GEO.ring, mat(color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(1.3);
    const fill = new THREE.Mesh(GEO.disc, mat(color, 0.28));
    fill.rotation.x = -Math.PI / 2;
    fill.name = 'fill';
    marker.add(ring, fill);
    const chevMat = mat('#FFFFFF', 0.95);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(GEO.chevron, chevMat);
      c.rotation.x = -Math.PI / 2;
      c.rotation.z = (i / 4) * Math.PI * 2;
      c.name = 'chev';
      marker.add(c);
    }
    marker.position.y = 0.05;

    const beam = new THREE.Mesh(GEO.beam, mat(color, 0, true));
    beam.position.y = DROP_HEIGHT / 2;

    const shadow = new THREE.Mesh(GEO.disc, mat('#1B1030', 0));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    shadow.scale.setScalar(0.6);

    const glow = new THREE.Mesh(GEO.disc, mat(color, 0));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    glow.scale.setScalar(0.85);

    const item = new THREE.Group();
    const model = createPowerModel(power);
    model.scale.setScalar(1.25);
    const shell = new THREE.Mesh(GEO.shell, mat(color, 0.2));
    const halo = new THREE.Mesh(GEO.halo, mat('#FFFFFF', 0.85));
    halo.rotation.x = Math.PI / 2.4;
    item.add(model, shell, halo);

    root.add(marker, beam, shadow, glow, item);
    this.world.add(root);

    const late = readyIn <= 0;
    const landAt = clock + Math.min(readyIn, POWER.warnTime);
    if (!late) this.hooks.sfx.powerDrop(this.hooks.nearness(x, y));
    return {
      root, item, model, marker, fill, beam, shadow, glow, halo, power, x, y,
      born: clock, landAt, landed: late, late, materials,
    };
  }

  private animate(v: DropView, clock: number, dt: number, expiresIn: number): void {
    const color = POWERS[v.power].color;
    const opacity = (m: THREE.Mesh, o: number) => ((m.material as THREE.MeshBasicMaterial).opacity = o);
    v.model.rotation.y += dt * (clock < v.landAt ? 9 : 1.8);
    v.halo.rotation.z += dt * 2.4;

    if (clock < v.landAt) {
      // Falling: p runs 0 → 1 across the warning, the fall accelerates like gravity.
      const span = Math.max(0.01, v.landAt - v.born);
      const p = Math.min(1, (clock - v.born) / span);
      const age = clock - v.born;
      const pop = Math.min(1, age / 0.25);
      const back = 1 + 2.4 * (pop - 1) ** 3 + 1.4 * (pop - 1) ** 2;
      v.marker.scale.setScalar(Math.max(0.01, back));
      v.marker.rotation.y += dt * (1.5 + p * 5);
      v.fill.scale.setScalar(Math.max(0.01, p * 1.15));
      // Chevrons slide in from the edge toward the center as the drop arrives.
      for (const c of v.marker.children) {
        if (c.name !== 'chev') continue;
        const a = c.rotation.z;
        const r = 2.2 - p * 1.4;
        c.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      }
      // The ring blinks faster the closer it gets.
      const blink = 0.55 + 0.4 * Math.sin(age * (8 + p * 22));
      opacity(v.marker.children[0] as THREE.Mesh, blink);
      v.beam.scale.set(0.55 * (1 - p * 0.6), 1, 0.55 * (1 - p * 0.6));
      opacity(v.beam, Math.min(1, age / 0.2) * (0.22 + 0.08 * Math.sin(age * 18)));
      v.item.position.y = HOVER_Y + DROP_HEIGHT * (1 - p * p);
      v.item.scale.setScalar(Math.max(0.01, pop));
      v.shadow.scale.setScalar(0.3 + 0.5 * p);
      opacity(v.shadow, 0.35 * p);
      return;
    }

    if (!v.landed) {
      v.landed = true;
      this.land(v);
    }
    const a = clock - v.landAt;
    // Squash on impact, then wobble back to round.
    const squash = v.late ? 0 : 0.4 * Math.exp(-7 * a) * Math.cos(17 * a);
    const sy = 1 - squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    const grow = v.late ? Math.min(1, (clock - v.born) / 0.25) : 1;
    v.item.scale.set(sxz * grow, sy * grow, sxz * grow);
    const settle = Math.min(1, a / 0.5);
    v.item.position.y = HOVER_Y * (0.75 + 0.25 * settle) + Math.sin(clock * 3 + v.x) * 0.12 * settle;

    // The target and the beam flash out right after the landing.
    const fade = Math.max(0, 1 - a / 0.35);
    v.marker.visible = fade > 0;
    v.marker.scale.setScalar(1 + (1 - fade) * 0.6);
    opacity(v.marker.children[0] as THREE.Mesh, fade);
    opacity(v.fill, 0.28 * fade);
    v.beam.visible = fade > 0;
    v.beam.scale.set(0.55 + (1 - fade) * 0.8, 1, 0.55 + (1 - fade) * 0.8);
    opacity(v.beam, 0.55 * fade);
    opacity(v.shadow, 0.25);
    v.shadow.scale.setScalar(0.7);
    opacity(v.glow, 0.35 + 0.15 * Math.sin(clock * 4));
    (v.glow.material as THREE.MeshBasicMaterial).color.set(color);
    // Blink for the last three seconds before it vanishes.
    v.root.visible = expiresIn > 3 || Math.floor(clock * 8) % 2 === 0;
  }

  private land(v: DropView): void {
    if (v.late) return;
    const { particles, rings, sfx } = this.hooks;
    const color = POWERS[v.power].color;
    const near = this.hooks.nearness(v.x, v.y);
    rings.spawn(v.x, v.y, 3.2, color, 0.45);
    rings.spawn(v.x, v.y, 1.8, '#FFFFFF', 0.3);
    particles.burst({ x: v.x, y: v.y, z: 0.3, count: 34, color: [color, '#FFFFFF', color], speed: 7, up: 6, life: 0.8, size: 0.2 });
    particles.burst({ x: v.x, y: v.y, z: 0.1, count: 14, color: ['#C9B6E8', '#FFFFFF'], speed: 4, up: 1, life: 0.45, size: 0.18, gravity: 4 });
    sfx.powerLand(near);
    if (!this.hooks.reducedMotion()) this.hooks.shake(0.18 * near);
  }
}

interface AuraView {
  root: THREE.Group;
  speed: THREE.Mesh;
  damage: THREE.Group;
  armor: THREE.Mesh;
  trailAt: number;
  materials: THREE.Material[];
}

/** Effects around players with an active power-up: a spinning arc, orbiting spikes, a pillow bubble. */
export class PowerAuras {
  private views = new Map<string, AuraView>();
  private arcGeo = new THREE.RingGeometry(0.82, 0.98, 32, 1, 0, Math.PI * 1.4);
  private spikeGeo = new THREE.ConeGeometry(0.09, 0.26, 8);
  private bubbleGeo = new THREE.SphereGeometry(1.05, 24, 16);

  constructor(private world: THREE.Object3D, private particles: Particles) {}

  update(id: string, x: number, y: number, alive: boolean, powers: Partial<Record<PowerId, number>>, moved: number, clock: number): void {
    const active = alive && POWER_IDS.some((p) => powers[p]);
    let v = this.views.get(id);
    if (!active) {
      if (v) v.root.visible = false;
      return;
    }
    if (!v) {
      v = this.create();
      this.views.set(id, v);
    }
    v.root.visible = true;
    v.root.position.set(x, 0, y);

    v.speed.visible = !!powers.speed;
    v.speed.rotation.z = -clock * 7;
    v.damage.visible = !!powers.damage;
    v.damage.rotation.y = clock * 3;
    v.armor.visible = !!powers.armor;
    v.armor.scale.setScalar(1 + Math.sin(clock * 5) * 0.03);
    // Fade the effect out over its final two seconds.
    for (const p of POWER_IDS) {
      const left = powers[p] ?? 0;
      const k = left < 2 && Math.floor(clock * 10) % 2 === 0 ? 0.35 : 1;
      const obj = p === 'speed' ? v.speed : p === 'damage' ? v.damage : v.armor;
      obj.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (m && 'opacity' in m) m.opacity = (m.userData.baseOpacity as number) * k;
      });
    }
    // Sugar Rush leaves a sparkle trail while running.
    if (powers.speed && moved > 0.01 && clock >= v.trailAt) {
      v.trailAt = clock + 0.05;
      this.particles.burst({ x, y, z: 0.15, count: 2, color: [POWERS.speed.color, '#FFFFFF'], speed: 0.6, up: 1.2, life: 0.4, size: 0.12, gravity: 1 });
    }
  }

  /** Drop views for players that left. */
  prune(present: Set<string>): void {
    for (const [id, v] of this.views) {
      if (present.has(id)) continue;
      v.root.removeFromParent();
      for (const m of v.materials) m.dispose();
      this.views.delete(id);
    }
  }

  dispose(): void {
    this.prune(new Set());
  }

  private create(): AuraView {
    const materials: THREE.Material[] = [];
    const mat = (c: string, o: number) => {
      const m = flat(c, o);
      m.userData.baseOpacity = o;
      materials.push(m);
      return m;
    };
    const root = new THREE.Group();
    const speed = new THREE.Mesh(this.arcGeo, mat(POWERS.speed.color, 0.85));
    speed.rotation.x = -Math.PI / 2;
    speed.position.y = 0.07;
    const damage = new THREE.Group();
    const spikeMat = mat(POWERS.damage.color, 0.95);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const s = new THREE.Mesh(this.spikeGeo, spikeMat);
      s.position.set(Math.cos(a) * 0.95, 1.0, Math.sin(a) * 0.95);
      // Point outward.
      s.rotation.z = -Math.PI / 2;
      s.rotation.y = -a;
      damage.add(s);
    }
    const armor = new THREE.Mesh(this.bubbleGeo, mat(POWERS.armor.color, 0.18));
    armor.position.y = 0.9;
    root.add(speed, damage, armor);
    this.world.add(root);
    return { root, speed, damage, armor, trailAt: 0, materials };
  }
}
