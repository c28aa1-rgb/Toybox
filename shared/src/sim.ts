import {
  ARENA_H, ARENA_W, DROP_LIFETIME, KILLS_TO_WIN, MAP_PICKUP_INTERVAL, MATCH_END_TIME, MAX_HP,
  MAX_INPUT_DT, PICKUP_RADIUS, PLAYER_RADIUS, PLAYER_SPEED, RESPAWN_TIME, SPAWN_SHIELD,
} from './constants';
import { GUNS, type GunId } from './guns';
import { ABILITY, HEROES, type HeroId } from './heroes';
import { PICKUP_SPAWNS, SPAWN_POINTS, STATIC_WALLS, type Rect } from './map';
import type { GameEvent, InputFrame, Loadout } from './protocol';

// ---------- state ----------

export interface PlayerState {
  id: string;
  name: string;
  bot: boolean;
  loadout: Loadout;
  hero: HeroId;
  gun: GunId;
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
  wantAbility: boolean;
  wantPickup: boolean;
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
}

export interface Pickup {
  id: number;
  gun: GunId;
  x: number;
  y: number;
  expiresAt: number | null;
  spawnIndex: number | null;
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

export interface GameState {
  time: number;
  nextId: number;
  phase: 'playing' | 'ended';
  winner: string | null;
  endsAt: number;
  players: Map<string, PlayerState>;
  bullets: Bullet[];
  pickups: Pickup[];
  walls: DynWall[];
  bubbles: Bubble[];
  decoys: Decoy[];
  events: GameEvent[];
  mapPickupAt: number[];
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

export function createGame(seed = Date.now()): GameState {
  return {
    time: 0,
    nextId: 1,
    phase: 'playing',
    winner: null,
    endsAt: 0,
    players: new Map(),
    bullets: [],
    pickups: [],
    walls: [],
    bubbles: [],
    decoys: [],
    events: [],
    mapPickupAt: PICKUP_SPAWNS.map(() => 10),
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
  p.x = clamp(p.x, r, ARENA_W - r);
  p.y = clamp(p.y, r, ARENA_H - r);
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
): void {
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  if (len === 0) return;
  const f = bubbleFactor(pos.x, pos.y, ownerId, bubbles, ABILITY.bubbleMoveFactor);
  moveCircle(pos, mx * PLAYER_SPEED * f * dt, my * PLAYER_SPEED * f * dt, walls);
}

export function allWalls(state: GameState): Rect[] {
  return state.walls.length ? [...STATIC_WALLS, ...state.walls] : STATIC_WALLS;
}

// ---------- players ----------

export function addPlayer(
  state: GameState,
  opts: { id: string; name: string; hero: HeroId; gun: GunId; bot?: boolean },
): PlayerState {
  const p: PlayerState = {
    id: opts.id,
    name: opts.name,
    bot: !!opts.bot,
    loadout: { hero: opts.hero, gun: opts.gun },
    hero: opts.hero,
    gun: opts.gun,
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
    wantAbility: false,
    wantPickup: false,
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
  const others = [...state.players.values()].filter((o) => o.id !== p.id && o.alive);
  let best = SPAWN_POINTS[0];
  let bestScore = -1;
  for (const s of SPAWN_POINTS) {
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
  p.aim = Math.atan2(ARENA_H / 2 - p.y, ARENA_W / 2 - p.x);
  p.hero = p.loadout.hero;
  p.gun = p.loadout.gun;
  p.hp = MAX_HP;
  p.alive = true;
  p.shieldUntil = state.time + SPAWN_SHIELD;
  p.fireReadyAt = state.time;
  p.abilityReadyAt = state.time;
  p.fire = false;
  p.wantAbility = false;
  p.wantPickup = false;
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
  if (!p.alive || state.phase !== 'playing') return;
  const dt = clamp(Number.isFinite(frame.dt) ? frame.dt : 0, 0, MAX_INPUT_DT);
  const mx = clamp(frame.mx || 0, -1, 1);
  const my = clamp(frame.my || 0, -1, 1);
  stepMovement(p, mx, my, dt, p.id, allWalls(state), state.bubbles);
  p.fire = !!frame.fire;
  if (frame.ability) p.wantAbility = true;
  if (frame.pickup) p.wantPickup = true;
}

// ---------- damage ----------

function damagePlayer(state: GameState, target: PlayerState, dmg: number, by: string, gun: GunId): void {
  if (!target.alive || state.time < target.shieldUntil || state.phase !== 'playing') return;
  target.hp -= dmg;
  state.events.push({ t: 'hit', target: target.id, by, dmg: Math.round(dmg), x: r2(target.x), y: r2(target.y) });
  if (target.hp <= 0) killPlayer(state, target, by, gun);
}

function killPlayer(state: GameState, victim: PlayerState, killerId: string, gun: GunId): void {
  victim.hp = 0;
  victim.alive = false;
  victim.fire = false;
  victim.respawnAt = state.time + RESPAWN_TIME;
  victim.deaths++;
  state.events.push({ t: 'kill', killer: killerId, victim: victim.id, gun });
  state.pickups.push({
    id: state.nextId++, gun: victim.gun, x: victim.x, y: victim.y,
    expiresAt: state.time + DROP_LIFETIME, spawnIndex: null,
  });
  const killer = state.players.get(killerId);
  if (killer && killer.id !== victim.id) {
    killer.kills++;
    if (killer.kills >= KILLS_TO_WIN && state.phase === 'playing') {
      state.phase = 'ended';
      state.winner = killer.id;
      state.endsAt = state.time + MATCH_END_TIME;
      state.events.push({ t: 'win', id: killer.id });
    }
  }
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

function explode(state: GameState, x: number, y: number, owner: string, gun: GunId): void {
  const def = GUNS[gun];
  const radius = def.splashRadius ?? 0;
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

function fireGun(state: GameState, p: PlayerState): void {
  const def = GUNS[p.gun];
  p.fireReadyAt = state.time + def.cooldown;
  p.shieldUntil = Math.min(p.shieldUntil, state.time);
  for (let i = 0; i < def.pellets; i++) {
    let a = p.aim;
    if (def.pellets > 1) {
      a += -def.spread / 2 + (def.spread * i) / (def.pellets - 1) + (state.rng() - 0.5) * 0.06;
    } else {
      a += (state.rng() - 0.5) * def.spread;
    }
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    state.bullets.push({
      id: state.nextId++, owner: p.id, gun: p.gun,
      x: p.x + dx * (PLAYER_RADIUS + 0.15), y: p.y + dy * (PLAYER_RADIUS + 0.15),
      dx, dy, travelled: 0, fake: false,
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
        if (x < PLAYER_RADIUS || x > ARENA_W - PLAYER_RADIUS || y < PLAYER_RADIUS || y > ARENA_H - PLAYER_RADIUS) break;
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
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (!best) return;
  state.pickups = state.pickups.filter((k) => k !== best);
  if (best.spawnIndex !== null) state.mapPickupAt[best.spawnIndex] = state.time + MAP_PICKUP_INTERVAL;
  if (best.gun !== p.gun) {
    state.pickups.push({
      id: state.nextId++, gun: p.gun, x: p.x, y: p.y,
      expiresAt: state.time + DROP_LIFETIME, spawnIndex: null,
    });
  }
  p.gun = best.gun;
  p.fireReadyAt = Math.max(p.fireReadyAt, state.time + 0.2);
  state.events.push({ t: 'pickup', id: p.id, gun: best.gun });
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
      if (state.time >= p.respawnAt) spawn(state, p);
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
    if (p.fire && state.time >= p.fireReadyAt) fireGun(state, p);
  }

  updateDecoys(state, dt, walls);
  updateBullets(state, dt);

  const t = state.time;
  state.walls = state.walls.filter((w) => w.expiresAt > t);
  state.bubbles = state.bubbles.filter((b) => b.expiresAt > t);
  state.pickups = state.pickups.filter((k) => k.expiresAt === null || k.expiresAt > t);
  for (const d of [...state.decoys]) if (d.expiresAt <= t) popDecoy(state, d);

  spawnMapPickups(state);
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
        dx, dy, travelled: 0, fake: true,
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

      if (STATIC_WALLS.some((w) => pointInRect(b.x, b.y, w, BULLET_RADIUS))) {
        if (def.splashRadius && !b.fake) explode(state, b.x - b.dx * 0.3, b.y - b.dy * 0.3, b.owner, b.gun);
        continue outer;
      }
      const wall = state.walls.find((w) => pointInRect(b.x, b.y, w, BULLET_RADIUS));
      if (wall) {
        if (!b.fake) {
          if (def.splashRadius) explode(state, b.x - b.dx * 0.3, b.y - b.dy * 0.3, b.owner, b.gun);
          else damageWall(state, wall, def.damage);
        }
        continue outer;
      }
      for (const p of state.players.values()) {
        if (!p.alive || p.id === b.owner) continue;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (PLAYER_RADIUS + BULLET_RADIUS) ** 2) {
          if (!b.fake) {
            if (def.splashRadius) explode(state, b.x, b.y, b.owner, b.gun);
            else {
              damagePlayer(state, p, def.damage, b.owner, b.gun);
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
            if (def.splashRadius) explode(state, b.x, b.y, b.owner, b.gun);
            else {
              d.hp -= def.damage;
              if (d.hp <= 0) popDecoy(state, d);
            }
          }
          continue outer;
        }
      }
      if (b.travelled >= def.range) {
        if (def.splashRadius && !b.fake) explode(state, b.x, b.y, b.owner, b.gun);
        continue outer;
      }
    }
    survivors.push(b);
  }
  state.bullets = survivors;
}

const PREMIUM: GunId[] = ['shotgun', 'sniper', 'rocket', 'smg'];

function spawnMapPickups(state: GameState): void {
  PICKUP_SPAWNS.forEach((s, i) => {
    if (state.time < state.mapPickupAt[i]) return;
    if (state.pickups.some((k) => k.spawnIndex === i)) return;
    const gun = PREMIUM[Math.floor(state.rng() * PREMIUM.length)];
    state.pickups.push({ id: state.nextId++, gun, x: s.x, y: s.y, expiresAt: null, spawnIndex: i });
    state.mapPickupAt[i] = Infinity;
  });
}

export function resetMatch(state: GameState): void {
  state.phase = 'playing';
  state.winner = null;
  state.bullets = [];
  state.pickups = [];
  state.walls = [];
  state.bubbles = [];
  state.decoys = [];
  state.mapPickupAt = PICKUP_SPAWNS.map(() => state.time + 10);
  for (const p of state.players.values()) {
    p.kills = 0;
    p.deaths = 0;
    p.alive = false;
  }
  for (const p of state.players.values()) spawn(state, p);
}

export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
