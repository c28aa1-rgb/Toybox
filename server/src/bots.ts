import {
  GUNS, HERO_IDS, TICK_DT, allWalls, hasLineOfSight,
  type GameState, type HeroId, type InputFrame, type PlayerState, type Rect,
} from '@gg/shared';

const BOT_NAMES = ['Bolt', 'Pickle', 'Noodle', 'Sprocket', 'Biscuit', 'Gizmo', 'Pebble', 'Waffle', 'Turbo', 'Mochi'];

export function botName(i: number): string {
  return `${BOT_NAMES[i % BOT_NAMES.length]} (bot)`;
}

export function botHero(i: number): HeroId {
  return HERO_IDS[i % HERO_IDS.length];
}

interface BotMemory {
  seq: number;
  wanderAngle: number;
  wanderUntil: number;
  strafe: number;
  strafeUntil: number;
  aimError: number;
  lastX: number;
  lastY: number;
  stuckCheckAt: number;
}

const memory = new Map<string, BotMemory>();

export function forgetBot(id: string): void {
  memory.delete(id);
}


export function botInput(state: GameState, p: PlayerState): InputFrame {
  let m = memory.get(p.id);
  if (!m) {
    m = {
      seq: p.lastSeq, wanderAngle: state.rng() * Math.PI * 2, wanderUntil: 0, strafe: 1, strafeUntil: 0,
      aimError: 0, lastX: p.x, lastY: p.y, stuckCheckAt: state.time + 1,
    };
    memory.set(p.id, m);
  }
  m.seq++;
  const frame: InputFrame = {
    seq: m.seq, dt: TICK_DT, mx: 0, my: 0, aim: p.aim, aimDist: 6, fire: false, scope: false, ability: false, pickup: false, slot: 0, throw: false,
  };
  if (!p.alive || state.phase !== 'playing') return frame;

  const walls = allWalls(state);
  const rng = state.rng;

  // Unstick: if barely moved for a second, pick a new heading.
  if (state.time >= m.stuckCheckAt) {
    if (Math.hypot(p.x - m.lastX, p.y - m.lastY) < 0.8) {
      m.wanderAngle = rng() * Math.PI * 2;
      m.wanderUntil = state.time + 1.2;
    }
    m.lastX = p.x;
    m.lastY = p.y;
    m.stuckCheckAt = state.time + 1;
  }

  let target: PlayerState | null = null;
  let targetD = Infinity;
  let visible = false;
  for (const o of state.players.values()) {
    if (o.id === p.id || !o.alive) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const los = hasLineOfSight(state, p.x, p.y, o.x, o.y);
    // Prefer visible targets; a hidden one counts as farther away.
    const score = los ? d : d + 15;
    if (score < targetD) {
      targetD = score;
      target = o;
      visible = los;
    }
  }

  // Grab a better gun if one is close.
  const gunRank: Record<string, number> = { pistol: 0, minismg: 0, thumper: 0, smg: 1, shotgun: 2, sniper: 2, rocket: 3 };
  const upgrade = state.pickups.find(
    (k) => k.kind === 'gun' && GUNS[k.item as keyof typeof GUNS].slot === 'primary'
      && gunRank[k.item] > gunRank[p.primary] && Math.hypot(k.x - p.x, k.y - p.y) < 7,
  );
  // Flash-blinded bots stumble around and hold fire.
  if (state.time < p.blindUntil) {
    frame.mx = Math.cos(m.wanderAngle);
    frame.my = Math.sin(m.wanderAngle);
    if (rng() < 0.05) m.wanderAngle += Math.PI / 2;
    return frame;
  }

  let moveX = 0;
  let moveY = 0;

  if (upgrade && (!target || !visible)) {
    moveX = upgrade.x - p.x;
    moveY = upgrade.y - p.y;
    frame.pickup = Math.hypot(moveX, moveY) < 1.2;
  } else if (target && state.time >= m.wanderUntil) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const range = GUNS[p.gun].range;
    const ideal = Math.min(range * 0.6, 9);
    const approach = d > ideal + 1.5 ? 1 : d < ideal - 1.5 ? -1 : 0;
    if (state.time >= m.strafeUntil) {
      m.strafe = rng() < 0.5 ? -1 : 1;
      m.strafeUntil = state.time + 0.6 + rng() * 1.2;
      m.aimError = (rng() - 0.5) * 0.3;
    }
    moveX = (dx / d) * approach + (-dy / d) * m.strafe * 0.8;
    moveY = (dy / d) * approach + (dx / d) * m.strafe * 0.8;

    if (visible) {
      // Lead the target slightly and wobble the aim so bots are beatable.
      frame.aim = Math.atan2(dy, dx) + m.aimError * (0.5 + rng());
      frame.aimDist = d;
      frame.fire = d < range * 0.95;
      // Snipers scope up for long shots, like players do.
      frame.scope = p.gun === 'sniper' && d > 10;
      // Lob utility at mid range now and then.
      if (p.utilCharges > 0 && d > 4 && d < 12 && state.time >= p.throwReadyAt && rng() < 0.012) frame.throw = true;
      // Close in with the sidearm when the primary is a long gun.
      frame.slot = p.primary === 'sniper' && d < 6 ? 2 : p.slot === 'secondary' && d > 8 ? 1 : 0;
      if (state.time >= p.abilityReadyAt && rng() < 0.025) {
        frame.ability = shouldUseAbility(p, d);
      }
    }
    if (frame.pickup === false && upgrade && Math.hypot(upgrade.x - p.x, upgrade.y - p.y) < 1.2) frame.pickup = true;
  } else {
    if (state.time >= m.wanderUntil && !target) {
      m.wanderAngle += (rng() - 0.5) * 1.5;
      m.wanderUntil = state.time + 1;
    }
    moveX = Math.cos(m.wanderAngle);
    moveY = Math.sin(m.wanderAngle);
    if (target) {
      frame.aim = Math.atan2(target.y - p.y, target.x - p.x);
    }
  }

  const len = Math.hypot(moveX, moveY);
  if (len > 0) {
    frame.mx = moveX / len;
    frame.my = moveY / len;
  }
  if (!target || !visible) frame.aim = Math.atan2(frame.my || Math.sin(p.aim), frame.mx || Math.cos(p.aim));
  return frame;
}

function shouldUseAbility(p: PlayerState, d: number): boolean {
  switch (p.hero) {
    case 'blink':
    case 'decoy':
      return true;
    case 'swap':
      return d < 11;
    case 'chrono':
      return d < 8;
    case 'builder':
      return p.hp < 70;
  }
}
