import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  GUNS, GUN_IDS, HEROES, INTERP_DELAY, MAX_HP, MAX_INPUT_DT, PICKUP_RADIUS, STATIC_WALLS, stepMovement,
  type DecoySnap, type GameEvent, type GunId, type HeroId, type InputFrame, type PlayerSnap, type Rect,
  type Snapshot,
} from '@gg/shared';
import { createGunModel, createHeroSkin, type HeroSkin } from '../skins/registry';
import { addKill, addWin, loadProfile, saveProfile } from '../unlocks';
import { Sfx } from './audio';
import { Particles, Rings, Shake } from './fx';
import { Input } from './input';
import { Net } from './net';
import { createScene, PALETTE, WALL_HEIGHT, type SceneBundle } from './scene';
import { HudStore, type HudState } from './store';
import { toon } from '../skins/toon';

export interface JoinOptions {
  room: string;
  name: string;
  hero: HeroId;
  gun: GunId;
}

interface PlayerView {
  skin: HeroSkin;
  hero: HeroId;
  label: CSS2DObject;
  nameEl: HTMLElement;
  hpEl: HTMLElement;
  lastX: number;
  lastY: number;
  lastHp: number;
}

interface DamageNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  life: number;
}

const BULLET_COLORS: Record<GunId, string> = {
  pistol: PALETTE.lemon,
  smg: PALETTE.sky,
  shotgun: '#FFB36B',
  sniper: PALETTE.mint,
  rocket: PALETTE.bubblegum,
};

const CAMERA_OFFSET = new THREE.Vector3(0, 18, 12);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class GameClient {
  readonly hud: HudStore;
  private net: Net;
  private s: SceneBundle;
  private input: Input;
  private particles: Particles;
  private rings: Rings;
  private shake = new Shake();
  private sfx = new Sfx();

  private snaps: Snapshot[] = [];
  private latest: Snapshot | null = null;
  private eventQueue: { time: number; ev: GameEvent }[] = [];
  private myId: string | null = null;

  private seq = 0;
  private pending: InputFrame[] = [];
  private pred = { x: 0, y: 0 };
  private predOffset = new THREE.Vector2();
  private aim = 0;
  private aimPoint = new THREE.Vector3();

  private views = new Map<string, PlayerView>();
  private decoyViews = new Map<number, PlayerView>();
  private bulletMeshes = new Map<number, THREE.Mesh>();
  private pickupViews = new Map<number, THREE.Group>();
  private wallViews = new Map<number, { mesh: THREE.Mesh; hp: number; born: number }>();
  private bubbleViews = new Map<number, THREE.Group>();
  private damageNumbers: DamageNumber[] = [];
  private overlay: HTMLDivElement;
  private cursorRing: THREE.Mesh;

  private camTarget = new THREE.Vector3();
  private camReady = false;
  private raf = 0;
  private lastFrame = performance.now();
  private hudAt = 0;
  private feedKey = 0;
  private hitstopUntil = 0;
  private extraDelay = 0;
  private clock = 0;
  private disposed = false;

  private bulletGeo = new THREE.SphereGeometry(0.13, 8, 6);
  private bulletMats = new Map<GunId, THREE.MeshBasicMaterial>();

  constructor(private container: HTMLElement, private opts: JoinOptions) {
    this.s = createScene(container);
    this.input = new Input(this.s.renderer.domElement);
    this.particles = new Particles(this.s.scene);
    this.rings = new Rings(this.s.scene);
    this.overlay = document.createElement('div');
    this.overlay.className = 'damage-layer';
    container.appendChild(this.overlay);

    this.cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: PALETTE.lemon, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    (this.cursorRing.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.cursorRing.rotation.x = -Math.PI / 2;
    this.s.scene.add(this.cursorRing);

    for (const g of GUN_IDS) {
      const m = new THREE.MeshBasicMaterial({ color: BULLET_COLORS[g] });
      m.userData.outlineParameters = { visible: false };
      this.bulletMats.set(g, m);
    }

    this.hud = new HudStore({
      connected: false, error: null, room: opts.room, host: false, myId: null, me: null, players: [],
      phase: 'playing', winner: null, endsIn: 0, feed: [], ping: 0, killedBy: null, nearPickup: null,
      loadout: { hero: opts.hero, gun: opts.gun }, scoreboard: false, hurtTick: 0, toast: null, bots: 0,
    });

    this.net = new Net({
      onWelcome: (id, room, host) => {
        this.myId = id;
        this.hud.set({ connected: true, myId: id, room, host });
        const url = new URL(location.href);
        url.searchParams.set('room', room);
        history.replaceState(null, '', url);
      },
      onSnapshot: (snap) => this.onSnapshot(snap),
      onError: (message) => this.hud.set({ error: message }),
      onClose: () => this.hud.set({ connected: false, error: this.hud.get().error ?? 'Disconnected from the server.' }),
    });
    this.net.whenOpen(() => {
      this.net.send({ type: 'join', room: opts.room, name: opts.name, hero: opts.hero, gun: opts.gun });
    });

    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __gg: GameClient }).__gg = this;
  }

  /** Debug view of prediction state, used by browser tests. */
  debug(): { pred: { x: number; y: number }; server: { x: number; y: number } | null; pending: number } {
    const me = this.latest?.players.find((p) => p.id === this.myId);
    return { pred: { ...this.pred }, server: me ? { x: me.x, y: me.y } : null, pending: this.pending.length };
  }

  // ---------- public controls ----------

  setLoadout(hero: HeroId, gun: GunId): void {
    this.net.send({ type: 'loadout', hero, gun });
    this.hud.set({ loadout: { hero, gun } });
    const p = loadProfile();
    saveProfile({ ...p, hero, gun });
  }

  setBots(count: number): void {
    this.net.send({ type: 'bots', count });
    this.botsWanted = { count, at: performance.now() };
    this.hud.set({ bots: count });
  }

  /** Last bot count the host asked for; shown until the server catches up so fast clicks stack. */
  private botsWanted: { count: number; at: number } | null = null;

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.net.close();
    for (const v of this.views.values()) v.skin.dispose();
    this.overlay.remove();
    this.s.dispose();
  }

  // ---------- networking ----------

  private predictionWorld(): { walls: Rect[]; bubbles: Snapshot['bubbles'] } {
    const snap = this.latest;
    return {
      walls: snap && snap.walls.length ? [...STATIC_WALLS, ...snap.walls] : STATIC_WALLS,
      bubbles: snap?.bubbles ?? [],
    };
  }

  private onSnapshot(snap: Snapshot): void {
    this.latest = snap;
    this.snaps.push(snap);
    while (this.snaps.length > 2 && this.snaps[1].time < snap.time - 1) this.snaps.shift();
    for (const ev of snap.events) this.eventQueue.push({ time: snap.time, ev });

    const me = snap.players.find((p) => p.id === this.myId);
    if (!me) return;
    if (!me.alive || snap.phase !== 'playing') {
      this.pending = [];
      this.pred = { x: me.x, y: me.y };
      this.predOffset.set(0, 0);
      return;
    }
    const before = { ...this.pred };
    this.pending = this.pending.filter((f) => f.seq > snap.ack);
    this.pred = { x: me.x, y: me.y };
    const { walls, bubbles } = this.predictionWorld();
    for (const f of this.pending) stepMovement(this.pred, f.mx, f.my, f.dt, me.id, walls, bubbles);
    const ex = before.x - this.pred.x;
    const ey = before.y - this.pred.y;
    if (Math.hypot(ex, ey) > 2) this.predOffset.set(0, 0);
    else this.predOffset.set(this.predOffset.x + ex, this.predOffset.y + ey);
  }

  // ---------- frame ----------

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const rawDt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const hitstop = now < this.hitstopUntil;
    const dt = hitstop ? rawDt * 0.05 : rawDt;
    this.clock += dt;

    const snap = this.latest;
    const me = snap?.players.find((p) => p.id === this.myId) ?? null;

    this.updateAim();
    if (snap && me) this.sendInput(rawDt, me, snap);

    // Hitstop freezes the interpolation clock; afterwards it catches up gradually.
    if (hitstop) this.extraDelay += rawDt;
    else this.extraDelay = Math.max(0, this.extraDelay - rawDt * 0.4);
    const renderTime = this.net.serverNow() - INTERP_DELAY - this.extraDelay;
    this.flushEvents(renderTime);

    if (snap) {
      this.renderPlayers(renderTime, dt, snap);
      this.renderBullets(renderTime);
      this.renderDecoys(renderTime, dt, snap);
      this.renderStatic(snap, dt);
    }

    this.particles.update(dt);
    this.rings.update(dt);
    this.updateCamera(rawDt, me);
    this.updateDamageNumbers(rawDt);

    this.s.outline.render(this.s.scene, this.s.camera);
    this.s.labels.render(this.s.scene, this.s.camera);

    if (now - this.hudAt > 100) {
      this.hudAt = now;
      this.pushHud(snap, me);
    }
  };

  private updateAim(): void {
    const el = this.s.renderer.domElement;
    const ndc = new THREE.Vector2(
      (this.input.mouseX / el.clientWidth) * 2 - 1,
      -(this.input.mouseY / el.clientHeight) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.s.camera);
    // Aim at gun height so the cursor sits where bullets actually fly.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.7);
    ray.ray.intersectPlane(plane, this.aimPoint);
    this.cursorRing.position.set(this.aimPoint.x, 0.05, this.aimPoint.z);
  }

  private sendInput(dt: number, me: PlayerSnap, snap: Snapshot): void {
    const px = this.pred.x;
    const py = this.pred.y;
    this.aim = Math.atan2(this.aimPoint.z - py, this.aimPoint.x - px);
    const aimDist = Math.hypot(this.aimPoint.x - px, this.aimPoint.z - py);
    const { mx, my } = this.input.move();
    const frame: InputFrame = {
      seq: ++this.seq,
      dt: Math.min(dt, MAX_INPUT_DT),
      mx, my,
      aim: this.aim,
      aimDist,
      fire: this.input.fireHeld,
      ability: this.input.takeAbility(),
      pickup: this.input.takePickup(),
    };
    if (me.alive && snap.phase === 'playing') {
      const { walls, bubbles } = this.predictionWorld();
      stepMovement(this.pred, mx, my, frame.dt, me.id, walls, bubbles);
      this.pending.push(frame);
      if (this.pending.length > 120) this.pending.shift();
    }
    this.net.send({ type: 'input', frames: [frame] });
  }

  private bracket(renderTime: number): { a: Snapshot; b: Snapshot; k: number } | null {
    const snaps = this.snaps;
    if (!snaps.length) return null;
    for (let i = snaps.length - 2; i >= 0; i--) {
      if (snaps[i].time <= renderTime) {
        const a = snaps[i];
        const b = snaps[i + 1];
        const k = Math.min(1, Math.max(0, (renderTime - a.time) / Math.max(1e-6, b.time - a.time)));
        return { a, b, k };
      }
    }
    return { a: snaps[0], b: snaps[0], k: 0 };
  }

  private renderPlayers(renderTime: number, dt: number, snap: Snapshot): void {
    const br = this.bracket(renderTime);
    const seen = new Set<string>();
    const decay = Math.exp(-14 * dt);
    this.predOffset.multiplyScalar(decay);

    for (const p of snap.players) {
      seen.add(p.id);
      let view = this.views.get(p.id);
      if (!view || view.hero !== p.hero) {
        if (view) this.removeView(view);
        view = this.makeView(p.hero, p.name, p.id === this.myId);
        this.views.set(p.id, view);
      }
      let x: number;
      let y: number;
      let aim: number;
      let alive: boolean;
      let shield = p.shield;
      if (p.id === this.myId && p.alive && snap.phase === 'playing') {
        x = this.pred.x + this.predOffset.x;
        y = this.pred.y + this.predOffset.y;
        aim = this.aim;
        alive = true;
      } else if (br) {
        const pa = br.a.players.find((o) => o.id === p.id) ?? p;
        const pb = br.b.players.find((o) => o.id === p.id) ?? p;
        const jump = Math.hypot(pb.x - pa.x, pb.y - pa.y) > 3; // teleports don't slide
        const k = jump ? 1 : br.k;
        x = pa.x + (pb.x - pa.x) * k;
        y = pa.y + (pb.y - pa.y) * k;
        aim = lerpAngle(pa.aim, pb.aim, k);
        alive = pb.alive;
        shield = pb.shield;
      } else {
        x = p.x;
        y = p.y;
        aim = p.aim;
        alive = p.alive;
      }
      this.placeView(view, x, y, aim, alive, dt, p.gun, shield);
      this.updateLabel(view, p.hp, alive);
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.removeView(view);
        this.views.delete(id);
      }
    }
  }

  private renderDecoys(renderTime: number, dt: number, snap: Snapshot): void {
    const br = this.bracket(renderTime);
    const list: DecoySnap[] = br ? br.b.decoys : snap.decoys;
    const seen = new Set<number>();
    for (const d of list) {
      const owner = snap.players.find((p) => p.id === d.owner);
      if (!owner) continue;
      seen.add(d.id);
      let view = this.decoyViews.get(d.id);
      if (!view) {
        view = this.makeView(owner.hero, owner.name, false);
        this.decoyViews.set(d.id, view);
        view.lastX = d.x;
        view.lastY = d.y;
      }
      const da = br?.a.decoys.find((o) => o.id === d.id) ?? d;
      const k = br?.k ?? 1;
      const x = da.x + (d.x - da.x) * k;
      const y = da.y + (d.y - da.y) * k;
      this.placeView(view, x, y, lerpAngle(da.aim, d.aim, k), true, dt, owner.gun, false);
      // Decoys copy the owner's health bar so they can't be told apart by it.
      this.updateLabel(view, owner.hp, true);
    }
    for (const [id, view] of this.decoyViews) {
      if (!seen.has(id)) {
        this.removeView(view);
        this.decoyViews.delete(id);
      }
    }
  }

  private makeView(hero: HeroId, name: string, mine: boolean): PlayerView {
    const skin = createHeroSkin(hero);
    this.s.world.add(skin.root);
    const wrap = document.createElement('div');
    wrap.className = `nametag${mine ? ' nametag--me' : ''}`;
    const nameEl = document.createElement('span');
    nameEl.className = 'nametag__name';
    nameEl.textContent = mine ? 'You' : name;
    nameEl.style.setProperty('--hero', HEROES[hero].color);
    const bar = document.createElement('span');
    bar.className = 'nametag__bar';
    const hpEl = document.createElement('span');
    hpEl.className = 'nametag__hp';
    bar.appendChild(hpEl);
    wrap.append(nameEl, bar);
    const label = new CSS2DObject(wrap);
    // Sit the tag just above the tallest point of whichever model this hero uses.
    const top = new THREE.Box3().setFromObject(skin.root).max.y;
    label.position.set(0, Math.max(2.15, top + 0.35), 0);
    skin.root.add(label);
    return { skin, hero, label, nameEl, hpEl, lastX: NaN, lastY: NaN, lastHp: MAX_HP };
  }

  private removeView(view: PlayerView): void {
    view.label.element.remove();
    view.skin.root.removeFromParent();
    view.skin.dispose();
  }

  private placeView(view: PlayerView, x: number, y: number, aim: number, alive: boolean, dt: number, gun: GunId, shield: boolean): void {
    const moved = Number.isNaN(view.lastX) ? 0 : Math.hypot(x - view.lastX, y - view.lastY);
    view.lastX = x;
    view.lastY = y;
    const root = view.skin.root;
    root.visible = alive;
    root.position.set(x, 0, y);
    // Models face +Z; sim angle 0 points along +X.
    root.rotation.y = Math.PI / 2 - aim;
    view.skin.setGun(gun);
    view.skin.setGhost(shield && Math.floor(this.clock * 8) % 2 === 0);
    const speed = dt > 0 ? moved / dt : 0;
    view.skin.animate(dt, Math.min(1, speed / 6));
  }

  private updateLabel(view: PlayerView, hp: number, alive: boolean): void {
    view.label.element.style.display = alive ? '' : 'none';
    if (hp !== view.lastHp) {
      if (hp < view.lastHp) view.skin.flash();
      view.lastHp = hp;
      view.hpEl.style.transform = `scaleX(${Math.max(0, hp) / MAX_HP})`;
      view.hpEl.dataset.low = hp <= 35 ? 'true' : 'false';
    }
  }

  private renderBullets(renderTime: number): void {
    const br = this.bracket(renderTime);
    if (!br) return;
    const seen = new Set<number>();
    for (const b of br.b.bullets) {
      const a = br.a.bullets.find((o) => o.id === b.id);
      // Bullets spawned after `a` start at their first known position.
      const x = a ? a.x + (b.x - a.x) * br.k : b.x;
      const y = a ? a.y + (b.y - a.y) * br.k : b.y;
      if (!a && br.k < 0.5 && br.a !== br.b) continue;
      seen.add(b.id);
      let m = this.bulletMeshes.get(b.id);
      if (!m) {
        m = new THREE.Mesh(this.bulletGeo, this.bulletMats.get(b.gun)!);
        const big = b.gun === 'rocket' ? 2.2 : b.gun === 'sniper' ? 1.1 : 1;
        m.scale.setScalar(big);
        this.s.scene.add(m);
        this.bulletMeshes.set(b.id, m);
      }
      if (a) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        m.rotation.y = -ang;
        const stretch = b.gun === 'sniper' ? 4 : b.gun === 'rocket' ? 1.3 : 2.2;
        m.scale.x = stretch * (b.gun === 'rocket' ? 2.2 : 1);
      }
      m.position.set(x, 0.7, y);
    }
    for (const [id, m] of this.bulletMeshes) {
      if (!seen.has(id)) {
        m.removeFromParent();
        this.bulletMeshes.delete(id);
      }
    }
  }

  private renderStatic(snap: Snapshot, dt: number): void {
    // Pickups
    const seenP = new Set<number>();
    for (const k of snap.pickups) {
      seenP.add(k.id);
      let g = this.pickupViews.get(k.id);
      if (!g) {
        g = new THREE.Group();
        const model = createGunModel(k.gun);
        model.scale.setScalar(1.5);
        model.name = 'model';
        const glow = new THREE.Mesh(
          new THREE.CircleGeometry(0.75, 28),
          new THREE.MeshBasicMaterial({ color: BULLET_COLORS[k.gun], transparent: true, opacity: 0.45, depthWrite: false }),
        );
        (glow.material as THREE.Material).userData.outlineParameters = { visible: false };
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.1;
        g.add(model, glow);
        g.position.set(k.x, 0, k.y);
        g.scale.setScalar(0.01);
        this.s.world.add(g);
        this.pickupViews.set(k.id, g);
      }
      const model = g.getObjectByName('model')!;
      model.rotation.y += dt * 1.6;
      model.position.y = 0.75 + Math.sin(this.clock * 3 + k.id) * 0.12;
      const sc = g.scale.x + (1 - g.scale.x) * Math.min(1, dt * 10);
      g.scale.setScalar(sc);
    }
    for (const [id, g] of this.pickupViews) {
      if (!seenP.has(id)) {
        g.removeFromParent();
        this.pickupViews.delete(id);
      }
    }

    // Built walls
    const seenW = new Set<number>();
    for (const w of snap.walls) {
      seenW.add(w.id);
      let v = this.wallViews.get(w.id);
      if (!v) {
        const mesh = new THREE.Mesh(
          new RoundedBoxGeometry(w.w, WALL_HEIGHT, w.h, 2, 0.12),
          toon(PALETTE.tangerine).clone(),
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(w.x + w.w / 2, WALL_HEIGHT / 2, w.y + w.h / 2);
        this.s.world.add(mesh);
        v = { mesh, hp: w.hp, born: this.clock };
        this.wallViews.set(w.id, v);
      }
      const age = this.clock - v.born;
      const rise = Math.min(1, age / 0.18);
      const overshoot = rise < 1 ? rise : 1 + Math.sin(Math.min(1, (age - 0.18) / 0.25) * Math.PI) * 0.08;
      v.mesh.scale.y = Math.max(0.01, overshoot);
      v.mesh.position.y = (WALL_HEIGHT * v.mesh.scale.y) / 2;
      if (w.hp < v.hp) {
        v.hp = w.hp;
        (v.mesh.material as THREE.MeshToonMaterial).color.set(PALETTE.tangerine).lerp(new THREE.Color('#5a2c10'), 1 - w.hp);
      }
    }
    for (const [id, v] of this.wallViews) {
      if (!seenW.has(id)) {
        v.mesh.removeFromParent();
        (v.mesh.material as THREE.Material).dispose();
        v.mesh.geometry.dispose();
        this.wallViews.delete(id);
      }
    }

    // Time bubbles
    const seenB = new Set<number>();
    for (const b of snap.bubbles) {
      seenB.add(b.id);
      let g = this.bubbleViews.get(b.id);
      if (!g) {
        g = new THREE.Group();
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: PALETTE.mint, transparent: true, opacity: 0.16, depthWrite: false }),
        );
        const rim = new THREE.Mesh(
          new THREE.RingGeometry(0.94, 1, 48),
          new THREE.MeshBasicMaterial({ color: PALETTE.mint, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
        );
        rim.rotation.x = -Math.PI / 2;
        rim.position.y = 0.05;
        for (const m of [dome, rim]) (m.material as THREE.Material).userData.outlineParameters = { visible: false };
        dome.name = 'dome';
        g.add(dome, rim);
        g.position.set(b.x, 0, b.y);
        g.scale.setScalar(0.01);
        g.userData.born = this.clock;
        this.s.world.add(g);
        this.bubbleViews.set(b.id, g);
      }
      const age = this.clock - (g.userData.born as number);
      const grow = Math.min(1, age / 0.25);
      const ease = 1 + 2.2 * (grow - 1) ** 3 + 1.2 * (grow - 1) ** 2; // ease-out-back
      const closing = b.endsIn < 0.3 ? Math.max(0.01, b.endsIn / 0.3) : 1;
      g.scale.setScalar(b.r * ease * closing);
      const dome = g.getObjectByName('dome') as THREE.Mesh;
      (dome.material as THREE.MeshBasicMaterial).opacity = 0.13 + Math.sin(this.clock * 4) * 0.04;
    }
    for (const [id, g] of this.bubbleViews) {
      if (!seenB.has(id)) {
        g.removeFromParent();
        this.bubbleViews.delete(id);
      }
    }
  }

  private updateCamera(dt: number, me: PlayerSnap | null): void {
    const target = new THREE.Vector3();
    const st = this.hud.get();
    if (me && me.alive) {
      target.set(this.pred.x + this.predOffset.x, 0, this.pred.y + this.predOffset.y);
      // Lean toward the cursor so you can see where you're aiming.
      const lead = new THREE.Vector3(this.aimPoint.x - target.x, 0, this.aimPoint.z - target.z);
      lead.clampLength(0, 10).multiplyScalar(0.18);
      target.add(lead);
    } else if (me) {
      const killer = st.killedBy ? this.views.get(st.killedBy) : null;
      const v = killer?.skin.root.visible ? killer : this.views.get(me.id);
      if (v) target.copy(v.skin.root.position);
    }
    if (!this.camReady) {
      this.camTarget.copy(target);
      this.camReady = !!me;
    } else {
      this.camTarget.lerp(target, 1 - Math.exp(-7 * dt));
    }
    const shake = this.shake.offset(dt, reducedMotion());
    this.s.camera.position.copy(this.camTarget).add(CAMERA_OFFSET).add(shake);
    this.s.camera.lookAt(this.camTarget.x + shake.x * 0.3, 0, this.camTarget.z + shake.z * 0.3);
  }

  // ---------- events ----------

  private flushEvents(renderTime: number): void {
    while (this.eventQueue.length && this.eventQueue[0].time <= renderTime + 0.02) {
      this.handleEvent(this.eventQueue.shift()!.ev);
    }
    // Never let events lag far behind (tab was hidden, etc).
    if (this.eventQueue.length > 400) this.eventQueue.splice(0, this.eventQueue.length - 100);
  }

  private nearness(x: number, y: number): number {
    const d = Math.hypot(x - this.camTarget.x, y - this.camTarget.z);
    return Math.max(0, 1 - d / 22);
  }

  private viewPos(id: string): { x: number; y: number } | null {
    const v = this.views.get(id);
    return v ? { x: v.skin.root.position.x, y: v.skin.root.position.z } : null;
  }

  private handleEvent(ev: GameEvent): void {
    const me = this.myId;
    switch (ev.t) {
      case 'shot': {
        const isMe = ev.id === me;
        const pos = isMe ? { x: this.pred.x, y: this.pred.y } : { x: ev.x, y: ev.y };
        const mx = pos.x + Math.cos(ev.a) * 0.95;
        const my = pos.y + Math.sin(ev.a) * 0.95;
        const big = ev.gun === 'shotgun' || ev.gun === 'rocket' || ev.gun === 'sniper';
        this.particles.burst({
          x: mx, y: my, count: big ? 9 : 4, color: [PALETTE.lemon, '#FFFFFF', BULLET_COLORS[ev.gun]],
          speed: big ? 6 : 4, up: 1, life: 0.12, size: big ? 0.22 : 0.15, dir: ev.a, cone: 0.7, gravity: 0,
        });
        this.sfx.shot(ev.gun, isMe ? 1 : this.nearness(ev.x, ev.y));
        if (isMe) this.shake.add(ev.gun === 'sniper' || ev.gun === 'rocket' ? 0.28 : ev.gun === 'shotgun' ? 0.22 : 0.05);
        break;
      }
      case 'hit': {
        this.particles.burst({ x: ev.x, y: ev.y, count: 7, color: ['#FFFFFF', PALETTE.bubblegum], speed: 5, up: 3, life: 0.3, size: 0.13 });
        if (ev.target === me) {
          this.sfx.hurt();
          this.shake.add(0.22);
          this.hud.set({ hurtTick: this.hud.get().hurtTick + 1 });
        } else if (ev.by === me) {
          this.sfx.hit();
        }
        if (ev.by === me || ev.target === me) this.spawnDamageNumber(ev.x, ev.y, ev.dmg, ev.target === me);
        break;
      }
      case 'kill': {
        const pos = this.viewPos(ev.victim);
        if (pos) {
          this.particles.burst({
            x: pos.x, y: pos.y, count: 36, speed: 7, up: 6, life: 0.9, size: 0.2,
            color: [HEROES[this.heroOf(ev.victim)].color, PALETTE.lemon, '#FFFFFF', PALETTE.ink],
          });
          this.rings.spawn(pos.x, pos.y, 2.2, '#FFFFFF', 0.3);
        }
        const feed = [
          ...this.hud.get().feed,
          { key: ++this.feedKey, killer: this.nameOf(ev.killer), victim: this.nameOf(ev.victim), gun: ev.gun, mine: ev.killer === me || ev.victim === me },
        ].slice(-5);
        this.hud.set({ feed });
        if (ev.killer === me && ev.victim !== me) {
          this.sfx.kill();
          this.shake.add(0.35);
          if (!reducedMotion()) this.hitstopUntil = performance.now() + 70;
          this.recordKill();
        }
        if (ev.victim === me) {
          this.sfx.death();
          this.hud.set({ killedBy: ev.killer === me ? null : ev.killer });
        }
        break;
      }
      case 'blink': {
        for (const [x, y] of [[ev.x1, ev.y1], [ev.x2, ev.y2]]) {
          this.particles.burst({ x, y, count: 14, color: [PALETTE.sky, '#FFFFFF'], speed: 4, up: 3, life: 0.4, gravity: 2 });
        }
        this.rings.spawn(ev.x2, ev.y2, 1.6, PALETTE.sky, 0.3);
        if (this.nearness(ev.x2, ev.y2) > 0.3) this.sfx.blink();
        break;
      }
      case 'swap': {
        for (const id of [ev.id, ev.target]) {
          const p = this.viewPos(id);
          if (p) this.rings.spawn(p.x, p.y, 1.8, PALETTE.bubblegum, 0.35);
        }
        if (ev.id === me || ev.target === me) {
          this.sfx.swap();
          this.shake.add(0.2);
        }
        break;
      }
      case 'swapFail':
        if (ev.id === me) {
          this.sfx.fail();
          this.toast('Swap blocked: that target is inside a time bubble.');
        }
        break;
      case 'bubble':
        this.rings.spawn(ev.x, ev.y, 3.8, PALETTE.mint, 0.4);
        if (this.nearness(ev.x, ev.y) > 0.2) this.sfx.bubble();
        break;
      case 'decoy':
        if (ev.id === me) this.sfx.pop();
        break;
      case 'wall':
        this.particles.burst({ x: ev.x, y: ev.y, z: 0.2, count: 12, color: ['#C9A98A', '#FFFFFF'], speed: 3, up: 2, life: 0.4 });
        if (this.nearness(ev.x, ev.y) > 0.3) this.sfx.wall();
        break;
      case 'wallBreak':
        this.particles.burst({ x: ev.x, y: ev.y, count: 24, color: [PALETTE.tangerine, '#5a2c10'], speed: 5, up: 5, life: 0.7, size: 0.24 });
        this.sfx.wall();
        break;
      case 'decoyPop':
        this.particles.burst({ x: ev.x, y: ev.y, count: 20, color: ['#B48CFF', '#FFFFFF'], speed: 4, up: 4, life: 0.5 });
        this.rings.spawn(ev.x, ev.y, 1.4, '#B48CFF', 0.3);
        if (this.nearness(ev.x, ev.y) > 0.3) this.sfx.pop();
        break;
      case 'explode': {
        const n = this.nearness(ev.x, ev.y);
        this.particles.burst({
          x: ev.x, y: ev.y, count: 40, color: [PALETTE.bubblegum, PALETTE.lemon, PALETTE.tangerine, '#FFFFFF'],
          speed: 8, up: 6, life: 0.7, size: 0.3,
        });
        this.rings.spawn(ev.x, ev.y, ev.r, PALETTE.lemon, 0.35);
        this.shake.add(0.5 * n);
        this.sfx.explode(n);
        break;
      }
      case 'pickup':
        if (ev.id === me) {
          this.sfx.pickup();
          this.toast(`Picked up the ${GUNS[ev.gun].name}. It's yours until you die.`);
        }
        break;
      case 'win': {
        this.sfx.win();
        if (ev.id === me) addWin();
        const p = this.viewPos(ev.id);
        if (p) {
          this.particles.burst({
            x: p.x, y: p.y, count: 120, speed: 9, up: 10, life: 2, size: 0.22, gravity: 6,
            color: [PALETTE.sky, PALETTE.bubblegum, PALETTE.lemon, PALETTE.mint, PALETTE.tangerine],
          });
        }
        break;
      }
    }
  }

  private recordKill(): void {
    const before = loadProfile().kills;
    const after = addKill().kills;
    const unlocked = GUN_IDS.filter((g) => GUNS[g].unlockKills > before && GUNS[g].unlockKills <= after);
    if (unlocked.length) this.toast(`Unlocked the ${GUNS[unlocked[0]].name}. Pick it next time you respawn.`);
  }

  private toast(text: string): void {
    this.hud.set({ toast: { key: Date.now(), text } });
  }

  private nameOf(id: string): string {
    if (id === this.myId) return 'You';
    return this.latest?.players.find((p) => p.id === id)?.name ?? '???';
  }

  private heroOf(id: string): HeroId {
    return this.latest?.players.find((p) => p.id === id)?.hero ?? 'blink';
  }

  private spawnDamageNumber(x: number, y: number, dmg: number, onMe: boolean): void {
    if (dmg <= 0) return;
    const el = document.createElement('div');
    el.className = `dmg${onMe ? ' dmg--me' : ''}`;
    el.textContent = String(dmg);
    this.overlay.appendChild(el);
    this.damageNumbers.push({
      el, pos: new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, 1.8, y), life: 0.75,
    });
  }

  private updateDamageNumbers(dt: number): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.damageNumbers = this.damageNumbers.filter((d) => {
      d.life -= dt;
      d.pos.y += dt * 1.6;
      if (d.life <= 0) {
        d.el.remove();
        return false;
      }
      const p = d.pos.clone().project(this.s.camera);
      d.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -50%)`;
      d.el.style.opacity = String(Math.min(1, d.life * 3));
      return true;
    });
  }

  private pushHud(snap: Snapshot | null, me: PlayerSnap | null): void {
    if (!snap) return;
    let nearPickup: GunId | null = null;
    if (me?.alive) {
      let best = PICKUP_RADIUS;
      for (const k of snap.pickups) {
        const d = Math.hypot(k.x - this.pred.x, k.y - this.pred.y);
        if (d < best) {
          best = d;
          nearPickup = k.gun;
        }
      }
    }
    const patch: Partial<HudState> = {
      me,
      players: [...snap.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths),
      phase: snap.phase,
      winner: snap.winner,
      endsIn: snap.endsIn,
      ping: Math.round(this.net.rtt),
      nearPickup,
      scoreboard: this.input.scoreboardHeld,
      bots: snap.players.filter((p) => p.bot).length,
    };
    if (this.botsWanted) {
      if (patch.bots === this.botsWanted.count || performance.now() - this.botsWanted.at > 1500) this.botsWanted = null;
      else patch.bots = this.botsWanted.count;
    }
    if (me?.alive && this.hud.get().killedBy) patch.killedBy = null;
    this.hud.set(patch);
  }
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
