import {
  DROP_LIFETIME, HEAL_AMOUNT, HEAL_LIFETIME, MATCH_END_TIME, MAX_HP, STREAK_CALLS,
  MAX_INPUT_DT, PICKUP_RADIUS, PLAYER_RADIUS, PLAYER_SPEED, RESPAWN_TIME, SCOPE_SPEED, SCOPE_SPREAD, SPAWN_SHIELD,
} from './constants';
import { GUNS, bulletDamage, type GunId } from './guns';
import { ABILITY, HEROES, type HeroId } from './heroes';
import { DEFAULT_MAP, MAPS, type MapDef, type MapId, type Rect } from './map';
import type { GameEvent, InputFrame, Loadout, WeaponId } from './protocol';
import { SLOW_FACTOR, THROW, UTILS, throwFlightTime, type UtilId } from './utilities';
import { GUN_LADDER, MODES, type ModeId } from './modes';

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
}

export interface Pickup {
  id: number;
  kind: 'gun' | 'util' | 'heal';
  item: WeaponId | 'heal';
  x: number;
  y: number;
  expiresAt: number;
}

export interface DynWall extends Rect {
  id: number;
  owner: string;
  hp: number;
  expiresAt: number;
}

export interface Bubble {
  id: number;
  owner: string;
  x: number;
  y: number;
  r: number;
  expiresAt: number;
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

export interface Goo {
  id: number;
  owner: string;
  team: number;
  x: number;
  y: number;
  r: number;
  expiresAt: number;
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
  goos: Goo[];
  mode: ModeId;
  teamScores: [number, number];
  hill: Hill | null;
  walls: DynWall[];
  bubbles: Bubble[];
  decoys: Decoy[];
  events: GameEvent[];
  map: MapDef;
  rng: () => number;
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
    goos: [],
    mode,
    teamScores: [0, 0],
    hill: mode === 'hill' ? { x: map.w / 2, y: map.h / 2, r: Math.min(map.w, map.h) * 0.12, holder: null, contested: false, progress: 0 } : null,
    walls: [],
    bubbles: [],
    decoys: [],
    events: [],
    map,
    rng: mulberry32(seed),
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

export interface BubbleLike {
  x: number;
  y: number;
  r: number;
  owner: string;
}

/** Movement multiplier from enemy time bubbles. The owner is never slowed by their own bubble. */
export function bubbleFactor(x: number, y: number, ownerId: string, bubbles: BubbleLike[], factor: number): number {
  for (const b of bubbles) {
    if (b.owner === ownerId) continue;
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy < b.r * b.r) return factor;
  }
  return 1;
}

export function inAnyBubble(x: number, y: number, bubbles: BubbleLike[]): boolean {
  return bubbles.some((b) => (x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r);
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
  ownerId: string,
  walls: Rect[],
  bubbles: BubbleLike[],
  scoped = false,
  slowed = false,
): void {
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  if (len === 0) return;
  const f = bubbleFactor(pos.x, pos.y, ownerId, bubbles, ABILITY.bubbleMoveFactor) * (scoped ? SCOPE_SPEED : 1) * (slowed ? SLOW_FACTOR : 1);
  moveCircle(pos, mx * PLAYER_SPEED * f * dt, my * PLAYER_SPEED * f * dt, walls);
}

/** True when (x, y) sits in a goo puddle that `id` (on `team`) is not immune to. */
export function inEnemyGoo(goos: { x: number; y: number; r: number; owner: string; team: number }[], x: number, y: number, id: string, team: number): boolean {
  return goos.some((g) => g.owner !== id && (team < 0 || g.team !== team) && (x - g.x) ** 2 + (y - g.y) ** 2 < g.r * g.r);
}

export function isSlowed(state: GameState, p: PlayerState): boolean {
  return state.time < p.slowUntil || inEnemyGoo(state.goos, p.x, p.y, p.id, p.team);
}

export function sameTeam(state: GameState, a: string, b: string): boolean {
  if (!MODES[state.mode].teams || a === b) return false;
  const pa = state.players.get(a);
  const pb = state.players.get(b);
  return !!pa && !!pb && pa.team === pb.team;
}

export function allWalls(state: GameState): Rect[] {
  return state.walls.length ? [...state.map.walls, ...state.walls] : state.map.walls;
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
  };
  state.players.set(p.id, p);
  spawn(state, p);
  return p;
}

export function removePlayer(state: GameState, id: string): void {
  state.players.delete(id);
  state.decoys = state.decoys.filter((d) => d.owner !== id);
  state.walls = state.walls.filter((w) => w.owner !== id);
  state.bubbles = state.bubbles.filter((b) => b.owner !== id);
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
  p.scoped = !!frame.scope;
  stepMovement(p, mx, my, dt, p.id, allWalls(state), state.bubbles, p.scoped, isSlowed(state, p));
  p.fire = !!frame.fire;
  if (frame.ability) p.wantAbility = true;
  if (frame.pickup) p.wantPickup = true;
  if (frame.reload === true) p.wantReload = true;
  if (frame.slot === 1 || frame.slot === 2) p.wantSlot = frame.slot;
  if (frame.throw) p.wantThrow = true;
}

/** Line of sight between two points: blocked by walls and by smoke clouds. */
export function hasLineOfSight(state: GameState, x1: number, y1: number, x2: number, y2: number): boolean {
  const walls = allWalls(state);
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
  const dealt = Math.min(dmg, Math.max(0, target.hp));
  target.hp -= dmg;
  const attacker = state.players.get(by);
  if (attacker && attacker.id !== target.id) attacker.damageDealt += dealt;
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

function damageWall(state: GameState, wall: DynWall, dmg: number): void {
  wall.hp -= dmg;
  if (wall.hp <= 0) {
    state.walls = state.walls.filter((w) => w !== wall);
    state.events.push({ t: 'wallBreak', x: r2(wall.x + wall.w / 2), y: r2(wall.y + wall.h / 2) });
  }
}

function popDecoy(state: GameState, d: Decoy): void {
  state.decoys = state.decoys.filter((o) => o !== d);
  state.events.push({ t: 'decoyPop', x: r2(d.x), y: r2(d.y) });
}

function explodeGun(state: GameState, x: number, y: number, owner: string, gun: GunId): void {
  const def = GUNS[gun];
  explode(state, x, y, owner, gun, def.damage, def.splashRadius ?? 0, def.knockback ?? 0);
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
  for (const w of [...state.walls]) {
    if (circleOverlapsRect(x, y, radius, w)) damageWall(state, w, def.damage * 0.75);
  }
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
      dx, dy, travelled: 0, fake: false, bounces: def.bounces ?? 0,
    });
  }
  state.events.push({ t: 'shot', id: p.id, gun: p.gun, x: r2(p.x), y: r2(p.y), a: r2(p.aim) });
  if (def.knockback && !def.splashRadius) {
    // Shotgun recoil.
    p.vx -= Math.cos(p.aim) * def.knockback * 2;
    p.vy -= Math.sin(p.aim) * def.knockback * 2;
  }
}

function cursorPoint(p: PlayerState, maxDist: number): { x: number; y: number } {
  const d = Math.min(p.aimDist, maxDist);
  return { x: p.x + Math.cos(p.aim) * d, y: p.y + Math.sin(p.aim) * d };
}

function useAbility(state: GameState, p: PlayerState): boolean {
  const walls = allWalls(state);
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
    case 'swap': {
      const c = cursorPoint(p, ABILITY.swapRange);
      type Cand = { x: number; y: number; set: (x: number, y: number) => void; id: string };
      const cands: Cand[] = [];
      for (const o of state.players.values()) {
        if (o.id === p.id || !o.alive) continue;
        cands.push({ x: o.x, y: o.y, id: o.id, set: (x, y) => { o.x = x; o.y = y; } });
      }
      for (const d of state.decoys) {
        if (d.owner === p.id) continue;
        cands.push({ x: d.x, y: d.y, id: d.owner, set: (x, y) => { d.x = x; d.y = y; } });
      }
      let best: Cand | null = null;
      let bestD = Infinity;
      for (const cd of cands) {
        if (Math.hypot(cd.x - p.x, cd.y - p.y) > ABILITY.swapRange) continue;
        const d = Math.hypot(cd.x - c.x, cd.y - c.y);
        if (d < bestD) {
          bestD = d;
          best = cd;
        }
      }
      if (!best) return false;
      if (inAnyBubble(best.x, best.y, state.bubbles)) {
        state.events.push({ t: 'swapFail', id: p.id });
        return false;
      }
      const px = p.x;
      const py = p.y;
      p.x = best.x;
      p.y = best.y;
      best.set(px, py);
      state.events.push({ t: 'swap', id: p.id, target: best.id });
      return true;
    }
    case 'chrono': {
      const c = cursorPoint(p, ABILITY.bubbleMaxDistance);
      state.bubbles = state.bubbles.filter((b) => b.owner !== p.id);
      state.bubbles.push({
        id: state.nextId++, owner: p.id, x: c.x, y: c.y, r: ABILITY.bubbleRadius,
        expiresAt: state.time + ABILITY.bubbleDuration,
      });
      state.events.push({ t: 'bubble', id: p.id, x: r2(c.x), y: r2(c.y) });
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
    case 'builder': {
      const dx = Math.cos(p.aim);
      const dy = Math.sin(p.aim);
      const cx = p.x + dx * ABILITY.wallDistance;
      const cy = p.y + dy * ABILITY.wallDistance;
      // Wall runs perpendicular to the dominant aim axis.
      const vertical = Math.abs(dx) > Math.abs(dy);
      const w = vertical ? ABILITY.wallThickness : ABILITY.wallLength;
      const h = vertical ? ABILITY.wallLength : ABILITY.wallThickness;
      const mine = state.walls.filter((wl) => wl.owner === p.id);
      if (mine.length >= ABILITY.wallsPerPlayer) {
        const oldest = mine[0];
        state.walls = state.walls.filter((wl) => wl !== oldest);
      }
      state.walls.push({
        id: state.nextId++, owner: p.id, x: cx - w / 2, y: cy - h / 2, w, h,
        hp: ABILITY.wallHp, expiresAt: state.time + ABILITY.wallDuration,
      });
      state.events.push({ t: 'wall', id: p.id, x: r2(cx), y: r2(cy) });
      return true;
    }
  }
}

function tryPickup(state: GameState, p: PlayerState): void {
  let best: Pickup | null = null;
  let bestD = PICKUP_RADIUS;
  for (const k of state.pickups) {
    if (k.kind === 'heal') continue;
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
    state.events.push({ t: 'heal', id: p.id, x: r2(p.x), y: r2(p.y) });
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
  state.events.push({ t: 'throw', id: p.id, util: p.utility });
}

function updateThrowables(state: GameState, dt: number): void {
  const walls = allWalls(state);
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
      const full = 0.6 + 2.6 * (1 - d / def.radius);
      p.blindUntil = Math.max(p.blindUntil, state.time + (p.id === g.owner ? full * 0.5 : full));
    }
  } else if (g.util === 'goo') {
    const owner = state.players.get(g.owner);
    state.goos.push({ id: state.nextId++, owner: g.owner, team: owner?.team ?? -1, x: g.x, y: g.y, r: def.radius, expiresAt: state.time + THROW.gooDuration });
    state.events.push({ t: 'goo', x: r2(g.x), y: r2(g.y) });
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

  const walls = allWalls(state);

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
      if (state.time >= p.abilityReadyAt) {
        const ok = useAbility(state, p);
        p.abilityReadyAt = state.time + (ok ? HEROES[p.hero].cooldown : 0.5);
      }
    }
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
  }
  if (state.hill) updateHill(state, state.hill, dt);

  updateDecoys(state, dt, walls);
  updateBullets(state, dt);
  updateThrowables(state, dt);

  const t = state.time;
  state.walls = state.walls.filter((w) => w.expiresAt > t);
  state.bubbles = state.bubbles.filter((b) => b.expiresAt > t);
  state.pickups = state.pickups.filter((k) => k.expiresAt > t);
  state.smokes = state.smokes.filter((sm) => sm.expiresAt > t);
  state.goos = state.goos.filter((g) => g.expiresAt > t);
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
    const f = bubbleFactor(d.x, d.y, d.owner, state.bubbles, ABILITY.bubbleMoveFactor);
    moveCircle(d, d.dirX * PLAYER_SPEED * f * dt, d.dirY * PLAYER_SPEED * f * dt, walls);
    const moved = Math.hypot(d.x - before.x, d.y - before.y);
    if (moved < PLAYER_SPEED * f * dt * 0.3) {
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
    const f = bubbleFactor(b.x, b.y, b.owner, state.bubbles, ABILITY.bubbleBulletFactor);
    const move = def.speed * f * dt;
    const steps = Math.max(1, Math.ceil(move / 0.35));
    const stepLen = move / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.dx * stepLen;
      b.y += b.dy * stepLen;
      b.travelled += stepLen;

      const hitMap = state.map.walls.some((w) => pointInRect(b.x, b.y, w, BULLET_RADIUS));
      const wall = hitMap ? null : state.walls.find((w) => pointInRect(b.x, b.y, w, BULLET_RADIUS));
      if ((hitMap || wall) && b.bounces > 0) {
        bounce(state, b, stepLen);
        continue;
      }
      if (hitMap) {
        if (def.splashRadius && !b.fake) explodeGun(state, b.x - b.dx * 0.3, b.y - b.dy * 0.3, b.owner, b.gun);
        continue outer;
      }
      if (wall) {
        if (!b.fake) {
          if (def.splashRadius) explodeGun(state, b.x - b.dx * 0.3, b.y - b.dy * 0.3, b.owner, b.gun);
          else damageWall(state, wall, def.damage);
        }
        continue outer;
      }
      for (const p of state.players.values()) {
        if (!p.alive || p.id === b.owner || sameTeam(state, p.id, b.owner)) continue;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (PLAYER_RADIUS + BULLET_RADIUS) ** 2) {
          if (!b.fake) {
            if (def.splashRadius) explodeGun(state, b.x, b.y, b.owner, b.gun);
            else {
              if (def.slow && state.time >= p.shieldUntil) p.slowUntil = Math.max(p.slowUntil, state.time + def.slow);
              damagePlayer(state, p, bulletDamage(b.gun, b.travelled), b.owner, b.gun);
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
            if (def.splashRadius) explodeGun(state, b.x, b.y, b.owner, b.gun);
            else {
              d.hp -= bulletDamage(b.gun, b.travelled);
              if (d.hp <= 0) popDecoy(state, d);
            }
          }
          continue outer;
        }
      }
      if (b.travelled >= def.range) {
        if (def.splashRadius && !b.fake) explodeGun(state, b.x, b.y, b.owner, b.gun);
        continue outer;
      }
    }
    survivors.push(b);
  }
  state.bullets = survivors;
}

/** Step back out of the wall and mirror whichever axis ran into it. */
function bounce(state: GameState, b: Bullet, stepLen: number): void {
  const walls = allWalls(state);
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
  state.phase = 'playing';
  state.winner = null;
  state.bullets = [];
  state.pickups = [];
  state.throwables = [];
  state.smokes = [];
  state.goos = [];
  state.teamScores = [0, 0];
  if (state.hill) {
    state.hill.holder = null;
    state.hill.contested = false;
    state.hill.progress = 0;
  }
  state.walls = [];
  state.bubbles = [];
  state.decoys = [];
  for (const p of state.players.values()) {
    p.kills = 0;
    p.deaths = 0;
    p.score = 0;
    p.bestStreak = 0;
    p.damageDealt = 0;
    p.weaponKills = {};
    p.alive = false;
  }
  for (const p of state.players.values()) spawn(state, p);
}

export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
