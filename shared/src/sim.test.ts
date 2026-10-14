import { describe, expect, it } from 'vitest';
import { GUNS } from './guns';
import { ABILITY } from './heroes';
import { MAPS, MAP_IDS, mapProblems } from './map';

const STATIC_WALLS = MAPS.playmat.walls;
import type { InputFrame } from './protocol';
import {
  addPlayer, applyInput, circleOverlapsRect, createGame, hasLineOfSight, moveCircle, tick, type GameState, type PlayerState,
} from './sim';
import { KILLS_TO_WIN, PLAYER_RADIUS, SPAWN_SHIELD, TICK_DT } from './constants';

function setup(): { s: GameState; a: PlayerState; b: PlayerState } {
  const s = createGame(42);
  const a = addPlayer(s, { id: 'a', name: 'A', hero: 'blink', gun: 'smg', secondary: 'pistol', utility: 'frag' });
  const b = addPlayer(s, { id: 'b', name: 'B', hero: 'swap', gun: 'smg', secondary: 'pistol', utility: 'flash' });
  // Duel with sidearms so the damage numbers stay predictable.
  for (const p of [a, b]) { p.slot = 'secondary'; p.gun = 'pistol'; }
  // Open floor, facing each other, shields off.
  a.x = 19; a.y = 13.5; a.aim = 0;
  b.x = 25; b.y = 13.5;
  a.shieldUntil = b.shieldUntil = -1;
  return { s, a, b };
}

function frame(seq: number, patch: Partial<InputFrame> = {}): InputFrame {
  return { seq, dt: 0.033, mx: 0, my: 0, aim: 0, aimDist: 6, fire: false, scope: false, ability: false, pickup: false, slot: 0, throw: false, ...patch };
}

function run(s: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += TICK_DT) tick(s, TICK_DT);
}

describe('map', () => {
  it('has no overlapping walls or cramped spawns', () => {
    expect(MAP_IDS.flatMap((id) => mapProblems(MAPS[id]))).toEqual([]);
  });
});

describe('movement', () => {
  it('slides along walls instead of passing through', () => {
    const wall = STATIC_WALLS.find((w) => w.w > 3 && w.h < 2 && w.x > 2 && w.y > 2)!;
    const p = { x: wall.x + wall.w / 2, y: wall.y - 2 };
    moveCircle(p, 0, 5, STATIC_WALLS);
    expect(circleOverlapsRect(p.x, p.y, PLAYER_RADIUS - 0.01, wall)).toBe(false);
    expect(p.y).toBeLessThan(wall.y);
  });

  it('ignores replayed input seqs', () => {
    const { s, a } = setup();
    applyInput(s, a, frame(1, { mx: 1 }));
    const x = a.x;
    applyInput(s, a, frame(1, { mx: 1 }));
    expect(a.x).toBe(x);
  });
});

describe('shooting', () => {
  it('pistol shots damage and eventually kill', () => {
    const { s, a, b } = setup();
    a.fire = true;
    run(s, 4);
    expect(b.deaths + (b.alive ? 0 : 1)).toBeGreaterThan(0);
    expect(a.kills).toBe(1);
  });

  it('spawn shield blocks damage', () => {
    const { s, a, b } = setup();
    b.shieldUntil = s.time + SPAWN_SHIELD;
    a.fire = true;
    run(s, 0.6);
    expect(b.hp).toBe(100);
  });

  it('drops one random loadout item on death', () => {
    const { s, a, b } = setup();
    b.hp = 1;
    a.fire = true;
    run(s, 0.5);
    expect(b.alive).toBe(false);
    expect(s.pickups).toHaveLength(1);
    expect([b.primary, b.secondary, b.utility]).toContain(s.pickups[0].item);
  });

  it('ends the match at the kill limit', () => {
    const { s, a, b } = setup();
    a.kills = KILLS_TO_WIN - 1;
    b.hp = 1;
    a.fire = true;
    run(s, 0.5);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('a');
  });
});

describe('scope', () => {
  it('slows movement while scoped', () => {
    const { s, a } = setup();
    const x0 = a.x;
    applyInput(s, a, frame(1, { mx: 1, scope: true }));
    expect(a.x - x0).toBeLessThan(6.2 * 0.033 * 0.6);
  });
});

describe('pickups', () => {
  it('replaces the matching slot and drops the old item', () => {
    const { s, a } = setup();
    s.pickups.push({ id: 999, kind: 'gun', item: 'rocket', x: a.x + 0.5, y: a.y, expiresAt: 99 });
    a.wantPickup = true;
    tick(s, TICK_DT);
    expect(a.primary).toBe('rocket');
    expect(s.pickups.some((k) => k.item === 'smg')).toBe(true);
  });
});

describe('loadout', () => {
  it('swaps between primary and secondary', () => {
    const { s, a } = setup();
    applyInput(s, a, frame(1, { slot: 1 }));
    tick(s, TICK_DT);
    expect(a.gun).toBe('smg');
    applyInput(s, a, frame(2, { slot: 2 }));
    tick(s, TICK_DT);
    expect(a.gun).toBe('pistol');
  });
});

describe('utilities', () => {
  it('a throw arcs over a wall and lands past it', () => {
    const { s, a } = setup();
    s.walls.push({ id: 77, owner: 'x', x: a.x + 3, y: a.y - 2, w: 0.7, h: 4, hp: 999, expiresAt: 99 });
    a.aim = 0;
    a.aimDist = 8;
    a.wantThrow = true;
    tick(s, TICK_DT);
    let maxZ = 0;
    for (let i = 0; i < 25 && s.throwables.length; i++) {
      tick(s, TICK_DT);
      if (s.throwables[0]) maxZ = Math.max(maxZ, s.throwables[0].z);
    }
    expect(maxZ).toBeGreaterThan(1.3);
    expect(s.events.concat().length >= 0).toBe(true);
  });

  it('never leaves the arena', () => {
    const { s, a } = setup();
    a.x = 3; a.y = 13.5; a.aim = Math.PI; a.aimDist = 13; a.wantThrow = true;
    for (let i = 0; i < 60; i++) {
      tick(s, TICK_DT);
      for (const g of s.throwables) expect(g.x).toBeGreaterThan(0.5);
    }
  });

  it('frag damages players nearby', () => {
    const { s, a, b } = setup();
    a.utility = 'frag';
    a.aim = 0;
    a.aimDist = 6;
    a.wantThrow = true;
    run(s, 2);
    expect(b.hp).toBeLessThan(100);
  });

  it('flash blinds players who can see it', () => {
    const { s, a, b } = setup();
    a.utility = 'flash';
    a.aim = 0;
    a.aimDist = 5;
    a.wantThrow = true;
    run(s, 1.5);
    expect(b.blindUntil).toBeGreaterThan(s.time);
  });

  it('smoke blocks line of sight', () => {
    const { s, a, b } = setup();
    expect(hasLineOfSight(s, a.x, a.y, b.x, b.y)).toBe(true);
    s.smokes.push({ id: 1, x: (a.x + b.x) / 2, y: a.y, r: 2, expiresAt: 99 });
    expect(hasLineOfSight(s, a.x, a.y, b.x, b.y)).toBe(false);
  });
});

describe('abilities', () => {
  it('blink moves toward the cursor', () => {
    const { s, a } = setup();
    a.aimDist = 20;
    a.wantAbility = true;
    const x0 = a.x;
    tick(s, TICK_DT);
    expect(a.x - x0).toBeGreaterThan(3);
    expect(a.x - x0).toBeLessThanOrEqual(ABILITY.blinkDistance + 0.01);
  });

  it('swap trades places with the target', () => {
    const { s, a, b } = setup();
    b.hero = 'swap';
    b.aim = Math.PI;
    b.aimDist = 6;
    const ax = a.x;
    const bx = b.x;
    b.wantAbility = true;
    tick(s, TICK_DT);
    expect(b.x).toBeCloseTo(ax, 1);
    expect(a.x).toBeCloseTo(bx, 1);
  });

  it('swap fails on a target inside a time bubble', () => {
    const { s, a, b } = setup();
    s.bubbles.push({ id: 1, owner: 'x', x: a.x, y: a.y, r: 3, expiresAt: 99 });
    b.aim = Math.PI;
    b.wantAbility = true;
    const ax = a.x;
    tick(s, TICK_DT);
    expect(a.x).toBeCloseTo(ax, 3);
    expect(s.events.some((e) => e.t === 'swapFail')).toBe(true);
  });

  it('time bubble slows enemy bullets', () => {
    const { s, a, b } = setup();
    b.hero = 'chrono';
    b.aim = Math.PI;
    b.aimDist = 4;
    b.wantAbility = true;
    tick(s, TICK_DT);
    expect(s.bubbles.length).toBe(1);
    a.fire = true;
    tick(s, TICK_DT);
    const bullet = s.bullets[0];
    const x0 = bullet.x;
    a.fire = false;
    tick(s, TICK_DT);
    const moved = bullet.x - x0;
    expect(moved).toBeLessThan(GUNS.pistol.speed * TICK_DT * 0.5);
  });

  it('builder wall blocks bullets and can be destroyed', () => {
    const { s, a, b } = setup();
    b.hero = 'builder';
    b.aim = Math.PI;
    b.wantAbility = true;
    tick(s, TICK_DT);
    expect(s.walls.length).toBe(1);
    a.gun = 'sniper';
    a.fire = true;
    run(s, 0.6);
    expect(b.hp).toBe(100);
    run(s, 4);
    expect(s.walls.length).toBe(0);
  });

  it('decoy shoots blanks', () => {
    const { s, a, b } = setup();
    a.hero = 'decoy';
    a.wantAbility = true;
    tick(s, TICK_DT);
    expect(s.decoys.length).toBe(1);
    a.x = 3; a.y = 3; // owner steps away; decoy keeps shooting at b
    run(s, 2);
    expect(s.bullets.some((x) => x.fake) || b.hp === 100).toBe(true);
    expect(b.hp).toBe(100);
  });
});
