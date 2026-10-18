import {
  DROP_LIFETIME, HEAL_AMOUNT, HEAL_LIFETIME, MATCH_END_TIME, MAX_HP, STREAK_CALLS,
  MAX_INPUT_DT, PICKUP_RADIUS, PLAYER_RADIUS, PLAYER_SPEED, RESPAWN_TIME, SCOPE_SPEED, SCOPE_SPREAD, SPAWN_SHIELD,
} from './constants';
import { GUNS, bulletDamage, type GunId } from './guns';
import { ABILITY, HEROES, type HeroId } from './heroes';
import { DEFAULT_MAP, MAPS, type MapDef, type MapId, type Rect } from './map';
import type { GameEvent, InputFrame, Loadout, WeaponId } from './protocol';
import { FLASH, SLOW_FACTOR, THROW, TURRET, UTILS, throwFlightTime, type UtilId } from './utilities';
import { GUN_LADDER, MODES, type ModeId } from './modes';
import { POWER, POWERS, POWER_IDS, type PowerId } from './powers';

// ---------- state ----------

export interface PlayerState {
  id: string;
  name: string;
  bot: boolean;
  loadout: Loadout;
  hero: HeroId;
  /** The gun in hand: primary or secondary depending on `slot`. */
  gun: GunId;
  primary: GunId;
  secondary: GunId;
  slot: 'primary' | 'secondary';
  ammo: { primary: number; secondary: number };
  reloadAt: number;
  wantReload: boolean;
  utility: UtilId;
  utilCharges: number;
  throwReadyAt: number;
  blindUntil: number;
  slowUntil: number;
  /** 0 red, 1 blue, -1 with no teams. */
  team: number;
  /** Mode score: kills, hill points or ladder step. */
  score: number;
  streak: number;
  bestStreak: number;
  damageDealt: number;
  weaponKills: Partial<Record<WeaponId, number>>;
  /** Shots left in the current burst and when the next one fires. */
  burstLeft: number;
  burstAt: number;
  wantSlot: 0 | 1 | 2;
  wantThrow: boolean;
  x: number;
  y: number;
  aim: number;
  aimDist: number;
  /** Knockback velocity, decays every tick. */
  vx: number;
  vy: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  shieldUntil: number;
  kills: number;
  deaths: number;
  fireReadyAt: number;
  abilityReadyAt: number;
  lastSeq: number;
  fire: boolean;
  scoped: boolean;
  wantAbility: boolean;
  wantPickup: boolean;
  /** Humans respawn only after asking; bots come back on their own. */
  wantRespawn: boolean;
  /** Sim time each power-up wears off. */
  powers: Record<PowerId, number>;
  /** Charge abilities: damage dealt toward the next use (keeps through death). */
  abilityCharge: number;
  /** Hide and Seek: last time this player moved or gave themselves away, and whether they've vanished. */
  stillSince: number;
  hidden: boolean;
  /** Overcharge: this many shots left that hit harder, if fired before `overchargeUntil`. */
  overchargeShots: number;
  overchargeUntil: number;
}

export interface Bullet {
  id: number;
  owner: string;
  gun: GunId;
  x: number;
  y: number;
  dx: number;
  dy: number;
  travelled: number;
  fake: boolean;
  bounces: number;
  /** Damage multiplier (Overcharge). */
  mult?: number;
  /** Fired by a Wind-Up Turret: fixed damage, and kills credit the turret. */
  turret?: boolean;
}

export interface Pickup {
  id: number;
  kind: 'gun' | 'util' | 'heal' | 'power';
  item: WeaponId | 'heal' | PowerId;
  x: number;
  y: number;
  expiresAt: number;
  /** Power-ups are marked before they land and can't be taken until this time. */
  readyAt?: number;
}

export interface Decoy {
  id: number;
  owner: string;
  x: number;
  y: number;
  aim: number;
  dirX: number;
  dirY: number;
  hp: number;
  expiresAt: number;
  fireReadyAt: number;
}

export interface Throwable {
  id: number;
  owner: string;
  util: UtilId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  landed: boolean;
  fuseAt: number;
}

export interface Turret {
  id: number;
  owner: string;
  team: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  expiresAt: number;
  fireReadyAt: number;
}

export interface Hill {
  x: number;
  y: number;
  r: number;
  holder: string | null;
  contested: boolean;
  /** Seconds banked toward the holder's next point. */
  progress: number;
}

export interface Smoke {
  id: number;
  x: number;
  y: number;
  r: number;
  expiresAt: number;
}

export interface GameState {
  time: number;
  nextId: number;
  phase: 'playing' | 'ended';
  winner: string | null;
  endsAt: number;
  players: Map<string, PlayerState>;
  bullets: Bullet[];
  pickups: Pickup[];
  throwables: Throwable[];
  smokes: Smoke[];
  turrets: Turret[];
  mode: ModeId;
  teamScores: [number, number];
  hill: Hill | null;
  decoys: Decoy[];
  events: GameEvent[];
  map: MapDef;
  rng: () => number;
  /** When the next power-up drops. */
  nextPowerAt: number;
  /** Map to switch to when the next round starts (public lobby vote). */
  nextMap: MapId | null;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(seed = Date.now(), mapId: MapId = DEFAULT_MAP, mode: ModeId = 'ffa'): GameState {
  const map = MAPS[mapId];
  return {
    time: 0,
    nextId: 1,
    phase: 'playing',
    winner: null,
    endsAt: 0,
    players: new Map(),
    bullets: [],
    pickups: [],
    throwables: [],
    smokes: [],
    turrets: [],
    mode,
    teamScores: [0, 0],
    hill: mode === 'hill' ? { x: map.w / 2, y: map.h / 2, r: Math.min(map.w, map.h) * 0.12, holder: null, contested: false, progress: 0 } : null,
    decoys: [],
    events: [],
    map,
    rng: mulberry32(seed),
    nextPowerAt: POWER.firstAfter,
    nextMap: null,
  };
}

// ---------- geometry ----------

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function circleOverlapsRect(x: number, y: number, r: number, rect: Rect): boolean {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

export function pointInRect(x: number, y: number, rect: Rect, pad = 0): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}

function pushOutOfRect(p: { x: number; y: number }, r: number, rect: Rect): void {
  const cx = clamp(p.x, rect.x, rect.x + rect.w);
  const cy = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.y = cy + (dy / d) * r;
    return;
  }
  // Center is inside the rect: leave along the shallowest side.
  const left = p.x - rect.x;
  const right = rect.x + rect.w - p.x;
  const top = p.y - rect.y;
  const bottom = rect.y + rect.h - p.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = rect.x - r;
  else if (m === right) p.x = rect.x + rect.w + r;
  else if (m === top) p.y = rect.y - r;
  else p.y = rect.y + rect.h + r;
}

/** Move a circle by (dx, dy), sliding along walls. Substeps so thin walls can't be skipped. */
export function moveCircle(p: { x: number; y: number }, dx: number, dy: number, walls: Rect[], r = PLAYER_RADIUS): void {
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  for (let i = 0; i < steps; i++) {
    p.x += dx / steps;
    p.y += dy / steps;
    for (let iter = 0; iter < 2; iter++) {
      for (const w of walls) pushOutOfRect(p, r, w);
    }
  }
}

/**
 * Shared movement step. The server runs it for every input frame; the client runs the same
 * function to predict its own player.
 */
export function stepMovement(
  pos: { x: number; y: number },
  mx: number,
  my: number,
  dt: number,
  walls: Rect[],
  scoped = false,
  slowed = false,
  boost = 1,
): void {
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  if (len === 0) return;
  const f = (scoped ? SCOPE_SPEED : 1) * (slowed ? SLOW_FACTOR : 1) * boost;
  moveCircle(pos, mx * PLAYER_SPEED * f * dt, my * PLAYER_SPEED * f * dt, walls);
}

export function hasPower(state: GameState, p: PlayerState, power: PowerId): boolean {
  return state.time < p.powers[power];
}

export function isSlowed(state: GameState, p: PlayerState): boolean {
  return state.time < p.slowUntil;
}

export function sameTeam(state: GameState, a: string, b: string): boolean {
  if (!MODES[state.mode].teams || a === b) return false;
  const pa = state.players.get(a);
  const pb = state.players.get(b);
  return !!pa && !!pb && pa.team === pb.team;
}

export function isHidden(_state: GameState, p: PlayerState): boolean {
  return p.alive && p.hidden;
}

/** Moving, shooting, throwing or getting hit restarts the Hide and Seek timer. */
function reveal(state: GameState, p: PlayerState): void {
  p.stillSince = state.time;
  p.hidden = false;
}

/** For the HUD: seconds until the ability is ready (or next fires, for timed passives) and charge 0..1. */
export function abilityStatus(state: GameState, p: PlayerState): { readyIn: number; charge: number } {
  const def = HEROES[p.hero];
  const t = state.time;
  if (def.kind === 'charge') return { readyIn: 0, charge: Math.min(1, p.abilityCharge / (def.charge ?? 1)) };
  if (p.hero === 'chameleon') return { readyIn: p.hidden ? 0 : Math.max(0, ABILITY.hideDelay - (t - p.stillSince)), charge: 0 };
  return { readyIn: Math.max(0, p.abilityReadyAt - t), charge: 0 };
}

// ---------- players ----------

export function addPlayer(
  state: GameState,
  opts: { id: string; name: string; hero: HeroId; gun: GunId; secondary: GunId; utility: UtilId; hat?: Loadout['hat']; bot?: boolean },
): PlayerState {
  let team = -1;
  if (MODES[state.mode].teams) {
    const counts = [0, 0];
    for (const o of state.players.values()) if (o.team >= 0) counts[o.team]++;
    team = counts[0] <= counts[1] ? 0 : 1;
  }
  const p: PlayerState = {
    id: opts.id,
    name: opts.name,
    bot: !!opts.bot,
    loadout: { hero: opts.hero, gun: opts.gun, secondary: opts.secondary, utility: opts.utility, hat: opts.hat ?? 'none' },
    hero: opts.hero,
    gun: opts.gun,
    primary: opts.gun,
    secondary: opts.secondary,
    slot: 'primary',
    ammo: { primary: 0, secondary: 0 },
    reloadAt: 0,
    wantReload: false,
    utility: opts.utility,
    utilCharges: 0,
    throwReadyAt: 0,
    blindUntil: 0,
    slowUntil: 0,
    team,
    score: 0,
    streak: 0,
    bestStreak: 0,
    damageDealt: 0,
    weaponKills: {},
    burstLeft: 0,
    burstAt: 0,
    wantSlot: 0,
    wantThrow: false,
    x: 0,
    y: 0,
    aim: 0,
    aimDist: 5,
    vx: 0,
    vy: 0,
    hp: MAX_HP,
    alive: false,
    respawnAt: 0,
    shieldUntil: 0,
    kills: 0,
    deaths: 0,
    fireReadyAt: 0,
    abilityReadyAt: 0,
    lastSeq: 0,
    fire: false,
    scoped: false,
    wantAbility: false,
    wantPickup: false,
    wantRespawn: false,
    powers: { speed: 0, damage: 0, armor: 0 },
    abilityCharge: 0,
    stillSince: 0,
    hidden: false,
    overchargeShots: 0,
    overchargeUntil: 0,
  };
  state.players.set(p.id, p);
  spawn(state, p);
  return p;
}

export function removePlayer(state: GameState, id: string): void {
  state.players.delete(id);
  state.decoys = state.decoys.filter((d) => d.owner !== id);
  state.turrets = state.turrets.filter((t) => t.owner !== id);
}

function spawn(state: GameState, p: PlayerState): void {
  // Spawn away from enemies; teammates don't count as threats.
  const others = [...state.players.values()].filter((o) => o.id !== p.id && o.alive && !sameTeam(state, o.id, p.id));
  let best = state.map.spawns[0];
  let bestScore = -1;
  for (const s of state.map.spawns) {
    let nearest = Infinity;
    for (const o of others) nearest = Math.min(nearest, Math.hypot(o.x - s.x, o.y - s.y));
    // Small random term so empty rooms don't always use the same corner.
    const score = (others.length ? nearest : 0) + state.rng() * 3;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  p.x = best.x;
  p.y = best.y;
  p.vx = 0;
  p.vy = 0;
  p.aim = Math.atan2(state.map.h / 2 - p.y, state.map.w / 2 - p.x);
  p.hero = p.loadout.hero;
  p.primary = p.loadout.gun;
  p.secondary = p.loadout.secondary;
  p.slot = 'primary';
  p.gun = p.primary;
  p.utility = p.loadout.utility;
  if (state.mode === 'ladder') {
    const gun = GUN_LADDER[Math.min(p.score, GUN_LADDER.length - 1)];
    p.primary = gun;
    p.secondary = gun;
    p.gun = gun;
  }
  p.utilCharges = UTILS[p.utility].charges;
  p.ammo = { primary: GUNS[p.primary].magazine, secondary: GUNS[p.secondary].magazine };
  p.reloadAt = 0;
  p.wantReload = false;
  p.throwReadyAt = state.time;
  p.blindUntil = 0;
  p.slowUntil = 0;
  p.burstLeft = 0;
  p.streak = 0;
  p.wantSlot = 0;
  p.wantThrow = false;
  p.hp = MAX_HP;
  p.alive = true;
  p.shieldUntil = state.time + SPAWN_SHIELD;
  p.fireReadyAt = state.time;
  p.abilityReadyAt = state.time;
  p.fire = false;
  p.wantAbility = false;
  p.wantPickup = false;
  p.wantRespawn = false;
  p.powers = { speed: 0, damage: 0, armor: 0 };
  p.stillSince = state.time;
  p.hidden = false;
  p.overchargeShots = 0;
  p.overchargeUntil = 0;
}

export function setLoadout(state: GameState, p: PlayerState, loadout: Loadout): void {
  p.loadout = { ...loadout };
}

/** Apply one input frame from a client or bot. Movement happens immediately; actions run on the next tick. */
export function applyInput(state: GameState, p: PlayerState, frame: InputFrame): void {
  if (frame.seq <= p.lastSeq) return;
  p.lastSeq = frame.seq;
  if (Number.isFinite(frame.aim)) p.aim = frame.aim;
  if (Number.isFinite(frame.aimDist)) p.aimDist = clamp(frame.aimDist, 0, 40);
  if (frame.respawn && !p.alive) p.wantRespawn = true;
  if (!p.alive || state.phase !== 'playing') return;
  const dt = clamp(Number.isFinite(frame.dt) ? frame.dt : 0, 0, MAX_INPUT_DT);
  const mx = clamp(frame.mx || 0, -1, 1);
  const my = clamp(frame.my || 0, -1, 1);
  // No scoping while invisible: the server drops it too, so a modded client can't keep the slow, steady aim.
  p.scoped = !!frame.scope && !p.hidden;
  if (mx !== 0 || my !== 0) reveal(state, p);
  stepMovement(p, mx, my, dt, state.map.walls, p.scoped, isSlowed(state, p), hasPower(state, p, 'speed') ? POWER.speedFactor : 1);
  p.fire = !!frame.fire;
  if (frame.ability) p.wantAbility = true;
  if (frame.pickup) p.wantPickup = true;
  if (frame.reload === true) p.wantReload = true;
  if (frame.slot === 1 || frame.slot === 2) p.wantSlot = frame.slot;
  if (frame.throw) p.wantThrow = true;
}

/** Line of sight between two points: blocked by walls and by smoke clouds. */
export function hasLineOfSight(state: GameState, x1: number, y1: number, x2: number, y2: number): boolean {
  const walls = state.map.walls;
  const d = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(d / 0.3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (walls.some((w) => pointInRect(x, y, w))) return false;
    if (state.smokes.some((s) => (x - s.x) ** 2 + (y - s.y) ** 2 < s.r * s.r)) return false;
  }
  return true;
}

// ---------- damage ----------

function damagePlayer(state: GameState, target: PlayerState, dmg: number, by: string, gun: WeaponId): void {
  if (!target.alive || state.time < target.shieldUntil || state.phase !== 'playing') return;
  if (sameTeam(state, target.id, by)) return;
  const attacker = state.players.get(by);
  if (attacker && attacker.id !== target.id && hasPower(state, attacker, 'damage')) dmg *= POWER.damageFactor;
  if (hasPower(state, target, 'armor')) dmg *= POWER.armorFactor;
  reveal(state, target);
  const dealt = Math.min(dmg, Math.max(0, target.hp));
  target.hp -= dmg;
  if (attacker && attacker.id !== target.id) {
    attacker.damageDealt += dealt;
    const need = HEROES[attacker.hero].charge;
    if (need) attacker.abilityCharge = Math.min(need, attacker.abilityCharge + dealt);
  }
  state.events.push({ t: 'hit', target: target.id, by, dmg: Math.round(dmg), x: r2(target.x), y: r2(target.y) });
  if (target.hp <= 0) killPlayer(state, target, by, gun);
}

function killPlayer(state: GameState, victim: PlayerState, killerId: string, gun: WeaponId): void {
  victim.hp = 0;
  victim.alive = false;
  victim.fire = false;
  victim.burstLeft = 0;
  victim.reloadAt = 0;
  victim.wantReload = false;
  victim.respawnAt = state.time + RESPAWN_TIME;
  victim.deaths++;
  victim.streak = 0;
  victim.wantRespawn = false;
  state.events.push({ t: 'kill', killer: killerId, victim: victim.id, gun });
  // Gun Ladder hands out fixed guns, so nothing drops there.
  if (state.mode !== 'ladder') {
    // Drop one random item from the loadout: primary, secondary or utility.
    const roll = Math.floor(state.rng() * 3);
    const drop: { kind: 'gun' | 'util'; item: WeaponId } =
      roll === 0 ? { kind: 'gun', item: victim.primary } : roll === 1 ? { kind: 'gun', item: victim.secondary } : { kind: 'util', item: victim.utility };
    state.pickups.push({ id: state.nextId++, ...drop, x: victim.x, y: victim.y, expiresAt: state.time + DROP_LIFETIME });
  }
  const killer = state.players.get(killerId);
  if (!killer || killer.id === victim.id) return;
  // A heal lands a little to the side so it doesn't hide the dropped item.
  state.pickups.push({
    id: state.nextId++, kind: 'heal', item: 'heal',
    x: clamp(victim.x + 0.9, 1.5, state.map.w - 1.5), y: victim.y, expiresAt: state.time + HEAL_LIFETIME,
  });
  killer.kills++;
  killer.streak++;
  killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
  killer.weaponKills[gun] = (killer.weaponKills[gun] ?? 0) + 1;
  // Every kill hands back one utility charge, so a long streak doesn't run dry.
  const maxCharges = UTILS[killer.utility].charges;
  if (killer.alive && killer.utilCharges < maxCharges) {
    killer.utilCharges++;
    state.events.push({ t: 'refill', id: killer.id, util: killer.utility });
  }
  if (STREAK_CALLS.includes(killer.streak)) state.events.push({ t: 'streak', id: killer.id, n: killer.streak });
  const mode = MODES[state.mode];
  if (state.mode === 'ffa') {
    killer.score = killer.kills;
    if (killer.score >= mode.target) endMatch(state, killer.id);
  } else if (state.mode === 'teams') {
    killer.score = killer.kills;
    if (killer.team >= 0) {
      state.teamScores[killer.team]++;
      if (state.teamScores[killer.team] >= mode.target) endMatch(state, `team:${killer.team}`);
    }
  } else if (state.mode === 'ladder') {
    killer.score++;
    if (killer.score >= GUN_LADDER.length) {
      endMatch(state, killer.id);
    } else {
      const next = GUN_LADDER[killer.score];
      killer.primary = next;
      killer.secondary = next;
      killer.gun = next;
      killer.ammo = { primary: GUNS[next].magazine, secondary: GUNS[next].magazine };
      killer.reloadAt = 0;
      killer.burstLeft = 0;
      killer.fireReadyAt = Math.max(killer.fireReadyAt, state.time + 0.3);
      state.events.push({ t: 'ladder', id: killer.id, gun: next });
    }
  }
}

function endMatch(state: GameState, winner: string): void {
  if (state.phase !== 'playing') return;
  state.phase = 'ended';
  state.winner = winner;
  state.endsAt = state.time + MATCH_END_TIME;
  state.events.push({ t: 'win', id: winner });
}

function popDecoy(state: GameState, d: Decoy): void {
  state.decoys = state.decoys.filter((o) => o !== d);
  state.events.push({ t: 'decoyPop', x: r2(d.x), y: r2(d.y) });
}

function explodeGun(state: GameState, x: number, y: number, owner: string, gun: GunId, mult = 1): void {
  const def = GUNS[gun];
  explode(state, x, y, owner, gun, def.damage * mult, def.splashRadius ?? 0, def.knockback ?? 0);
}

function explode(state: GameState, x: number, y: number, owner: string, gun: WeaponId, damage: number, radius: number, knockback: number): void {
  const def = { damage, knockback };
  state.events.push({ t: 'explode', x: r2(x), y: r2(y), r: radius });
  for (const p of state.players.values()) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > radius + PLAYER_RADIUS) continue;
    const falloff = 1 - 0.5 * Math.min(1, d / radius);
    const kb = (def.knockback ?? 0) * falloff;
    const nx = d > 1e-3 ? (p.x - x) / d : 0;
    const ny = d > 1e-3 ? (p.y - y) / d : 0;
    p.vx += nx * kb * 3;
    p.vy += ny * kb * 3;
    // Your own rockets push you (rocket jumps) but don't hurt.
    if (p.id !== owner) damagePlayer(state, p, def.damage * falloff, owner, gun);
  }
  for (const d of [...state.decoys]) {
    if (d.owner !== owner && Math.hypot(d.x - x, d.y - y) < radius) popDecoy(state, d);
  }
  for (const t of [...state.turrets]) {
    if (t.owner === owner || sameTeam(state, t.owner, owner)) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < radius + TURRET.radius) damageTurret(state, t, def.damage * (1 - 0.5 * Math.min(1, d / radius)));
  }
}

function damageTurret(state: GameState, t: Turret, dmg: number): void {
  t.hp -= dmg;
  if (t.hp > 0) return;
  state.turrets = state.turrets.filter((o) => o !== t);
  state.events.push({ t: 'turretEnd', x: r2(t.x), y: r2(t.y), broken: true });
}

// ---------- actions ----------

function startReload(state: GameState, p: PlayerState): void {
  if (p.reloadAt || p.ammo[p.slot] >= GUNS[p.gun].magazine) return;
  p.burstLeft = 0;
  p.reloadAt = state.time + GUNS[p.gun].reloadTime;
}

function fireGun(state: GameState, p: PlayerState): void {
  const def = GUNS[p.gun];
  p.fireReadyAt = state.time + def.cooldown;
  if (def.burst && def.burst > 1) {
    p.burstLeft = def.burst - 1;
    p.burstAt = state.time + (def.burstGap ?? 0.07);
  }
  shoot(state, p);
}

/** One trigger's worth of bullets, without touching the cooldown. Bursts call it again. */
function shoot(state: GameState, p: PlayerState): void {
  const def = GUNS[p.gun];
  p.ammo[p.slot]--;
  const spread = def.spread * (p.scoped ? SCOPE_SPREAD : 1);
  p.shieldUntil = Math.min(p.shieldUntil, state.time);
  reveal(state, p);
  // Overcharge powers whole trigger pulls: every pellet of a charged shot hits harder.
  const charged = p.overchargeShots > 0 && state.time < p.overchargeUntil;
  if (charged) p.overchargeShots--;
  const mult = charged ? ABILITY.overchargeMult : undefined;
  for (let i = 0; i < def.pellets; i++) {
    let a = p.aim;
    if (def.pellets > 1) {
      a += -spread / 2 + (spread * i) / (def.pellets - 1) + (state.rng() - 0.5) * 0.06;
    } else {
      a += (state.rng() - 0.5) * spread;
    }
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    state.bullets.push({
      id: state.nextId++, owner: p.id, gun: p.gun,
      x: p.x + dx * (PLAYER_RADIUS + 0.15), y: p.y + dy * (PLAYER_RADIUS + 0.15),
      dx, dy, travelled: 0, fake: false, bounces: def.bounces ?? 0, mult,
    });
  }
  state.events.push({ t: 'shot', id: p.id, gun: p.gun, x: r2(p.x), y: r2(p.y), a: r2(p.aim), ...(charged ? { charged: true } : {}) });
  if (def.knockback && !def.splashRadius) {
    // Shotgun recoil.
    p.vx -= Math.cos(p.aim) * def.knockback * 2;
    p.vy -= Math.sin(p.aim) * def.knockback * 2;
  }
}

function useAbility(state: GameState, p: PlayerState): boolean {
  const walls = state.map.walls;
  switch (p.hero) {
    case 'blink': {
      const dx = Math.cos(p.aim);
      const dy = Math.sin(p.aim);
      const maxD = Math.min(ABILITY.blinkDistance, Math.max(p.aimDist, 1.5));
      let lastX = p.x;
      let lastY = p.y;
      for (let d = 0.15; d <= maxD + 1e-6; d += 0.15) {
        const x = p.x + dx * d;
        const y = p.y + dy * d;
        if (x < PLAYER_RADIUS || x > state.map.w - PLAYER_RADIUS || y < PLAYER_RADIUS || y > state.map.h - PLAYER_RADIUS) break;
        if (walls.some((w) => circleOverlapsRect(x, y, PLAYER_RADIUS, w))) break;
        lastX = x;
        lastY = y;
      }
      state.events.push({ t: 'blink', id: p.id, x1: r2(p.x), y1: r2(p.y), x2: r2(lastX), y2: r2(lastY) });
      p.x = lastX;
      p.y = lastY;
      return true;
    }
    case 'volt': {
      p.overchargeShots = ABILITY.overchargeShots;
      p.overchargeUntil = state.time + ABILITY.overchargeWindow;
      state.events.push({ t: 'overcharge', id: p.id });
      return true;
    }
    case 'decoy': {
      state.decoys = state.decoys.filter((d) => d.owner !== p.id);
      state.decoys.push({
        id: state.nextId++, owner: p.id, x: p.x, y: p.y, aim: p.aim,
        dirX: Math.cos(p.aim), dirY: Math.sin(p.aim), hp: ABILITY.decoyHp,
        expiresAt: state.time + ABILITY.decoyDuration, fireReadyAt: state.time + 0.2,
      });
      state.events.push({ t: 'decoy', id: p.id });
      return true;
    }
    // Passive abilities have nothing to press.
    case 'echo': {
      // Everyone the ping reaches shows up for the pinger's team, walls or not.
      const hits = [...state.players.values()]
        .filter((o) => o.alive && o.id !== p.id && !sameTeam(state, o.id, p.id))
        .map((o) => o.id);
      // The wave covers the whole map: its radius reaches the far corner from wherever Echo stands.
      const reach = Math.max(
        Math.hypot(p.x, p.y), Math.hypot(state.map.w - p.x, p.y),
        Math.hypot(p.x, state.map.h - p.y), Math.hypot(state.map.w - p.x, state.map.h - p.y),
      );
      state.events.push({ t: 'sonar', id: p.id, x: r2(p.x), y: r2(p.y), r: r2(reach), hits });
      return true;
    }
    // A passive has nothing to press.
    case 'chameleon':
      return false;
  }
}

/** Chameleon's passive: vanish after standing still. */
function updatePassive(state: GameState, p: PlayerState): void {
  if (p.hero !== 'chameleon') return;
  const hide = state.time - p.stillSince >= ABILITY.hideDelay;
  if (hide && !p.hidden) state.events.push({ t: 'hide', id: p.id, x: r2(p.x), y: r2(p.y) });
  p.hidden = hide;
}

function tryPickup(state: GameState, p: PlayerState): void {
  let best: Pickup | null = null;
  let bestD = PICKUP_RADIUS;
  for (const k of state.pickups) {
    if (k.kind === 'heal' || k.kind === 'power') continue;
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (!best) return;
  state.pickups = state.pickups.filter((k) => k !== best);
  const dropOld = (kind: 'gun' | 'util', item: WeaponId) =>
    state.pickups.push({ id: state.nextId++, kind, item, x: p.x, y: p.y, expiresAt: state.time + DROP_LIFETIME });
  if (best.kind === 'gun') {
    const gun = best.item as GunId;
    if (state.mode === 'ladder') return;
    const slot = GUNS[gun].slot;
    if (p[slot] !== gun) dropOld('gun', p[slot]);
    p[slot] = gun;
    p.ammo[slot] = GUNS[gun].magazine;
    if (p.slot === slot) {
      p.gun = gun;
      p.reloadAt = 0;
      p.burstLeft = 0;
    }
    p.fireReadyAt = Math.max(p.fireReadyAt, state.time + 0.2);
  } else {
    if (state.mode === 'ladder') return;
    const util = best.item as UtilId;
    if (p.utility !== util && p.utilCharges > 0) dropOld('util', p.utility);
    p.utility = util;
    p.utilCharges = UTILS[util].charges;
  }
  state.events.push({ t: 'pickup', id: p.id, item: best.item as WeaponId });
}

function switchSlot(state: GameState, p: PlayerState, want: 1 | 2): void {
  const slot = want === 1 ? 'primary' : 'secondary';
  if (p.slot === slot) return;
  // The ladder has one weapon, so changing slots must not grant a second magazine.
  if (state.mode === 'ladder') return;
  p.reloadAt = 0;
  p.burstLeft = 0;
  p.slot = slot;
  p.gun = p[slot];
  p.fireReadyAt = Math.max(p.fireReadyAt, state.time + 0.25);
  state.events.push({ t: 'weaponSwap', id: p.id });
}

/** Lob the utility at the cursor on a real arc: it clears any wall while it is high enough. */
function throwUtil(state: GameState, p: PlayerState): void {
  if (p.utilCharges <= 0 || state.time < p.throwReadyAt) return;
  const heal = UTILS[p.utility].heal;
  if (heal) {
    // Drinkables are used on the spot. Not at full health, so a charge isn't wasted.
    if (p.hp >= MAX_HP) return;
    p.hp = Math.min(MAX_HP, p.hp + heal);
    p.utilCharges--;
    p.throwReadyAt = state.time + THROW.cooldown;
    reveal(state, p);
    state.events.push({ t: 'heal', id: p.id, x: r2(p.x), y: r2(p.y) });
    return;
  }
  if (UTILS[p.utility].deploy) {
    deployTurret(state, p);
    reveal(state, p);
    p.utilCharges--;
    p.throwReadyAt = state.time + THROW.cooldown;
    p.shieldUntil = Math.min(p.shieldUntil, state.time);
    return;
  }
  const dist = clamp(p.aimDist, THROW.minDistance, THROW.maxDistance);
  const T = throwFlightTime(dist);
  const dx = Math.cos(p.aim);
  const dy = Math.sin(p.aim);
  const x = p.x + dx * 0.7;
  const y = p.y + dy * 0.7;
  const speed = (dist - 0.7) / T;
  const vz = ((THROW.gravity * T * T) / 2 - THROW.releaseHeight) / T;
  state.throwables.push({
    id: state.nextId++, owner: p.id, util: p.utility, x, y, z: THROW.releaseHeight,
    vx: dx * speed, vy: dy * speed, vz, landed: false, fuseAt: Infinity,
  });
  p.utilCharges--;
  p.throwReadyAt = state.time + THROW.cooldown;
  p.shieldUntil = Math.min(p.shieldUntil, state.time);
  reveal(state, p);
  state.events.push({ t: 'throw', id: p.id, util: p.utility });
}

/** Set a turret down just in front of the player, or at their feet if that spot is blocked. One each. */
function deployTurret(state: GameState, p: PlayerState): void {
  const walls = state.map.walls;
  const r = TURRET.radius;
  let x = p.x + Math.cos(p.aim) * TURRET.placeDistance;
  let y = p.y + Math.sin(p.aim) * TURRET.placeDistance;
  const blocked = x < r || y < r || x > state.map.w - r || y > state.map.h - r || walls.some((w) => circleOverlapsRect(x, y, r, w));
  if (blocked) {
    x = p.x;
    y = p.y;
  }
  for (const old of state.turrets.filter((t) => t.owner === p.id)) {
    state.events.push({ t: 'turretEnd', x: r2(old.x), y: r2(old.y), broken: false });
  }
  state.turrets = state.turrets.filter((t) => t.owner !== p.id);
  state.turrets.push({
    id: state.nextId++, owner: p.id, team: p.team, x, y, aim: p.aim, hp: TURRET.hp,
    expiresAt: state.time + TURRET.duration, fireReadyAt: state.time + 0.5,
  });
  state.events.push({ t: 'turret', id: p.id, x: r2(x), y: r2(y) });
}

/** Turn toward the nearest enemy in sight and fire once lined up. The spring slows it near the end. */
function updateTurrets(state: GameState, dt: number): void {
  for (const t of state.turrets) {
    let target: PlayerState | null = null;
    let best = TURRET.range;
    for (const p of state.players.values()) {
      if (!p.alive || p.id === t.owner || sameTeam(state, p.id, t.owner)) continue;
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      // Hidden players slip past unless they walk right up to it.
      if (isHidden(state, p) && d > ABILITY.hiddenSpotRange) continue;
      if (d < best && hasLineOfSight(state, t.x, t.y, p.x, p.y)) {
        best = d;
        target = p;
      }
    }
    if (!target) continue;
    const want = Math.atan2(target.y - t.y, target.x - t.x);
    let diff = want - t.aim;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const step = TURRET.turnRate * dt;
    t.aim += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    if (Math.abs(diff) > TURRET.fireCone || state.time < t.fireReadyAt) continue;
    const left = t.expiresAt - state.time;
    const slow = left < TURRET.windDown ? 2 - left / TURRET.windDown : 1;
    t.fireReadyAt = state.time + TURRET.cooldown * slow;
    const a = t.aim + (state.rng() - 0.5) * TURRET.spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    state.bullets.push({
      id: state.nextId++, owner: t.owner, gun: 'pistol',
      x: t.x + dx * (TURRET.radius + 0.2), y: t.y + dy * (TURRET.radius + 0.2),
      dx, dy, travelled: 0, fake: false, bounces: 0, turret: true,
    });
    state.events.push({ t: 'shot', id: `turret:${t.id}`, gun: 'pistol', x: r2(t.x), y: r2(t.y), a: r2(t.aim) });
  }
}

function updateThrowables(state: GameState, dt: number): void {
  const walls = state.map.walls;
  const steps = 4;
  const h = dt / steps;
  const done: Throwable[] = [];
  for (const g of state.throwables) {
    for (let i = 0; i < steps; i++) {
      const px = g.x;
      const py = g.y;
      g.x += g.vx * h;
      g.y += g.vy * h;
      g.z += g.vz * h;
      g.vz -= THROW.gravity * h;
      // The arena border is a hard edge at any height.
      const m = 1.15;
      if (g.x < m || g.x > state.map.w - m) {
        g.x = px;
        g.vx *= -0.4;
      }
      if (g.y < m || g.y > state.map.h - m) {
        g.y = py;
        g.vy *= -0.4;
      }
      // Inner walls only stop it once it has dropped below their top.
      if (g.z < THROW.wallHeight && walls.some((w) => pointInRect(g.x, g.y, w, 0.1))) {
        const hitX = walls.some((w) => pointInRect(g.x, py, w, 0.1));
        const hitY = walls.some((w) => pointInRect(px, g.y, w, 0.1));
        g.x = px;
        g.y = py;
        if (hitX || !hitY) g.vx *= -0.4;
        if (hitY || !hitX) g.vy *= -0.4;
      }
      if (g.z <= 0) {
        g.z = 0;
        if (!g.landed) {
          g.landed = true;
          g.fuseAt = state.time + UTILS[g.util].fuseAfterLanding;
        }
        g.vz = Math.abs(g.vz) > 2 ? -g.vz * 0.3 : 0;
        g.vx *= 0.55;
        g.vy *= 0.55;
      }
    }
    if (state.time >= g.fuseAt) done.push(g);
  }
  if (!done.length) return;
  state.throwables = state.throwables.filter((g) => !done.includes(g));
  for (const g of done) detonate(state, g);
}

function detonate(state: GameState, g: Throwable): void {
  const def = UTILS[g.util];
  if (g.util === 'frag') {
    explode(state, g.x, g.y, g.owner, 'frag', def.damage, def.radius, def.knockback);
  } else if (g.util === 'flash') {
    state.events.push({ t: 'flash', x: r2(g.x), y: r2(g.y) });
    for (const p of state.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d > def.radius || !hasLineOfSight(state, g.x, g.y, p.x, p.y)) continue;
      if (sameTeam(state, p.id, g.owner)) continue;
      const full = FLASH.min + (FLASH.max - FLASH.min) * (1 - d / def.radius);
      p.blindUntil = Math.max(p.blindUntil, state.time + (p.id === g.owner ? full * 0.5 : full));
    }
  } else {
    state.smokes.push({ id: state.nextId++, x: g.x, y: g.y, r: def.radius, expiresAt: state.time + THROW.smokeDuration });
    state.events.push({ t: 'smoke', x: r2(g.x), y: r2(g.y) });
  }
}

// ---------- tick ----------

export function tick(state: GameState, dt: number): void {
  state.events = [];
  state.time += dt;

  if (state.phase === 'ended') {
    if (state.time >= state.endsAt) resetMatch(state);
    return;
  }

  const walls = state.map.walls;

  for (const p of state.players.values()) {
    if (!p.alive) {
      if (state.time >= p.respawnAt && (p.bot || p.wantRespawn)) spawn(state, p);
      continue;
    }
    if (p.vx !== 0 || p.vy !== 0) {
      moveCircle(p, p.vx * dt, p.vy * dt, walls);
      const decay = Math.exp(-7 * dt);
      p.vx *= decay;
      p.vy *= decay;
      if (Math.abs(p.vx) + Math.abs(p.vy) < 0.05) p.vx = p.vy = 0;
    }
    if (p.wantAbility) {
      p.wantAbility = false;
      const def = HEROES[p.hero];
      if (def.kind === 'cooldown' && state.time >= p.abilityReadyAt) {
        const ok = useAbility(state, p);
        p.abilityReadyAt = state.time + (ok ? def.cooldown : 0.5);
      } else if (def.kind === 'charge' && p.abilityCharge >= (def.charge ?? 0)) {
        if (useAbility(state, p)) p.abilityCharge = 0;
      }
    }
    updatePassive(state, p);
    if (p.wantPickup) {
      p.wantPickup = false;
      tryPickup(state, p);
    }
    if (p.wantSlot) {
      switchSlot(state, p, p.wantSlot);
      p.wantSlot = 0;
    }
    if (p.wantThrow) {
      p.wantThrow = false;
      throwUtil(state, p);
    }
    if (p.reloadAt && state.time >= p.reloadAt) {
      p.ammo[p.slot] = GUNS[p.gun].magazine;
      p.reloadAt = 0;
    }
    if (p.wantReload) {
      p.wantReload = false;
      startReload(state, p);
    }
    if (!p.reloadAt && p.ammo[p.slot] === 0) startReload(state, p);
    if (!p.reloadAt && p.burstLeft > 0 && state.time >= p.burstAt) {
      if (GUNS[p.gun].burst) {
        shoot(state, p);
        p.burstLeft--;
        p.burstAt = state.time + (GUNS[p.gun].burstGap ?? 0.07);
      } else {
        p.burstLeft = 0;
      }
    } else if (!p.reloadAt && p.fire && p.burstLeft === 0 && state.time >= p.fireReadyAt) {
      fireGun(state, p);
    }
    if (p.ammo[p.slot] === 0) startReload(state, p);
    collectHeals(state, p);
    collectPowers(state, p);
  }
  if (state.time >= state.nextPowerAt) dropPower(state);
  if (state.hill) updateHill(state, state.hill, dt);

  updateDecoys(state, dt, walls);
  updateTurrets(state, dt);
  updateBullets(state, dt);
  updateThrowables(state, dt);

  const t = state.time;
  state.pickups = state.pickups.filter((k) => k.expiresAt > t);
  state.smokes = state.smokes.filter((sm) => sm.expiresAt > t);
  for (const tr of state.turrets) {
    if (tr.expiresAt <= t) state.events.push({ t: 'turretEnd', x: r2(tr.x), y: r2(tr.y), broken: false });
  }
  state.turrets = state.turrets.filter((tr) => tr.expiresAt > t);
  for (const d of [...state.decoys]) if (d.expiresAt <= t) popDecoy(state, d);

}

/** Heals are picked up by walking over them, but only when you are hurt. */
function collectHeals(state: GameState, p: PlayerState): void {
  if (p.hp >= MAX_HP) return;
  const k = state.pickups.find((k) => k.kind === 'heal' && Math.hypot(k.x - p.x, k.y - p.y) < PICKUP_RADIUS * 0.8);
  if (!k) return;
  state.pickups = state.pickups.filter((o) => o !== k);
  p.hp = Math.min(MAX_HP, p.hp + HEAL_AMOUNT);
  state.events.push({ t: 'heal', id: p.id, x: r2(k.x), y: r2(k.y) });
}

/** Power-ups are taken by walking over them once they have landed. */
function collectPowers(state: GameState, p: PlayerState): void {
  const k = state.pickups.find((k) => k.kind === 'power' && state.time >= (k.readyAt ?? 0) && Math.hypot(k.x - p.x, k.y - p.y) < PICKUP_RADIUS * 0.8);
  if (!k) return;
  const power = k.item as PowerId;
  state.pickups = state.pickups.filter((o) => o !== k);
  p.powers[power] = state.time + POWERS[power].duration;
  state.events.push({ t: 'power', id: p.id, power, x: r2(k.x), y: r2(k.y) });
}

/** Mark a clear spot away from everyone; the power-up lands there after a short warning. */
function dropPower(state: GameState): void {
  state.nextPowerAt = state.time + POWER.every + state.rng() * POWER.jitter;
  if (state.pickups.filter((k) => k.kind === 'power').length >= POWER.maxOnMap) return;
  const spot = findDropSpot(state);
  if (!spot) return;
  const power = POWER_IDS[Math.floor(state.rng() * POWER_IDS.length)];
  const readyAt = state.time + POWER.warnTime;
  state.pickups.push({ id: state.nextId++, kind: 'power', item: power, x: spot.x, y: spot.y, readyAt, expiresAt: readyAt + POWER.lifetime });
  state.events.push({ t: 'powerDrop', power, x: r2(spot.x), y: r2(spot.y) });
}

function findDropSpot(state: GameState): { x: number; y: number } | null {
  const { w, h } = state.map;
  const walls = state.map.walls;
  const alive = [...state.players.values()].filter((p) => p.alive);
  for (let i = 0; i < 40; i++) {
    const x = 2 + state.rng() * (w - 4);
    const y = 2 + state.rng() * (h - 4);
    if (walls.some((wl) => circleOverlapsRect(x, y, 1.2, wl))) continue;
    if (alive.some((p) => Math.hypot(p.x - x, p.y - y) < POWER.minPlayerDist)) continue;
    if (state.pickups.some((k) => k.kind === 'power' && Math.hypot(k.x - x, k.y - y) < 6)) continue;
    return { x, y };
  }
  return null;
}

/** King of the Toybox: one player alone in the ring banks a point per second. */
function updateHill(state: GameState, hill: Hill, dt: number): void {
  if (state.phase !== 'playing') return;
  const inside = [...state.players.values()].filter((p) => p.alive && Math.hypot(p.x - hill.x, p.y - hill.y) < hill.r);
  hill.contested = inside.length > 1;
  const holder = inside.length === 1 ? inside[0] : null;
  if (!holder || holder.id !== hill.holder) hill.progress = 0;
  hill.holder = holder?.id ?? null;
  if (!holder) return;
  hill.progress += dt;
  while (hill.progress >= 1) {
    hill.progress -= 1;
    holder.score++;
    if (holder.score >= MODES.hill.target) {
      endMatch(state, holder.id);
      return;
    }
  }
}

function updateDecoys(state: GameState, dt: number, walls: Rect[]): void {
  for (const d of state.decoys) {
    const before = { x: d.x, y: d.y };
    moveCircle(d, d.dirX * PLAYER_SPEED * dt, d.dirY * PLAYER_SPEED * dt, walls);
    const moved = Math.hypot(d.x - before.x, d.y - before.y);
    if (moved < PLAYER_SPEED * dt * 0.3) {
      // Stuck on a wall: turn 90 degrees, alternating direction for variety.
      const turn = state.rng() < 0.5 ? 1 : -1;
      const nx = -d.dirY * turn;
      const ny = d.dirX * turn;
      d.dirX = nx;
      d.dirY = ny;
    }
    // Aim at the nearest enemy in range, otherwise where it's running.
    let target: PlayerState | null = null;
    let bestD = 10;
    for (const p of state.players.values()) {
      if (!p.alive || p.id === d.owner) continue;
      const dd = Math.hypot(p.x - d.x, p.y - d.y);
      if (dd < bestD) {
        bestD = dd;
        target = p;
      }
    }
    d.aim = target ? Math.atan2(target.y - d.y, target.x - d.x) : Math.atan2(d.dirY, d.dirX);
    if (target && state.time >= d.fireReadyAt) {
      d.fireReadyAt = state.time + ABILITY.decoyFireCooldown;
      const owner = state.players.get(d.owner);
      const gun = owner?.gun ?? 'pistol';
      const dx = Math.cos(d.aim);
      const dy = Math.sin(d.aim);
      state.bullets.push({
        id: state.nextId++, owner: d.owner, gun,
        x: d.x + dx * (PLAYER_RADIUS + 0.15), y: d.y + dy * (PLAYER_RADIUS + 0.15),
        dx, dy, travelled: 0, fake: true, bounces: 0,
      });
      state.events.push({ t: 'shot', id: `decoy:${d.id}`, gun, x: r2(d.x), y: r2(d.y), a: r2(d.aim) });
    }
  }
}

const BULLET_RADIUS = 0.12;

function updateBullets(state: GameState, dt: number): void {
  const survivors: Bullet[] = [];
  outer: for (const b of state.bullets) {
    const def = GUNS[b.gun];
    const move = def.speed * dt;
    const mult = b.mult ?? 1;
    const hitDamage = () => (b.turret ? TURRET.damage : bulletDamage(b.gun, b.travelled)) * mult;
    const steps = Math.max(1, Math.ceil(move / 0.35));
    const stepLen = move / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.dx * stepLen;
      b.y += b.dy * stepLen;
      b.travelled += stepLen;

      const hitMap = state.map.walls.some((w) => pointInRect(b.x, b.y, w, BULLET_RADIUS));
      if (hitMap && b.bounces > 0) {
        bounce(state, b, stepLen);
        continue;
      }
      if (hitMap) {
        if (def.splashRadius && !b.fake) explodeGun(state, b.x - b.dx * 0.3, b.y - b.dy * 0.3, b.owner, b.gun, mult);
        continue outer;
      }
      for (const p of state.players.values()) {
        if (!p.alive || p.id === b.owner || sameTeam(state, p.id, b.owner)) continue;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (PLAYER_RADIUS + BULLET_RADIUS) ** 2) {
          if (!b.fake) {
            if (def.splashRadius) explodeGun(state, b.x, b.y, b.owner, b.gun, mult);
            else {
              if (def.slow && state.time >= p.shieldUntil) p.slowUntil = Math.max(p.slowUntil, state.time + def.slow);
              damagePlayer(state, p, hitDamage(), b.owner, b.turret ? 'turret' : b.gun);
              if (def.knockback) {
                p.vx += b.dx * def.knockback;
                p.vy += b.dy * def.knockback;
              }
            }
          }
          continue outer;
        }
      }
      for (const d of state.decoys) {
        if (d.owner === b.owner) continue;
        if ((d.x - b.x) ** 2 + (d.y - b.y) ** 2 < (PLAYER_RADIUS + BULLET_RADIUS) ** 2) {
          if (!b.fake) {
            if (def.splashRadius) explodeGun(state, b.x, b.y, b.owner, b.gun, mult);
            else {
              d.hp -= hitDamage();
              if (d.hp <= 0) popDecoy(state, d);
            }
          }
          continue outer;
        }
      }
      for (const t of state.turrets) {
        if (t.owner === b.owner || sameTeam(state, t.owner, b.owner)) continue;
        if ((t.x - b.x) ** 2 + (t.y - b.y) ** 2 < (TURRET.radius + BULLET_RADIUS) ** 2) {
          if (!b.fake) {
            if (def.splashRadius) explodeGun(state, b.x, b.y, b.owner, b.gun, mult);
            else damageTurret(state, t, hitDamage());
          }
          continue outer;
        }
      }
      if (b.travelled >= def.range) {
        if (def.splashRadius && !b.fake) explodeGun(state, b.x, b.y, b.owner, b.gun, mult);
        continue outer;
      }
    }
    survivors.push(b);
  }
  state.bullets = survivors;
}

/** Step back out of the wall and mirror whichever axis ran into it. */
function bounce(state: GameState, b: Bullet, stepLen: number): void {
  const walls = state.map.walls;
  const px = b.x - b.dx * stepLen;
  const py = b.y - b.dy * stepLen;
  const blockedX = walls.some((w) => pointInRect(b.x, py, w, BULLET_RADIUS));
  const blockedY = walls.some((w) => pointInRect(px, b.y, w, BULLET_RADIUS));
  b.x = px;
  b.y = py;
  if (blockedX || !blockedY) b.dx = -b.dx;
  if (blockedY || !blockedX) b.dy = -b.dy;
  b.bounces--;
}

export function resetMatch(state: GameState): void {
  if (state.nextMap) {
    state.map = MAPS[state.nextMap];
    state.nextMap = null;
    if (state.hill) {
      state.hill.x = state.map.w / 2;
      state.hill.y = state.map.h / 2;
      state.hill.r = Math.min(state.map.w, state.map.h) * 0.12;
    }
  }
  state.phase = 'playing';
  state.winner = null;
  state.bullets = [];
  state.pickups = [];
  state.throwables = [];
  state.smokes = [];
  state.turrets = [];
  state.teamScores = [0, 0];
  state.nextPowerAt = state.time + POWER.firstAfter;
  if (state.hill) {
    state.hill.holder = null;
    state.hill.contested = false;
    state.hill.progress = 0;
  }
  state.decoys = [];
  for (const p of state.players.values()) {
    p.kills = 0;
    p.deaths = 0;
    p.score = 0;
    p.bestStreak = 0;
    p.damageDealt = 0;
    p.abilityCharge = 0;
    p.weaponKills = {};
    p.alive = false;
  }
  for (const p of state.players.values()) spawn(state, p);
}

export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
