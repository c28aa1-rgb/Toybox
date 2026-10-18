import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  ABILITY, CHAT_MAX, COSMETICS, GUNS, GUN_IDS, HEROES, PAINTS, type CosmeticKind, type KillFxId, type PaintId, type TrailId, MODES, TEAM_COLORS, PAD, THROW, UTILS, blinkTarget, grappleHit, grappleTravel, isUtilId, throwFlightTime, type Loadout, type ModeId, type PlayerProfile, type UtilId, type WeaponId, INTERP_DELAY, MAPS, MAX_HP, MAX_INPUT_DT, PICKUP_RADIUS, POWER, POWERS, pointInRect, stepMovement,
  type GameEvent, type GunId, type HeroId, type InputFrame, type MapDef, type MapId, type PlayerSnap, type PowerId,
  type Rect, type Snapshot,
} from '@gg/shared';
import { toon } from '../skins/toon';
import { createGunModel, createHeroSkin, createUtilModel, type HeroSkin } from '../skins/registry';
import { createHealModel } from '../skins/heal';
import { loadProfile, playerToken, setProfile } from '../unlocks';
import { Sfx } from './audio';
import { Particles, Rings, Shake, Shatter } from './fx';
import { Input } from './input';
import { smokeFog, type SmokeFog } from './smoke';
import { Net } from './net';
import { POWER_ICONS, PowerAuras, PowerDrops } from './powerFx';
import { Minimap } from './minimap';
import { createScene, PALETTE, type SceneBundle } from './scene';
import { HudStore, type HudState } from './store';

export interface JoinOptions {
  /** public: the always-on lobby. create: new private room on `map`. join: private room by `room` code. */
  mode: 'public' | 'create' | 'join';
  room?: string;
  map?: MapId;
  /** Private rooms only; the public lobby is always free-for-all. */
  gameMode?: ModeId;
  name: string;
  hero: HeroId;
  gun: GunId;
  secondary: GunId;
  utility: UtilId;
  paint: PaintId;
  trail: TrailId;
  killFx: KillFxId;
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
  laser: THREE.Mesh;
  laserGlow: THREE.Mesh;
  laserDot: THREE.Mesh;
  team: number;
  /** Grapple rope from the gun to the hook, shown while zipping. */
  rope: THREE.Mesh;
  hook: THREE.Mesh;
}

interface DamageNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  life: number;
}

const BULLET_COLORS: Record<GunId, string> = {
  pistol: PALETTE.lemon,
  minismg: '#7FCBFF',
  thumper: PALETTE.tangerine,
  bouncer: PALETTE.bubblegum,
  stinger: '#C6F25B',
  smg: PALETTE.sky,
  burst: '#7FF0D2',
  shotgun: '#FFB36B',
  sniper: PALETTE.mint,
  rocket: PALETTE.bubblegum,
};

const PAD_COLOR = '#4FB3FF';
/** Abilities you aim: holding the key shows where it will go, releasing fires it. */
const AIMED_ABILITIES = new Set<HeroId>(['blink', 'grapple']);
/** Hold the grenade key at least this long to throw a deployable instead of setting it down in front. */
const DEPLOY_HOLD_MS = 220;
const UTIL_COLORS: Record<UtilId, string> = { frag: PALETTE.mint, flash: PALETTE.lemon, smoke: '#B48CFF', pad: PAD_COLOR, juice: '#FF5F6D' };

const MAX_INTERP_DELAY = 0.25;

export function itemName(id: WeaponId): string {
  // Fall back to the id so an unknown item can never break the HUD.
  return (isUtilId(id) ? UTILS[id].name : GUNS[id]?.name) ?? String(id);
}

function itemColor(id: WeaponId): string {
  return isUtilId(id) ? UTIL_COLORS[id] : BULLET_COLORS[id];
}

const CAMERA_OFFSET = new THREE.Vector3(0, 18, 12);
/** Inside smoke you can still make out someone close enough to touch. */
const SMOKE_TOUCH_RANGE = 1.1;
/** Inputs go out at most this often; frames in between are batched into one message. */
const INPUT_SEND_MS = 15;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class GameClient {
  readonly hud: HudStore;
  private net: Net;
  private s: SceneBundle;
  private input: Input;
  private particles: Particles;
  private rings: Rings;
  private shatter: Shatter;
  private map: MapDef | null = null;
  private chatKey = 0;
  private bannerKey = 0;
  private scopeZoom = 0;
  private laserGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
  private laserGlowGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
  private laserDotGeo = new THREE.SphereGeometry(0.12, 12, 8);
  private throwViews = new Map<number, { obj: THREE.Object3D; born: number }>();
  private smokeViews = new Map<number, THREE.Group>();
  private padViews = new Map<number, {
    root: THREE.Object3D; model: THREE.Object3D; ringMat: THREE.MeshBasicMaterial; glowMat: THREE.MeshBasicMaterial;
    born: number; bounceAt: number; hp: number; hitAt: number;
  }>();
  /** A missed grapple: the rope flicks out and snaps back. */
  private missRopes: { rope: THREE.Mesh; born: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  /** Unit-length cord along +Z; stretched and turned to span two points. */
  private ropeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private hillView: THREE.Group | null = null;
  private streakKey = 0;
  private unlockKey = 0;
  /** When each player last dropped a trail puff. */
  private trailAt = new Map<string, number>();
  private trailHue = 0;
  private balloons: { group: THREE.Group; vy: number; sway: number; born: number }[] = [];
  /** Firework shells waiting to burst: when and where. */
  private fireworks: { at: number; x: number; y: number; z: number; colors: string[] }[] = [];
  /** True while this player stands inside a smoke cloud. */
  private meSmoked = false;
  private arcLine: THREE.Line;
  private arcRing: THREE.Mesh;
  /** Aim preview for Blink and Grapple while the ability key is held. */
  private abilityLine: THREE.Line;
  private abilityMark: THREE.Mesh;
  private reticle: HTMLDivElement;
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
  private bulletMeshes = new Map<number, THREE.Mesh>();
  private pickupViews = new Map<number, THREE.Group>();
  /** Sonar Ping: enemies our team can see through walls, until this clock time. */
  private sonarReveals = new Map<string, number>();
  private revealViews = new Map<string, THREE.Group>();
  /** Next time each overcharged player throws off sparks. */
  private sparkAt = new Map<string, number>();
  private chargedBulletMat = new THREE.MeshBasicMaterial({ color: '#FFFBE0' });
  private powerDrops: PowerDrops;
  private minimap: Minimap;
  private minimapAt = 0;
  private auras: PowerAuras;
  /** Screen-edge arrows pointing at power-ups that are off camera. */
  private powerMarkers = new Map<number, HTMLElement>();
  /** Who the camera follows while we are dead. */
  private spectateId: string | null = null;
  /** When the camera may move on from a spectated player who just went down. */
  private spectateWaitUntil = 0;
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
    this.shatter = new Shatter(this.s.scene);
    this.overlay = document.createElement('div');
    this.overlay.className = 'damage-layer';
    container.appendChild(this.overlay);
    this.powerDrops = new PowerDrops(this.s.world, {
      particles: this.particles, rings: this.rings, sfx: this.sfx,
      nearness: (x, y) => this.nearness(x, y),
      shake: (amount) => this.shake.add(amount),
      reducedMotion,
    });
    this.auras = new PowerAuras(this.s.world, this.particles);
    this.minimap = new Minimap(container);

    this.cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: PALETTE.lemon, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    (this.cursorRing.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.cursorRing.rotation.x = -Math.PI / 2;
    this.s.scene.add(this.cursorRing);

    // Throw preview: a dashed arc from the hand to where the throw will land.
    this.arcLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 32 }, () => new THREE.Vector3())),
      new THREE.LineDashedMaterial({ color: '#FFFFFF', dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0.9 }),
    );
    this.arcLine.visible = false;
    this.arcLine.frustumCulled = false;
    this.s.scene.add(this.arcLine);
    this.arcRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    (this.arcRing.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.arcRing.rotation.x = -Math.PI / 2;
    this.arcRing.visible = false;
    this.s.scene.add(this.arcRing);

    this.abilityLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: '#FFFFFF', dashSize: 0.4, gapSize: 0.22, transparent: true, opacity: 0.9 }),
    );
    this.abilityLine.visible = false;
    this.abilityLine.frustumCulled = false;
    this.s.scene.add(this.abilityLine);
    this.abilityMark = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.6, 32),
      new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    (this.abilityMark.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.abilityMark.rotation.x = -Math.PI / 2;
    this.abilityMark.visible = false;
    this.s.scene.add(this.abilityMark);

    // Scope reticle: follows the mouse, tightens while you hold the scope.
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.reticle.innerHTML = '<span class="reticle__ring"></span><span class="reticle__tick t"></span><span class="reticle__tick r"></span><span class="reticle__tick b"></span><span class="reticle__tick l"></span>';
    container.appendChild(this.reticle);

    for (const g of GUN_IDS) {
      const m = new THREE.MeshBasicMaterial({ color: BULLET_COLORS[g] });
      m.userData.outlineParameters = { visible: false };
      this.bulletMats.set(g, m);
    }

    this.hud = new HudStore({
      connected: false, error: null, room: opts.room ?? '', host: false, myId: null, me: null, players: [],
      phase: 'playing', winner: null, endsIn: 0, feed: [], ping: 0, fps: 0, killedBy: null, nearPickup: null,
      loadout: { hero: opts.hero, gun: opts.gun, secondary: opts.secondary, utility: opts.utility, paint: opts.paint, trail: opts.trail, killFx: opts.killFx }, blind: 0, smoke: [],
      mode: opts.gameMode ?? 'ffa', target: MODES[opts.gameMode ?? 'ffa'].target, teamScores: [0, 0], hill: null, streak: null, slowed: false, hurtTick: 0, toast: null, unlocks: [], bots: 0,
      isPublic: opts.mode === 'public', map: null, chat: [], chatOpen: false, banner: null, scoped: false, spectating: null,
      reconnecting: false, vote: null, myVote: null,
    });

    this.net = new Net({
      onWelcome: (id, room, host, map, mode, isPublic) => {
        this.myId = id;
        this.welcomed = true;
        this.rejoin = { mode: isPublic ? 'public' : 'join', room };
        this.useMap(map);
        this.hud.set({ connected: true, reconnecting: false, myId: id, room, host, map, mode, isPublic });
        // Private rooms keep their code in the URL so it can be shared; the public lobby doesn't.
        const url = new URL(location.href);
        if (isPublic) url.searchParams.delete('room');
        else url.searchParams.set('room', room);
        history.replaceState(null, '', url);
      },
      onChat: (id, name, text) => {
        const line = { key: ++this.chatKey, name: id ? name : null, text, mine: id === this.myId, at: performance.now() };
        this.hud.set({ chat: [...this.hud.get().chat, line].slice(-8) });
      },
      onProfile: (profile: PlayerProfile) => {
        const oldUnlocks = new Set(loadProfile().unlocks);
        setProfile(profile);
        // New cosmetics from this kill: queue an unlock card for each.
        const fresh = profile.unlocks.filter((key) => !oldUnlocks.has(key)).flatMap((key) => {
          const [kind, id] = key.split(':') as [CosmeticKind, string];
          const def = COSMETICS[kind]?.[id];
          return def && def.unlockKills > 0 ? [{ key: ++this.unlockKey, kind, id, name: def.name }] : [];
        });
        if (fresh.length) {
          this.hud.set({ unlocks: [...this.hud.get().unlocks, ...fresh] });
          this.sfx.unlock();
        }
      },
      onSnapshot: (snap) => this.onSnapshot(snap),
      onError: (message) => {
        // An error before we're in a room (auth, room full, bad code) means retrying won't help.
        if (!this.welcomed) this.net.stop();
        this.hud.set({ error: message });
      },
      onOpen: () => {
        this.welcomed = false;
        void this.sendJoin();
      },
      onReconnecting: () => {
        this.pending = [];
        this.outbox = [];
        this.hud.set({ connected: false, reconnecting: true });
      },
      resumeJoin: async () => {
        if (!this.welcomed || !this.rejoin) return null;
        const o = this.opts;
        return {
          type: 'join', ...this.rejoin, resume: true, idToken: await playerToken(), name: o.name,
          hero: o.hero, gun: o.gun, secondary: o.secondary, utility: o.utility, paint: o.paint, trail: o.trail, killFx: o.killFx,
        };
      },
      onClose: () => this.hud.set({ connected: false, reconnecting: false, error: this.hud.get().error ?? 'Disconnected from the server.' }),
    });

    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __gg: GameClient }).__gg = this;
  }

  /** Join on first connect; after a reconnect, go back to the same room so the server can restore our score. */
  private async sendJoin(): Promise<void> {
    const o = this.opts;
    const where = this.rejoin ?? { mode: o.mode, room: o.room };
    try {
      this.net.send({
        type: 'join', ...where, map: o.map, gameMode: o.gameMode, idToken: await playerToken(), name: o.name,
        hero: o.hero, gun: o.gun, secondary: o.secondary, utility: o.utility, paint: o.paint, trail: o.trail, killFx: o.killFx,
      });
    } catch {
      this.net.stop();
      this.hud.set({ error: 'Sign in to connect to the game server.' });
    }
  }

  /** Where to rejoin after a dropped connection, set once the server has welcomed us. */
  private rejoin: { mode: JoinOptions['mode']; room: string } | null = null;
  /** The current connection has been let into a room. */
  private welcomed = false;

  /** Load a map: on join, and when the public lobby moves to the next map. */
  private useMap(id: MapId): void {
    if (this.map?.id === id) return;
    this.map = MAPS[id];
    this.s.setMap(this.map);
    this.minimap.setMap(this.map);
    this.hud.set({ map: id });
  }

  /** Public lobby, results screen: vote for the next map. */
  voteMap(map: MapId): void {
    this.net.send({ type: 'vote', map });
    this.hud.set({ myVote: map });
  }

  /** Debug view of prediction state, used by browser tests. */
  debug(): { pred: { x: number; y: number }; server: { x: number; y: number } | null; pending: number } {
    const me = this.latest?.players.find((p) => p.id === this.myId);
    return { pred: { ...this.pred }, server: me ? { x: me.x, y: me.y } : null, pending: this.pending.length };
  }

  // ---------- public controls ----------

  reload(): void { this.input.reload(); }
  setMenuOpen(open: boolean): void { this.input.setBlocked(open); }
  swapWeapon(): void { this.input.swapWeapon(); }

  setLoadout(l: Loadout): void {
    this.net.send({ type: 'loadout', ...l });
    this.hud.set({ loadout: l });
  }

  sendChat(text: string): void {
    const t = text.trim().slice(0, CHAT_MAX);
    if (t) this.net.send({ type: 'chat', text: t });
  }

  /** Opening chat releases held keys so the player doesn't keep running while typing. */
  setChatOpen(open: boolean): void {
    if (open) this.input.clear();
    this.hud.set({ chatOpen: open });
  }

  /** While dead, watch the next (1) or previous (-1) player who is still alive. */
  spectate(dir: 1 | -1): void {
    const alive = (this.latest?.players ?? []).filter((p) => p.alive && p.id !== this.myId);
    if (!alive.length) return;
    const i = alive.findIndex((p) => p.id === this.spectateId);
    const next = i < 0 ? (dir > 0 ? 0 : alive.length - 1) : (i + dir + alive.length) % alive.length;
    this.spectateId = alive[next].id;
    this.spectateWaitUntil = 0;
    this.pushHud(this.latest, this.latest?.players.find((p) => p.id === this.myId) ?? null);
  }

  /** The HUD finished showing an unlock card. */
  dismissUnlock(key: number): void {
    this.hud.set({ unlocks: this.hud.get().unlocks.filter((u) => u.key !== key) });
  }

  /** Ask to come back once the respawn timer is done. Stays queued until the server spawns us. */
  respawn(): void {
    this.respawnQueued = true;
  }

  private respawnQueued = false;

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
    this.powerDrops.dispose();
    this.auras.dispose();
    this.minimap.dispose();
    this.overlay.remove();
    this.reticle.remove();
    this.s.dispose();
  }

  // ---------- networking ----------

  /** Same slow rule as the server, so prediction doesn't rubber-band after a Stinger hit. */
  private isSlowed(me: PlayerSnap): boolean {
    return me.slowIn > 0;
  }

  private mapWalls(): Rect[] {
    return this.map?.walls ?? [];
  }

  /** Recent gaps between snapshot arrivals; the interpolation buffer has to be at least as long as the worst one. */
  private snapGaps: Array<{ at: number; gap: number }> = [];
  private lastSnapAt = 0;
  private interpDelay: number = INTERP_DELAY;

  private onSnapshot(snap: Snapshot): void {
    const arrived = performance.now();
    if (this.lastSnapAt) this.snapGaps.push({ at: arrived, gap: (arrived - this.lastSnapAt) / 1000 });
    this.lastSnapAt = arrived;
    while (this.snapGaps.length && arrived - this.snapGaps[0].at > 3000) this.snapGaps.shift();
    this.useMap(snap.map);
    this.latest = snap;
    this.snaps.push(snap);
    while (this.snaps.length > 2 && this.snaps[1].time < snap.time - 1) this.snaps.shift();
    for (const ev of snap.events) this.eventQueue.push({ time: snap.time, ev });

    const me = snap.players.find((p) => p.id === this.myId);
    if (!me) return;
    // Dead, between rounds, or being moved by a grapple or a pad: take the server's position as is.
    if (!me.alive || snap.phase !== 'playing' || me.dash) {
      this.pending = [];
      this.pred = { x: me.x, y: me.y };
      this.predOffset.set(0, 0);
      return;
    }
    const before = { ...this.pred };
    this.pending = this.pending.filter((f) => f.seq > snap.ack);
    this.pred = { x: me.x, y: me.y };
    const walls = this.mapWalls();
    for (const f of this.pending) stepMovement(this.pred, f.mx, f.my, f.dt, walls, f.scope, this.isSlowed(me), boost(me));
    const ex = before.x - this.pred.x;
    const ey = before.y - this.pred.y;
    if (Math.hypot(ex, ey) > 2) this.predOffset.set(0, 0);
    else this.predOffset.set(this.predOffset.x + ex, this.predOffset.y + ey);
  }

  // ---------- frame ----------

  private fps = 0;
  private fpsFrames = 0;
  private fpsAt = 0;

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const rawDt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fpsFrames++;
    if (now - this.fpsAt >= 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsAt));
      this.fpsFrames = 0;
      this.fpsAt = now;
    }
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
    // A stalled server or a jittery link makes snapshots bunch up. If the buffer runs dry, other
    // players freeze and then jump; so widen it to cover the recent worst gap, and tighten slowly.
    const worstGap = this.snapGaps.reduce((m, g) => Math.max(m, g.gap), 0);
    const wanted = Math.min(MAX_INTERP_DELAY, Math.max(INTERP_DELAY, worstGap + 0.03));
    this.interpDelay += Math.max(-0.02 * rawDt, Math.min(0.3 * rawDt, wanted - this.interpDelay));
    const renderTime = this.net.serverNow() - this.interpDelay - this.extraDelay;
    this.flushEvents(renderTime);

    if (snap) {
      this.renderPlayers(renderTime, dt, snap);
      this.renderBullets(renderTime);
      this.renderPickups(snap, dt);
      this.powerDrops.update(snap, this.clock, dt);
      this.renderThrowables(renderTime, dt);
      this.renderSmokes(snap);
      this.renderPads(snap);
      this.updateMissRopes();
      this.renderHill(snap);
    }

    this.particles.update(dt);
    this.rings.update(dt);
    this.shatter.update(dt);
    this.updateKillFx(dt);
    if (snap && me) this.updateSpectate(snap, me);
    this.updateCamera(rawDt, me);
    this.updateDamageNumbers(rawDt);
    this.updatePowerMarkers(snap);
    if (snap && now - this.minimapAt > 50) {
      this.minimapAt = now;
      this.drawMinimap(snap, me);
    }

    this.s.outline.render(this.s.scene, this.s.camera);
    // Name tags sit above the HUD, so standing in smoke has to hide the whole layer.
    this.s.labels.domElement.style.visibility = this.meSmoked || snap?.phase === 'ended' ? 'hidden' : '';
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
    const scoping = this.isScoping();
    this.reticle.style.transform = `translate(${this.input.mouseX}px, ${this.input.mouseY}px)`;
    this.reticle.classList.toggle('is-on', scoping);
  }

  /** Scope held, alive and not typing. Hide and Seek players can't scope while invisible. */
  private isScoping(): boolean {
    const me = this.latest?.players.find((p) => p.id === this.myId);
    return !!me?.alive && !me.hidden && this.input.scopeHeld && !this.hud.get().chatOpen;
  }

  private sendInput(dt: number, me: PlayerSnap, snap: Snapshot): void {
    const px = this.pred.x;
    const py = this.pred.y;
    this.aim = Math.atan2(this.aimPoint.z - py, this.aimPoint.x - px);
    const aimDist = Math.hypot(this.aimPoint.x - px, this.aimPoint.z - py);
    const typing = this.hud.get().chatOpen;
    const { mx, my } = typing ? { mx: 0, my: 0 } : this.input.move();
    const frame: InputFrame = {
      seq: ++this.seq,
      dt: Math.min(dt, MAX_INPUT_DT),
      mx, my,
      aim: this.aim,
      aimDist,
      fire: !typing && this.input.fireHeld,
      scope: !typing && this.isScoping(),
      // Aimed abilities fire on release, after the preview; the rest fire on press.
      ability: !typing && (AIMED_ABILITIES.has(me.hero) ? this.input.takeAbilityRelease() : this.input.takeAbility()),
      pickup: !typing && this.input.takePickup(),
      reload: !typing && this.input.takeReload(),
      slot: 0,
      throw: false,
      respawn: this.respawnQueued,
    };
    // Drinkables fire on key down. Deployables: a tap sets it down in front, a hold throws it on an arc.
    // Throwables wait for release so you can aim the arc.
    const util = UTILS[me.utility];
    if (!typing && util.heal) frame.throw = this.input.takeThrowPress();
    else if (!typing && util.deploy) {
      const held = this.input.takeThrowRelease();
      if (held !== null) {
        frame.throw = true;
        frame.place = held < DEPLOY_HOLD_MS;
      }
    } else if (!typing) frame.throw = this.input.takeThrow();
    if (me.alive) this.respawnQueued = false;
    const want = typing ? null : this.input.takeSlot();
    if (want === 'toggle') frame.slot = me.slot === 'primary' ? 2 : 1;
    else if (want) frame.slot = want;
    this.updateThrowPreview(me, aimDist);
    this.updateAbilityPreview(me, aimDist, typing);
    if (me.alive && snap.phase === 'playing' && !me.dash) {
      stepMovement(this.pred, mx, my, frame.dt, this.mapWalls(), frame.scope, this.isSlowed(me), boost(me));
      this.pending.push(frame);
      if (this.pending.length > 120) this.pending.shift();
    }
    // High refresh displays make a frame every 4-8 ms; batch them so the server sees ~60 messages/s.
    this.outbox.push(frame);
    const now = performance.now();
    if (now - this.outboxAt >= INPUT_SEND_MS || frame.ability || frame.throw || frame.pickup || frame.respawn) {
      this.net.send({ type: 'input', frames: this.outbox });
      this.outbox = [];
      this.outboxAt = now;
    }
  }

  /** Input frames waiting for the next send. */
  private outbox: InputFrame[] = [];
  private outboxAt = 0;

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
      view.skin.setPaint(p.paint ?? 'classic');
      if (view.team !== p.team) {
        // Team Brawl tints name tags and lasers by team so friend and foe read at a glance.
        view.team = p.team;
        const color = p.team >= 0 ? TEAM_COLORS[p.team] : HEROES[p.hero].color;
        view.nameEl.style.setProperty('--hero', color);
        view.label.element.classList.toggle('nametag--team', p.team >= 0);
        for (const m of [view.laser, view.laserGlow]) (m.material as THREE.MeshBasicMaterial).color.set(color);
      }
      let x: number;
      let y: number;
      let aim: number;
      let alive: boolean;
      let shield = p.shield;
      let scoped = p.scoped;
      let z = 0;
      let dash = p.dash;
      // Mid-grapple or mid-launch the server moves us, so our own player is drawn like everyone else's.
      if (p.id === this.myId && p.alive && snap.phase === 'playing' && !p.dash) {
        scoped = this.isScoping();
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
        z = (pa.z ?? 0) + ((pb.z ?? 0) - (pa.z ?? 0)) * k;
        dash = pb.dash;
        alive = pb.alive;
        shield = pb.shield;
        scoped = pb.scoped;
        if (p.id === this.myId) {
          aim = this.aim;
          // Keep prediction (and the camera) with us so landing doesn't snap.
          this.pred = { x, y };
          this.predOffset.set(0, 0);
        }
      } else {
        x = p.x;
        y = p.y;
        aim = p.aim;
        alive = p.alive;
      }
      const smoked = inSmoke(snap, x, y);
      if (p.id === this.myId) this.meSmoked = alive && smoked;
      const moved = Number.isNaN(view.lastX) ? 0 : Math.hypot(x - view.lastX, y - view.lastY);
      const look = alive ? this.hiddenLook(p, x, y, snap) : 'normal';
      this.placeView(view, x, y, aim, alive, dt, p.gun, shield, look);
      view.skin.root.position.y = z;
      this.updateRope(view, x, y, z, alive && look !== 'gone' ? dash : null);
      const visible = alive && look !== 'gone' && look !== 'shimmer';
      this.auras.update(p.id, x, y, visible && !smoked && view.skin.root.visible, p.powers ?? {}, moved, this.clock);
      if (visible && !smoked && view.skin.root.visible) this.emitTrail(p.id, p.trail ?? 'none', p.paint ?? 'classic', x, y, z, moved, dt);
      this.updateLaser(view, x, y, aim, alive && scoped, p.gun, p.id === this.myId);
      this.updateLabel(view, p.hp, visible && !smoked);
      this.updateReveal(p.id, x, y, alive);
      if (visible && p.overcharge > 0 && this.clock >= (this.sparkAt.get(p.id) ?? 0)) {
        // Overcharged guns crackle until the charged shots are spent.
        this.sparkAt.set(p.id, this.clock + 0.07);
        this.particles.burst({
          x: x + Math.cos(aim) * 0.85, y: y + Math.sin(aim) * 0.85, z: 0.8, count: 2,
          color: [PALETTE.lemon, '#FFFFFF'], speed: 2.5, up: 1.5, life: 0.2, size: 0.09, gravity: 0,
        });
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.removeView(view);
        this.views.delete(id);
      }
    }
    this.auras.prune(seen);
    for (const [id, g] of this.revealViews) {
      if (seen.has(id)) continue;
      g.removeFromParent();
      this.revealViews.delete(id);
    }
  }

  /**
   * Cosmetic trail while running, plus the gold paint's sparkle. Puffs are rate-limited per player
   * and only drop while actually moving.
   */
  private emitTrail(id: string, trail: TrailId, paint: PaintId, x: number, y: number, z: number, moved: number, dt: number): void {
    if (paint === 'gold' && Math.random() < dt * 3) {
      this.particles.burst({ x: x + (Math.random() - 0.5) * 0.8, y: y + (Math.random() - 0.5) * 0.8, z: 0.6 + Math.random() * 0.8 + z, count: 1, color: ['#FFF6C2', '#FFFFFF'], speed: 0.2, up: 0.4, life: 0.5, size: 0.09, gravity: 0 });
    }
    if (trail === 'none' || dt <= 0 || moved / dt < 1.5) return;
    if (this.clock < (this.trailAt.get(id) ?? 0)) return;
    this.trailAt.set(id, this.clock + (trail === 'rainbow' ? 0.03 : 0.06));
    const fx = { x, y, z: 0.15 + z };
    switch (trail) {
      case 'sparkle':
        this.particles.burst({ ...fx, z: fx.z + 0.3, count: 2, color: ['#FFFFFF', PALETTE.lemon], speed: 0.6, up: 1.2, life: 0.45, size: 0.09, gravity: 1 });
        break;
      case 'bubbles':
        this.particles.burst({ ...fx, count: 1, color: ['#BFE6FF', '#E8F6FF'], speed: 0.3, up: 1.2, life: 1.0, size: 0.16, gravity: -0.6 });
        break;
      case 'confetti':
        this.particles.burst({ ...fx, z: fx.z + 0.4, count: 3, color: [PALETTE.bubblegum, PALETTE.lemon, PALETTE.mint, PALETTE.sky, PALETTE.tangerine], speed: 1.2, up: 1.6, life: 0.7, size: 0.1, gravity: 4 });
        break;
      case 'rainbow': {
        this.trailHue = (this.trailHue + 0.04) % 1;
        const c = new THREE.Color().setHSL(this.trailHue, 0.85, 0.62);
        this.particles.burst({ ...fx, count: 1, color: ['#' + c.getHexString()], speed: 0.05, up: 0.05, life: 0.7, size: 0.2, gravity: 0 });
        break;
      }
    }
  }

  /** The killer's kill effect, played on top of the plastic shatter everyone gets. */
  private playKillFx(fx: KillFxId, x: number, y: number): void {
    const party = [PALETTE.bubblegum, PALETTE.lemon, PALETTE.mint, PALETTE.sky, PALETTE.tangerine, '#FFFFFF'];
    const near = this.nearness(x, y);
    switch (fx) {
      case 'shatter':
        return;
      case 'confetti':
        this.particles.burst({ x, y, z: 1, count: 70, color: party, speed: 7, up: 9, life: 1.4, size: 0.14, gravity: 7 });
        if (near > 0.2) this.sfx.partyHorn(near);
        return;
      case 'squeak':
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          this.particles.burst({ x: x + Math.cos(a) * 0.4, y: y + Math.sin(a) * 0.4, z: 1.2, count: 2, color: [PALETTE.lemon, '#FFFFFF'], speed: 4, up: 2, life: 0.6, size: 0.16, gravity: 2, dir: a, cone: 0.3 });
        }
        this.rings.spawn(x, y, 2.4, PALETTE.lemon, 0.35);
        if (near > 0.1) this.sfx.squeak(near);
        return;
      case 'balloons':
        for (let i = 0; i < 5; i++) {
          const g = new THREE.Group();
          const color = party[i % 5];
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), toon(color));
          ball.scale.set(1, 1.2, 1);
          ball.position.y = 0.6;
          const string = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), toon('#FFFFFF'));
          string.position.y = 0.1;
          g.add(ball, string);
          g.position.set(x + (Math.random() - 0.5) * 0.9, 0.6, y + (Math.random() - 0.5) * 0.9);
          this.s.world.add(g);
          this.balloons.push({ group: g, vy: 1.6 + Math.random() * 0.8, sway: Math.random() * 6, born: this.clock });
        }
        if (near > 0.2) this.sfx.pop();
        return;
      case 'fireworks':
        for (let i = 0; i < 3; i++) {
          this.fireworks.push({ at: this.clock + 0.35 + i * 0.22, x: x + (Math.random() - 0.5) * 2, y: y + (Math.random() - 0.5) * 2, z: 4 + Math.random() * 1.5, colors: [party[i % 6], party[(i + 2) % 6], '#FFFFFF'] });
          this.particles.burst({ x, y, z: 0.8, count: 4, color: ['#FFE9A0', '#FFFFFF'], speed: 0.4, up: 9, life: 0.4, size: 0.1, gravity: 0 });
        }
        if (near > 0.2) this.sfx.whistle(near);
        return;
    }
  }

  private updateKillFx(dt: number): void {
    this.balloons = this.balloons.filter((b) => {
      const age = this.clock - b.born;
      b.group.position.y += b.vy * dt;
      b.group.position.x += Math.sin(this.clock * 2 + b.sway) * dt * 0.4;
      if (age > 3) {
        b.group.removeFromParent();
        return false;
      }
      return true;
    });
    this.fireworks = this.fireworks.filter((f) => {
      if (this.clock < f.at) return true;
      this.particles.burst({ x: f.x, y: f.y, z: f.z, count: 40, color: f.colors, speed: 6, up: 2, life: 1.1, size: 0.13, gravity: 3 });
      if (this.nearness(f.x, f.y) > 0.2) this.sfx.fireworkPop(this.nearness(f.x, f.y));
      return false;
    });
  }

  /** You, or a teammate in Team Brawl. */
  private isAlly(id: string): boolean {
    if (id === this.myId) return true;
    const players = this.latest?.players ?? [];
    const me = players.find((p) => p.id === this.myId);
    const other = players.find((p) => p.id === id);
    return !!me && !!other && me.team >= 0 && me.team === other.team;
  }

  /**
   * How a Hide and Seek player looks to us: allies and sonar-revealed enemies see a ghost, enemies
   * see nothing, except a faint flickering shimmer when they're very close.
   */
  private hiddenLook(p: PlayerSnap, x: number, y: number, snap: Snapshot): 'normal' | 'ghost' | 'shimmer' | 'gone' {
    if (p.id === this.myId) return p.hidden ? 'ghost' : 'normal';
    const seenThrough = this.isAlly(p.id) || (this.sonarReveals.get(p.id) ?? 0) > this.clock;
    if (!seenThrough && this.smokeBlocks(snap, x, y)) return 'gone';
    if (!p.hidden) return 'normal';
    if (seenThrough) return 'ghost';
    const d = Math.hypot(x - this.pred.x, y - this.pred.y);
    return d < ABILITY.hiddenSpotRange ? 'shimmer' : 'gone';
  }

  /**
   * Smoke blocks sight completely: someone is hidden from us when the line from our eyes to them
   * crosses a cloud, which covers them standing in it, us standing in it, and smoke in between.
   * Only arm's reach (about a metre) cuts through.
   */
  private smokeBlocks(snap: Snapshot, x: number, y: number): boolean {
    const me = this.latest?.players.find((p) => p.id === this.myId);
    const ex = me?.alive ? this.pred.x + this.predOffset.x : this.camTarget.x;
    const ey = me?.alive ? this.pred.y + this.predOffset.y : this.camTarget.z;
    const dx = x - ex;
    const dy = y - ey;
    const len2 = dx * dx + dy * dy;
    if (len2 < SMOKE_TOUCH_RANGE ** 2) return false;
    return snap.smokes.some((sm) => {
      if (sm.endsIn <= 0.2) return false;
      // Closest point on the segment to the cloud centre.
      const t = Math.max(0, Math.min(1, ((sm.x - ex) * dx + (sm.y - ey) * dy) / len2));
      const cx = ex + dx * t - sm.x;
      const cy = ey + dy * t - sm.y;
      return cx * cx + cy * cy < (sm.r * 0.92) ** 2;
    });
  }

  /** Sonar marks: a ring and a pointer above the target, drawn through walls while the reveal lasts. */
  private updateReveal(id: string, x: number, y: number, alive: boolean): void {
    const until = this.sonarReveals.get(id) ?? 0;
    const on = alive && until > this.clock;
    let g = this.revealViews.get(id);
    if (!on) {
      if (g) g.visible = false;
      if (until && until <= this.clock) this.sonarReveals.delete(id);
      return;
    }
    if (!g) {
      g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#FF4D6A', transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      mat.userData.outlineParameters = { visible: false };
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), mat);
      pointer.rotation.x = Math.PI;
      pointer.position.y = 2.9;
      pointer.name = 'pointer';
      g.add(ring, pointer);
      g.renderOrder = 10;
      g.traverse((o) => (o.renderOrder = 10));
      this.s.world.add(g);
      this.revealViews.set(id, g);
    }
    g.visible = true;
    g.position.set(x, 0, y);
    g.getObjectByName('pointer')!.position.y = 2.9 + Math.sin(this.clock * 6) * 0.15;
    // Fade out over the last half second.
    const mat = (g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.opacity = Math.min(1, (until - this.clock) / 0.5) * (0.75 + Math.sin(this.clock * 10) * 0.25);
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
    // Scope sights are visible only to their owner.
    const laser = new THREE.Mesh(
      this.laserGeo,
      new THREE.MeshBasicMaterial({ color: HEROES[hero].color, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    (laser.material as THREE.Material).userData.outlineParameters = { visible: false };
    laser.visible = false;
    this.s.world.add(laser);
    const laserGlow = new THREE.Mesh(
      this.laserGlowGeo,
      new THREE.MeshBasicMaterial({ color: HEROES[hero].color, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    (laserGlow.material as THREE.Material).userData.outlineParameters = { visible: false };
    laserGlow.visible = false;
    this.s.world.add(laserGlow);
    const laserDot = new THREE.Mesh(
      this.laserDotGeo,
      new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    (laserDot.material as THREE.Material).userData.outlineParameters = { visible: false };
    laserDot.visible = false;
    this.s.world.add(laserDot);
    const rope = new THREE.Mesh(this.ropeGeo, toon('#5B2A86'));
    rope.visible = false;
    this.s.world.add(rope);
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 8), toon('#C9CED6'));
    hook.visible = false;
    this.s.world.add(hook);
    return { skin, hero, label, nameEl, hpEl, lastX: NaN, lastY: NaN, lastHp: MAX_HP, laser, laserGlow, laserDot, team: -1, rope, hook };
  }

  private removeView(view: PlayerView): void {
    for (const m of [view.laser, view.laserGlow, view.laserDot]) {
      m.removeFromParent();
      (m.material as THREE.Material).dispose();
    }
    view.rope.removeFromParent();
    view.hook.removeFromParent();
    view.label.element.remove();
    view.skin.root.removeFromParent();
    view.skin.dispose();
  }

  private placeView(
    view: PlayerView, x: number, y: number, aim: number, alive: boolean, dt: number, gun: GunId, shield: boolean,
    look: 'normal' | 'ghost' | 'shimmer' | 'gone' = 'normal',
  ): void {
    const dx = Number.isNaN(view.lastX) ? 0 : x - view.lastX;
    const dy = Number.isNaN(view.lastY) ? 0 : y - view.lastY;
    const moved = Math.hypot(dx, dy);
    view.lastX = x;
    view.lastY = y;
    const root = view.skin.root;
    // A shimmering hidden player only shows on some frames, like a heat haze.
    root.visible = alive && look !== 'gone' && (look !== 'shimmer' || Math.floor(this.clock * 14) % 3 === 0);
    root.position.set(x, 0, y);
    // Models face +Z; sim angle 0 points along +X.
    root.rotation.y = Math.PI / 2 - aim;
    view.skin.setGun(gun);
    view.skin.setGhost(look !== 'normal' || (shield && Math.floor(this.clock * 8) % 2 === 0));
    const speed = dt > 0 ? moved / dt : 0;
    // Movement direction in the model's own frame (+Z forward, +X the character's left).
    const len = moved || 1;
    const localX = (dx * Math.sin(aim) - dy * Math.cos(aim)) / len;
    const localZ = (dx * Math.cos(aim) + dy * Math.sin(aim)) / len;
    const stepped = view.skin.animate(dt, Math.min(1, speed / 6), localX, localZ);
    // Hidden players leave no footstep puffs.
    if (stepped && alive && look === 'normal' && moved < 1) {
      this.particles.burst({ x, y, z: 0.08, count: 3, color: ['#8F78B8', '#B9A6D9'], speed: 1.2, up: 0.8, life: 0.35, size: 0.12, gravity: 3 });
    }
  }

  /**
   * While an aimed ability's key is held: a dashed line and a ring showing exactly what will happen,
   * using the same targeting code as the server. Grey when it would miss or isn't ready.
   */
  private updateAbilityPreview(me: PlayerSnap, aimDist: number, typing: boolean): void {
    const show = !typing && this.input.abilityHeld && AIMED_ABILITIES.has(me.hero) && me.alive && !me.dash && !!this.map;
    this.abilityLine.visible = show;
    this.abilityMark.visible = show;
    if (!show || !this.map) return;
    const x0 = this.pred.x;
    const y0 = this.pred.y;
    let tx: number;
    let ty: number;
    let good: boolean;
    if (me.hero === 'grapple') {
      const hit = grappleHit(this.mapWalls(), x0, y0, this.aim);
      const reach = hit < 0 ? ABILITY.grappleRange : hit;
      tx = x0 + Math.cos(this.aim) * reach;
      ty = y0 + Math.sin(this.aim) * reach;
      good = hit >= 0 && grappleTravel(hit) > 0;
    } else {
      ({ x: tx, y: ty } = blinkTarget(this.map, x0, y0, this.aim, aimDist));
      good = Math.hypot(tx - x0, ty - y0) > 0.5;
    }
    const ready = me.abilityReadyIn <= 0.05;
    const color = good && ready ? HEROES[me.hero].color : '#8A8296';
    const pos = this.abilityLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, x0, 0.8, y0);
    pos.setXYZ(1, tx, 0.8, ty);
    pos.needsUpdate = true;
    this.abilityLine.computeLineDistances();
    const lineMat = this.abilityLine.material as THREE.LineDashedMaterial;
    lineMat.color.set(color);
    lineMat.opacity = ready ? 0.95 : 0.4;
    const markMat = this.abilityMark.material as THREE.MeshBasicMaterial;
    markMat.color.set(color);
    markMat.opacity = ready ? 0.85 : 0.35;
    // Grapple marks the wall at hook height; Blink marks the floor where you'll stand.
    this.abilityMark.position.set(tx, me.hero === 'grapple' ? 0.8 : 0.06, ty);
    this.abilityMark.rotation.set(me.hero === 'grapple' ? 0 : -Math.PI / 2, me.hero === 'grapple' ? Math.PI / 2 - this.aim : 0, 0);
    this.abilityMark.scale.setScalar(good ? 1 + Math.sin(this.clock * 8) * 0.08 : 0.6);
    this.cursorRing.visible = false;
  }

  /** Dashed arc preview while G is held, using the same flight curve the server simulates. */
  private updateThrowPreview(me: PlayerSnap, aimDist: number): void {
    const util = UTILS[me.utility];
    // A deployable only shows the arc once the hold is long enough to mean "throw"; a tap just sets it down.
    const aiming = util.deploy ? this.input.throwHoldMs >= DEPLOY_HOLD_MS : !util.heal;
    const show = this.input.throwHeld && aiming && me.alive && me.utilCharges > 0 && !this.hud.get().chatOpen;
    this.arcLine.visible = show;
    this.arcRing.visible = show;
    this.cursorRing.visible = !show && !this.input.scopeHeld;
    if (!show) return;
    const dist = Math.min(THROW.maxDistance, Math.max(THROW.minDistance, aimDist));
    const T = throwFlightTime(dist);
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    const x0 = this.pred.x + dx * 0.7;
    const y0 = this.pred.y + dy * 0.7;
    const speed = (dist - 0.7) / T;
    const vz = ((THROW.gravity * T * T) / 2 - THROW.releaseHeight) / T;
    const pos = this.arcLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = (T * i) / (pos.count - 1);
      pos.setXYZ(i, x0 + dx * speed * t, Math.max(0.05, THROW.releaseHeight + vz * t - (THROW.gravity * t * t) / 2), y0 + dy * speed * t);
    }
    pos.needsUpdate = true;
    this.arcLine.computeLineDistances();
    const color = UTIL_COLORS[me.utility];
    (this.arcLine.material as THREE.LineDashedMaterial).color.set(color);
    (this.arcRing.material as THREE.MeshBasicMaterial).color.set(color);
    const lx = x0 + dx * speed * T;
    const ly = y0 + dy * speed * T;
    this.arcRing.position.set(lx, 0.06, ly);
    const r = UTILS[me.utility].radius;
    this.arcRing.scale.setScalar(me.utility === 'flash' ? 1.2 : r);
  }

  /** Laser from the gun along the aim, stopped by walls. */
  private updateLaser(view: PlayerView, x: number, y: number, aim: number, on: boolean, gun: GunId, mine: boolean): void {
    on = on && mine;
    view.laser.visible = on;
    view.laserGlow.visible = on;
    view.laserDot.visible = on;
    if (!on) return;
    const max = Math.min(GUNS[gun].range, Math.hypot(this.aimPoint.x - x, this.aimPoint.z - y));
    const walls = this.mapWalls();
    const dx = Math.cos(aim);
    const dy = Math.sin(aim);
    let len = 0.9;
    while (len < max && !walls.some((w) => pointInRect(x + dx * len, y + dy * len, w))) len += 0.25;
    const start = 0.9;
    const mid = (start + len) / 2;
    view.laser.position.set(x + dx * mid, 0.75, y + dy * mid);
    view.laser.rotation.y = Math.PI / 2 - aim;
    view.laser.scale.set(1, 1, Math.max(0.01, len - start));
    // A soft glow sheath that breathes, and a bright dot where the beam stops.
    view.laserGlow.position.copy(view.laser.position);
    view.laserGlow.rotation.copy(view.laser.rotation);
    view.laserGlow.scale.set(1 + Math.sin(this.clock * 9) * 0.15, 1, Math.max(0.01, len - start));
    view.laserDot.position.set(x + dx * len, 0.75, y + dy * len);
    view.laserDot.scale.setScalar(0.8 + Math.sin(this.clock * 14) * 0.25);
  }

  private updateLabel(view: PlayerView, hp: number, alive: boolean): void {
    // CSS2DRenderer rewrites style.display every frame from `visible`, so toggle that instead.
    view.label.visible = alive;
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
        m = new THREE.Mesh(this.bulletGeo, b.charged ? this.chargedBulletMat : this.bulletMats.get(b.gun)!);
        const big = (b.gun === 'rocket' ? 2.2 : b.gun === 'sniper' ? 1.1 : 1) * (b.charged ? 1.7 : 1);
        m.scale.setScalar(big);
        m.userData.big = big;
        this.s.scene.add(m);
        this.bulletMeshes.set(b.id, m);
      }
      if (a) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        m.rotation.y = -ang;
        const stretch = b.gun === 'sniper' ? 4 : b.gun === 'rocket' ? 1.3 : 2.2;
        m.scale.x = stretch * (m.userData.big as number);
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

  private renderThrowables(renderTime: number, dt: number): void {
    const br = this.bracket(renderTime);
    if (!br) return;
    const seen = new Set<number>();
    for (const g of br.b.throwables) {
      const a = br.a.throwables.find((o) => o.id === g.id) ?? g;
      seen.add(g.id);
      let v = this.throwViews.get(g.id);
      if (!v) {
        const obj = createUtilModel(g.util);
        obj.scale.setScalar(1.3);
        this.s.world.add(obj);
        v = { obj, born: this.clock };
        this.throwViews.set(g.id, v);
      }
      const x = a.x + (g.x - a.x) * br.k;
      const y = a.y + (g.y - a.y) * br.k;
      const z = a.z + (g.z - a.z) * br.k;
      v.obj.position.set(x, z, y);
      // Tumble while airborne; settle once it rests on the floor.
      if (z > 0.02) {
        v.obj.rotation.x += dt * 9;
        v.obj.rotation.z += dt * 5;
        if (Math.random() < 0.5) {
          this.particles.burst({ x, y, z: z + 0.1, count: 1, color: [UTIL_COLORS[g.util], '#FFFFFF'], speed: 0.2, up: 0, life: 0.35, size: 0.08, gravity: 0 });
        }
      } else if (g.util === 'frag' && Math.random() < 0.6) {
        this.particles.burst({ x, y, z: 0.3, count: 1, color: ['#FFE45C', '#FF8A1F'], speed: 1.5, up: 2, life: 0.25, size: 0.07 });
      }
    }
    for (const [id, v] of this.throwViews) {
      if (!seen.has(id)) {
        v.obj.removeFromParent();
        this.throwViews.delete(id);
      }
    }
  }

  private renderSmokes(snap: Snapshot): void {
    const seen = new Set<number>();
    for (const sm of snap.smokes) {
      seen.add(sm.id);
      let g = this.smokeViews.get(sm.id);
      if (!g) {
        g = new THREE.Group();
        // Emissive lift keeps the thick cloud a pale grey instead of shading to near-black underneath.
        const mat = new THREE.MeshLambertMaterial({ color: '#DCD7E8', emissive: '#7E778F', transparent: true, opacity: 0.85, depthWrite: false });
        // No toon outlines: on a dense cloud they draw every puff's edge as a black streak.
        mat.userData.outlineParameters = { visible: false };
        // A cluster of puffs; tall enough to hide anyone standing inside.
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const rr = i < 7 ? sm.r * 0.55 : sm.r * 0.25;
          const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
          puff.position.set(Math.cos(a) * rr, 0.9 + (i % 3) * 0.55, Math.sin(a) * rr);
          puff.scale.setScalar(sm.r * (0.42 + ((i * 37) % 10) / 40));
          puff.userData.base = puff.scale.x;
          puff.userData.phase = i;
          g.add(puff);
        }
        g.position.set(sm.x, 0, sm.y);
        g.userData.mat = mat;
        g.userData.born = this.clock;
        this.s.world.add(g);
        this.smokeViews.set(sm.id, g);
      }
      const age = this.clock - (g.userData.born as number);
      const grow = Math.min(1, age / 0.5);
      const fade = Math.min(1, sm.endsIn / 1.2);
      const depth = this.hud.get().me?.alive ? Math.max(0, Math.min(1, (sm.r - Math.hypot(this.pred.x + this.predOffset.x - sm.x, this.pred.y + this.predOffset.y - sm.y)) / (sm.r * 0.08))) : 0;
      // Thick from outside; thins once you're inside so the screen haze takes over and you can still see your own feet.
      (g.userData.mat as THREE.MeshLambertMaterial).opacity = (0.85 - 0.6 * depth * depth * (3 - 2 * depth)) * fade;
      for (const puff of g.children) {
        const b = puff.userData.base as number;
        puff.scale.setScalar(b * (0.3 + 0.7 * grow) * (1 + Math.sin(this.clock * 1.5 + (puff.userData.phase as number)) * 0.05));
      }
    }
    for (const [id, g] of this.smokeViews) {
      if (!seen.has(id)) {
        for (const puff of g.children) (puff as THREE.Mesh).geometry.dispose();
        (g.userData.mat as THREE.Material).dispose();
        g.removeFromParent();
        this.smokeViews.delete(id);
      }
    }
  }

  /** Stretch a rope mesh from (x0, h0, y0) to (x1, h1, y1). */
  private spanRope(rope: THREE.Mesh, x0: number, h0: number, y0: number, x1: number, h1: number, y1: number): void {
    const len = Math.hypot(x1 - x0, h1 - h0, y1 - y0);
    rope.position.set(x0, h0, y0);
    rope.lookAt(x1, h1, y1);
    rope.scale.set(1, 1, Math.max(0.01, len));
  }

  /** Draw the grapple rope from the hand to where the hook caught, with the hook at the end. */
  private updateRope(view: PlayerView, x: number, y: number, z: number, dash: PlayerSnap['dash']): void {
    const on = dash?.kind === 'grapple';
    view.rope.visible = on;
    view.hook.visible = on;
    if (!on || !dash) return;
    this.spanRope(view.rope, x, z + 0.8, y, dash.tx, 0.8, dash.ty);
    view.hook.position.set(dash.tx, 0.8, dash.ty);
    // Point the hook along the rope, away from the player.
    view.hook.lookAt(dash.tx + (dash.tx - x), 0.8, dash.ty + (dash.ty - y));
    view.hook.rotateX(Math.PI / 2);
  }

  private updateMissRopes(): void {
    this.missRopes = this.missRopes.filter((m) => {
      const age = this.clock - m.born;
      // Out and back in a quarter second.
      const reach = age < 0.12 ? age / 0.12 : Math.max(0, 1 - (age - 0.12) / 0.13);
      this.spanRope(m.rope, m.x0, 0.8, m.y0, m.x0 + (m.x1 - m.x0) * reach, 0.8, m.y0 + (m.y1 - m.y0) * reach);
      if (age > 0.25) {
        m.rope.removeFromParent();
        return false;
      }
      return true;
    });
  }

  /** Bounce Pads: pop out of the floor, squash when someone is launched, blink before folding up. */
  private renderPads(snap: Snapshot): void {
    const seen = new Set<number>();
    const base = (PAD.radius * 2) / 0.42;
    for (const d of snap.pads) {
      seen.add(d.id);
      let v = this.padViews.get(d.id);
      if (!v) {
        const root = new THREE.Group();
        // The hand-held model is 0.42 m across; set down it fills the trigger circle.
        const model = createUtilModel('pad');
        model.scale.setScalar(base);
        root.add(model);
        const ringMat = new THREE.MeshBasicMaterial({ color: '#8A8296', transparent: true, opacity: 0.45, depthWrite: false });
        ringMat.userData.outlineParameters = { visible: false };
        const ring = new THREE.Mesh(new THREE.RingGeometry(PAD.radius - 0.1, PAD.radius, 40), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        root.add(ring);
        // Armed glow: a soft disc that breathes under the pad once it is live.
        const glowMat = new THREE.MeshBasicMaterial({ color: PAD_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
        glowMat.userData.outlineParameters = { visible: false };
        const glow = new THREE.Mesh(new THREE.CircleGeometry(PAD.radius * 0.95, 32), glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.06;
        root.add(glow);
        root.position.set(d.x, 0, d.y);
        root.scale.setScalar(0.01);
        this.s.world.add(root);
        v = { root, model, ringMat, glowMat, born: this.clock, bounceAt: -1, hp: d.hp, hitAt: -1 };
        this.padViews.set(d.id, v);
      }
      if (d.hp < v.hp) {
        v.hp = d.hp;
        v.hitAt = this.clock;
      }
      const k = Math.min(1, (this.clock - v.born) / 0.3);
      v.root.scale.setScalar(1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2);
      // At rest the spring is pressed down. When it launches someone it shoots up, holds a beat,
      // then sinks back with a little wobble.
      const b = this.clock - v.bounceAt;
      let lift = 0;
      if (v.bounceAt >= 0 && b < 0.6) {
        if (b < 0.07) lift = b / 0.07;
        else if (b < 0.18) lift = 1;
        else {
          const u = (b - 0.18) / 0.42;
          lift = Math.max(0, (1 - u) * (1 - u)) + Math.sin(u * Math.PI * 2) * 0.08 * (1 - u);
        }
      }
      const restY = 0.5;
      const hit = Math.max(0, 1 - (this.clock - v.hitAt) / 0.15);
      const sy = restY + (1.35 - restY) * lift;
      const sxz = 1 - lift * 0.12 + hit * 0.12;
      v.model.scale.set(base * sxz, base * sy * (1 - hit * 0.15), base * sxz);
      v.model.rotation.z = hit * Math.sin(this.clock * 60) * 0.08;
      const blinkOut = d.endsIn < 2 && Math.floor(this.clock * 8) % 2 === 0;
      // Damage shifts the ring from blue toward red.
      v.ringMat.color.set(PAD_COLOR).lerp(new THREE.Color('#FF3B5C'), 1 - d.hp);
      v.ringMat.opacity = blinkOut ? 0.15 : 0.55 + Math.sin(this.clock * 5) * 0.15;
      v.glowMat.opacity = blinkOut ? 0 : 0.14 + Math.sin(this.clock * 5) * 0.06 + lift * 0.4;
    }
    for (const [id, v] of this.padViews) {
      if (seen.has(id)) continue;
      v.root.removeFromParent();
      v.ringMat.dispose();
      v.glowMat.dispose();
      this.padViews.delete(id);
    }
  }

  /** King of the Toybox ring: white when empty, the holder's colour when held, flashing when contested. */
  private renderHill(snap: Snapshot): void {
    const hill = snap.hill;
    if (!hill) {
      if (this.hillView) {
        this.hillView.removeFromParent();
        this.hillView = null;
      }
      return;
    }
    if (!this.hillView) {
      const g = new THREE.Group();
      const fill = new THREE.Mesh(
        new THREE.CircleGeometry(1, 56),
        new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.12, depthWrite: false }),
      );
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.03;
      fill.name = 'fill';
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(0.94, 1, 72),
        new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.9, depthWrite: false }),
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.04;
      rim.name = 'rim';
      // Dashes rotate around the rim so the ring reads as "active".
      const dashes = new THREE.Group();
      dashes.name = 'dashes';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const d = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), new THREE.MeshBasicMaterial({ color: '#FFFFFF' }));
        d.position.set(Math.cos(a) * 1.08, 0.05, Math.sin(a) * 1.08);
        d.rotation.y = -a;
        dashes.add(d);
      }
      g.add(fill, rim, dashes);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).userData.outlineParameters = { visible: false };
      });
      g.position.set(hill.x, 0, hill.y);
      g.scale.setScalar(hill.r);
      this.s.world.add(g);
      this.hillView = g;
    }
    const holder = hill.holder ? snap.players.find((p) => p.id === hill.holder) : null;
    const color = hill.contested
      ? (Math.floor(this.clock * 6) % 2 ? '#FF3B5C' : '#FFFFFF')
      : holder ? (holder.id === this.myId ? PALETTE.lemon : HEROES[holder.hero].color) : '#FFFFFF';
    for (const name of ['fill', 'rim']) {
      ((this.hillView.getObjectByName(name) as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
    }
    ((this.hillView.getObjectByName('fill') as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = holder ? 0.24 : 0.12;
    const dashes = this.hillView.getObjectByName('dashes')!;
    dashes.rotation.y += holder ? 0.02 : 0.005;
    dashes.children.forEach((d) => ((d as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color));
  }

  /** Weapon, utility and heal drops. Power-ups are drawn by PowerDrops. */
  private renderPickups(snap: Snapshot, dt: number): void {
    const seenP = new Set<number>();
    for (const k of snap.pickups) {
      // Power-ups have their own drop-in animation in PowerDrops.
      if (k.kind === 'power') continue;
      seenP.add(k.id);
      let g = this.pickupViews.get(k.id);
      if (!g) {
        g = new THREE.Group();
        const model = k.kind === 'heal' ? createHealModel() : k.kind === 'gun' ? createGunModel(k.item as GunId) : createUtilModel(k.item as UtilId);
        model.scale.setScalar(k.kind === 'heal' ? 1.4 : 1.15);
        model.name = 'model';
        const glow = new THREE.Mesh(
          new THREE.CircleGeometry(0.75, 28),
          new THREE.MeshBasicMaterial({ color: k.item === 'heal' ? '#FF5F6D' : itemColor(k.item as WeaponId), transparent: true, opacity: 0.45, depthWrite: false }),
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
      // Blink for the last two seconds before the drop disappears.
      g.visible = k.expiresIn > 2 || Math.floor(this.clock * 8) % 2 === 0;
    }
    for (const [id, g] of this.pickupViews) {
      if (!seenP.has(id)) {
        g.removeFromParent();
        this.pickupViews.delete(id);
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
      // Scoping pushes the view far out along the aim so long shots stay on screen.
      // The Longshot reaches 34 m, so its scope pushes further than the others.
      const scoping = this.isScoping();
      const longScope = scoping && me.gun === 'sniper';
      lead.clampLength(0, longScope ? 24 : scoping ? 18 : 10).multiplyScalar(longScope ? 0.6 : scoping ? 0.5 : 0.18);
      target.add(lead);
    } else if (me) {
      // Dead: follow whoever we're spectating. A hidden view still sits where that player fell.
      const v = (this.spectateId ? this.views.get(this.spectateId) : null) ?? this.views.get(me.id);
      if (v) target.copy(v.skin.root.position);
    }
    if (!this.camReady) {
      this.camTarget.copy(target);
      this.camReady = !!me;
    } else {
      this.camTarget.lerp(target, 1 - Math.exp(-7 * dt));
    }
    const shake = this.shake.offset(dt, reducedMotion());
    const wantZoom = me && this.isScoping() ? (me.gun === 'sniper' ? 1.4 : 1) : 0;
    this.scopeZoom += (wantZoom - this.scopeZoom) * (1 - Math.exp(-6 * dt));
    const offset = CAMERA_OFFSET.clone().multiplyScalar(1 + this.scopeZoom * 0.22);
    this.s.camera.position.copy(this.camTarget).add(offset).add(shake);
    // Keep the shadow-casting sun over the action so shadows stay sharp on big maps.
    this.s.sun.position.set(this.camTarget.x - 10, 30, this.camTarget.z + 14);
    this.s.sun.target.position.copy(this.camTarget);
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
        const victimView = this.views.get(ev.victim);
        if (victimView && pos) {
          const from = this.viewPos(ev.killer) ?? pos;
          this.shatter.burst(victimView.skin.root, new THREE.Vector3(from.x, 0.7, from.y), ev.gun === 'rocket' || ev.gun === 'shotgun' || ev.gun === 'frag' ? 1.6 : 1);
          const killer = this.latest?.players.find((o) => o.id === ev.killer);
          if (killer && ev.killer !== ev.victim) this.playKillFx(killer.killFx ?? 'shatter', pos.x, pos.y);
          victimView.skin.root.visible = false;
          victimView.laser.visible = false;
          victimView.laserGlow.visible = false;
          victimView.laserDot.visible = false;
        }
        if (ev.killer === me && ev.victim !== me) {
          this.hud.set({ banner: { key: ++this.bannerKey, kind: 'eliminated', name: this.nameOf(ev.victim) } });
        } else if (ev.victim === me && ev.killer !== me) {
          this.hud.set({ banner: { key: ++this.bannerKey, kind: 'eliminatedBy', name: this.nameOf(ev.killer) } });
        }
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
        }
        if (ev.victim === me) {
          this.sfx.death();
          this.hud.set({ killedBy: ev.killer === me ? null : ev.killer });
          // Watch the player who got us; with no killer, the camera stays put and moves on shortly.
          this.spectateId = ev.killer === me ? null : ev.killer;
          this.spectateWaitUntil = 0;
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
      case 'overcharge': {
        const p = this.viewPos(ev.id);
        if (p) {
          this.rings.spawn(p.x, p.y, 1.8, PALETTE.lemon, 0.35);
          this.particles.burst({ x: p.x, y: p.y, z: 0.9, count: 22, color: [PALETTE.lemon, '#FFFFFF'], speed: 5, up: 4, life: 0.45, size: 0.14, gravity: 2 });
        }
        if (ev.id === me) {
          this.sfx.overcharge();
          this.shake.add(0.15);
          this.toast(`Overcharged! Your next ${ABILITY.overchargeShots} shots hit twice as hard.`);
        }
        break;
      }
      case 'hide':
        // Everyone sees the puff as the Chameleon fades out.
        this.particles.burst({ x: ev.x, y: ev.y, z: 0.6, count: 14, color: [PALETTE.mint, '#FFFFFF'], speed: 2, up: 2, life: 0.5, size: 0.14, gravity: 1 });
        if (ev.id === me) this.sfx.hide();
        break;
      case 'sonar': {
        // Everyone sees the rings; only the pinger's team gets the through-wall reveal.
        // Two waves sweep the whole map so everyone sees the ping pass them.
        this.rings.spawnWave(ev.x, ev.y, ev.r, PALETTE.tangerine, 45, 0.8);
        this.rings.spawnWave(ev.x, ev.y, ev.r, '#FFFFFF', 38, 0.35);
        this.rings.spawn(ev.x, ev.y, 3, PALETTE.tangerine, 0.4);
        const pinged = !!me && ev.hits.includes(me) && !this.isAlly(ev.id);
        if (this.isAlly(ev.id)) {
          const until = this.clock + ABILITY.sonarReveal;
          for (const id of ev.hits) this.sonarReveals.set(id, until);
        }
        if (ev.id === me) this.sfx.sonar(ev.hits.length);
        else if (pinged) this.sfx.pinged();
        else if (this.nearness(ev.x, ev.y) > 0.2) this.sfx.sonar(0);
        if (pinged) this.toast(`${this.nameOf(ev.id)}'s sonar spotted you. They can see you through walls for a few seconds.`);
        break;
      }
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
          this.toast(`Picked up the ${itemName(ev.item)}. It's yours until you die.`);
        }
        break;
      case 'throw':
        if (ev.id === me || this.nearness(this.viewPos(ev.id)?.x ?? 0, this.viewPos(ev.id)?.y ?? 0) > 0.3) this.sfx.throwWhoosh();
        break;
      case 'weaponSwap':
        if (ev.id === me) this.sfx.weaponSwap();
        break;
      case 'flash': {
        const n = this.nearness(ev.x, ev.y);
        this.particles.burst({ x: ev.x, y: ev.y, z: 0.6, count: 30, color: ['#FFFFFF', PALETTE.lemon], speed: 9, up: 4, life: 0.35, size: 0.2, gravity: 0 });
        this.rings.spawn(ev.x, ev.y, 6, '#FFFFFF', 0.3);
        this.sfx.flashBang(n);
        break;
      }
      case 'smoke':
        this.sfx.smokeHiss(this.nearness(ev.x, ev.y));
        this.rings.spawn(ev.x, ev.y, 3.6, '#B48CFF', 0.5);
        break;
      case 'heal':
        this.particles.burst({ x: ev.x, y: ev.y, z: 0.8, count: 16, color: ['#FF5F6D', '#FFFFFF'], speed: 2.5, up: 4, life: 0.6, size: 0.16, gravity: 3 });
        if (ev.id === me) this.sfx.heal();
        break;
      case 'streak':
        this.hud.set({ streak: { key: ++this.streakKey, name: this.nameOf(ev.id), n: ev.n, mine: ev.id === me } });
        if (ev.id === me) this.sfx.streak(ev.n);
        break;
      case 'padSet': {
        this.rings.spawn(ev.x, ev.y, 1.4, PAD_COLOR, 0.3);
        this.particles.burst({ x: ev.x, y: ev.y, z: 0.1, count: 12, color: [PAD_COLOR, '#FFFFFF'], speed: 3, up: 2, life: 0.4, size: 0.14 });
        const near = ev.id === me ? 1 : this.nearness(ev.x, ev.y);
        if (near > 0.2) this.sfx.padSet(near);
        break;
      }
      case 'padEnd':
        if (ev.broken) {
          // Shot apart: springs and plastic everywhere.
          this.particles.burst({ x: ev.x, y: ev.y, z: 0.4, count: 30, color: [PAD_COLOR, PALETTE.lemon, '#6A2FA0', '#FFFFFF'], speed: 6, up: 6, life: 0.8, size: 0.2 });
          this.rings.spawn(ev.x, ev.y, 1.8, '#FFFFFF', 0.3);
          if (this.nearness(ev.x, ev.y) > 0.2) this.sfx.padBreak(this.nearness(ev.x, ev.y));
        } else {
          this.particles.burst({ x: ev.x, y: ev.y, z: 0.2, count: 10, color: [PAD_COLOR, '#FFFFFF'], speed: 2, up: 2, life: 0.4, size: 0.14, gravity: 2 });
        }
        break;
      case 'bounce': {
        const v = this.padViews.get(ev.pad);
        if (v) v.bounceAt = this.clock;
        this.particles.burst({ x: ev.x, y: ev.y, z: 0.2, count: 18, color: [PAD_COLOR, PALETTE.lemon, '#FFFFFF'], speed: 4, up: 5, life: 0.5, size: 0.16 });
        this.rings.spawn(ev.x, ev.y, 2, '#FFFFFF', 0.3);
        const near = ev.id === me ? 1 : this.nearness(ev.x, ev.y);
        if (near > 0.15) this.sfx.boing(near);
        break;
      }
      case 'grapple': {
        const near = ev.id === me ? 1 : this.nearness(ev.x1, ev.y1);
        if (near > 0.2) this.sfx.grapple(ev.hit, near);
        if (ev.hit) {
          this.particles.burst({ x: ev.x2, y: ev.y2, z: 0.8, count: 10, color: ['#C9CED6', '#FFFFFF'], speed: 3, up: 1.5, life: 0.3, size: 0.12 });
        } else {
          const rope = new THREE.Mesh(this.ropeGeo, toon('#5B2A86'));
          this.s.world.add(rope);
          this.missRopes.push({ rope, born: this.clock, x0: ev.x1, y0: ev.y1, x1: ev.x2, y1: ev.y2 });
          if (ev.id === me) this.toast('Nothing to hook onto. Aim the grapple at a wall within 15 m.');
        }
        break;
      }
      case 'refill':
        if (ev.id === me) this.sfx.refill();
        break;
      case 'powerDrop':
        this.toast(`${POWERS[ev.power].name} is dropping in. Grab it before anyone else!`);
        break;
      case 'power': {
        const def = POWERS[ev.power];
        this.rings.spawn(ev.x, ev.y, 2.4, def.color, 0.4);
        this.particles.burst({ x: ev.x, y: ev.y, z: 0.9, count: 28, color: [def.color, '#FFFFFF'], speed: 5, up: 5, life: 0.7, size: 0.18 });
        if (ev.id === me) {
          this.sfx.powerUp();
          this.shake.add(0.15);
          this.toast(`${def.name}! ${def.blurb} for ${def.duration} seconds.`);
        } else if (this.nearness(ev.x, ev.y) > 0.4) {
          this.sfx.pickup();
        }
        break;
      }
      case 'ladder':
        if (ev.id === me) {
          this.sfx.pickup();
          this.toast(`Next gun: ${GUNS[ev.gun].name}`);
        }
        break;
      case 'win': {
        this.sfx.win();
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

  /** Pick who to watch while dead. When they go down too, linger a moment, then move on. */
  private updateSpectate(snap: Snapshot, me: PlayerSnap): void {
    if (me.alive || snap.phase !== 'playing') {
      this.spectateId = null;
      this.spectateWaitUntil = 0;
      return;
    }
    const current = this.spectateId ? snap.players.find((p) => p.id === this.spectateId) : null;
    if (current?.alive) {
      this.spectateWaitUntil = 0;
      return;
    }
    if (!this.spectateWaitUntil) this.spectateWaitUntil = this.clock + 1.5;
    if (this.clock < this.spectateWaitUntil) return;
    const alive = snap.players.filter((p) => p.alive && p.id !== me.id);
    if (!alive.length) return;
    // In Team Brawl, prefer watching a teammate.
    const mates = me.team >= 0 ? alive.filter((p) => p.team === me.team) : [];
    this.spectateId = (mates[0] ?? alive[0]).id;
    this.spectateWaitUntil = 0;
  }

  private drawMinimap(snap: Snapshot, me: PlayerSnap | null): void {
    // The death panel takes the bottom of the screen; the minimap comes back on respawn.
    this.minimap.el.hidden = !me?.alive;
    this.minimap.draw({
      me: me?.alive ? { x: this.pred.x + this.predOffset.x, y: this.pred.y + this.predOffset.y, aim: this.aim } : null,
      // Sonar is the one exception to "no other players": pinged enemies show while revealed.
      revealed: snap.players.filter((p) => p.alive && (this.sonarReveals.get(p.id) ?? 0) > this.clock),
      powers: snap.pickups.filter((k) => k.kind === 'power').map((k) => ({
        x: k.x, y: k.y, color: POWERS[k.item as PowerId].color, landing: (k.readyIn ?? 0) > 0,
      })),
      hill: snap.hill,
      time: this.clock,
    });
  }

  /** Arrows at the screen edge pointing toward power-ups the camera can't see. */
  private updatePowerMarkers(snap: Snapshot | null): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const pad = 44;
    const live = new Set<number>();
    const show = snap?.phase === 'playing';
    for (const d of show ? this.powerDrops.list() : []) {
      const p = new THREE.Vector3(d.x, 0.9, d.y).project(this.s.camera);
      let sx = ((p.x + 1) / 2) * w;
      let sy = ((1 - p.y) / 2) * h;
      const behind = p.z > 1;
      if (!behind && sx > pad && sx < w - pad && sy > pad && sy < h - pad) continue;
      live.add(d.id);
      let el = this.powerMarkers.get(d.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'power-marker';
        el.style.setProperty('--power', POWERS[d.power].color);
        el.innerHTML = `<i class="power-marker__arrow"></i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${POWER_ICONS[d.power]}"/></svg>`;
        el.title = POWERS[d.power].name;
        this.overlay.appendChild(el);
        this.powerMarkers.set(d.id, el);
      }
      // Push the point out to the edge of a padded box around the screen center.
      const cx = w / 2;
      const cy = h / 2;
      let dx = sx - cx;
      let dy = sy - cy;
      if (behind) {
        dx = -dx;
        dy = -dy;
      }
      const k = Math.min((w / 2 - pad) / Math.max(1e-3, Math.abs(dx)), (h / 2 - pad) / Math.max(1e-3, Math.abs(dy)));
      sx = cx + dx * k;
      sy = cy + dy * k;
      const angle = Math.atan2(dy, dx);
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
      (el.firstElementChild as HTMLElement).style.transform = `rotate(${angle}rad) translateX(26px)`;
    }
    for (const [id, el] of this.powerMarkers) {
      if (live.has(id)) continue;
      el.remove();
      this.powerMarkers.delete(id);
    }
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
    const smoke: SmokeFog[] = [];
    if (me?.alive) {
      const x = this.pred.x + this.predOffset.x;
      const y = this.pred.y + this.predOffset.y;
      const player = new THREE.Vector3(x, 0, y).project(this.s.camera);
      for (const sm of snap.smokes) {
        const center = new THREE.Vector3(sm.x, 0, sm.y).project(this.s.camera);
        const fog = smokeFog(sm, x, y, (player.x - center.x) * this.container.clientWidth, (center.y - player.y) * this.container.clientHeight);
        if (fog) smoke.push(fog);
      }
    }
    let nearPickup: WeaponId | null = null;
    if (me?.alive) {
      let best = PICKUP_RADIUS;
      for (const k of snap.pickups) {
        // Heals and power-ups are taken by walking over them; only weapon drops get the swap prompt.
        if (k.kind === 'heal' || k.kind === 'power' || snap.mode === 'ladder') continue;
        const d = Math.hypot(k.x - this.pred.x, k.y - this.pred.y);
        if (d < best) {
          best = d;
          nearPickup = k.item as WeaponId;
        }
      }
    }
    const patch: Partial<HudState> = {
      me,
      players: [...snap.players].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths),
      mode: snap.mode,
      target: snap.target,
      teamScores: snap.teamScores,
      hill: snap.hill,
      slowed: !!me?.alive && this.isSlowed(me),
      phase: snap.phase,
      winner: snap.winner,
      endsIn: snap.endsIn,
      ping: Math.round(this.net.rtt),
      fps: this.fps,
      nearPickup,
      bots: snap.players.filter((p) => p.bot).length,
      scoped: this.isScoping(),
      blind: me?.blindIn ?? 0,
      smoke,
      spectating: me && !me.alive ? snap.players.find((p) => p.id === this.spectateId && p.alive) ?? null : null,
      vote: snap.vote,
    };
    if (!snap.vote) patch.myVote = null;
    if (this.botsWanted) {
      if (patch.bots === this.botsWanted.count || performance.now() - this.botsWanted.at > 1500) this.botsWanted = null;
      else patch.bots = this.botsWanted.count;
    }
    if (me?.alive && this.hud.get().killedBy) patch.killedBy = null;
    this.hud.set(patch);
  }
}

/** Smoke hides name tags so labels cannot reveal silhouettes through the cloud. */
function inSmoke(snap: Snapshot, x: number, y: number): boolean {
  return snap.smokes.some((s) => (x - s.x) ** 2 + (y - s.y) ** 2 < (s.r * 0.92) ** 2);
}

/** Sugar Rush speed for client prediction, matching the server's movement step. */
function boost(me: PlayerSnap): number {
  return me.powers?.speed ? POWER.speedFactor : 1;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
