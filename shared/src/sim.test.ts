import { describe, expect, it } from 'vitest';
import { GUNS } from './guns';
import { ABILITY } from './heroes';
import { STATIC_WALLS } from './map';
import type { InputFrame } from './protocol';
import {
  addPlayer, applyInput, circleOverlapsRect, createGame, moveCircle, tick, type GameState, type PlayerState,
} from './sim';
import { KILLS_TO_WIN, PLAYER_RADIUS, SPAWN_SHIELD, TICK_DT } from './constants';

function setup(): { s: GameState; a: PlayerState; b: PlayerState } {
  const s = createGame(42);
  const a = addPlayer(s, { id: 'a', name: 'A', hero: 'blink', gun: 'pistol' });
  const b = addPlayer(s, { id: 'b', name: 'B', hero: 'swap', gun: 'pistol' });
  // Open floor, facing each other, shields off.
  a.x = 18; a.y = 9; a.aim = 0;
  b.x = 24; b.y = 9;
  a.shieldUntil = b.shieldUntil = -1;
  return { s, a, b };
}

function frame(seq: number, patch: Partial<InputFrame> = {}): InputFrame {
  return { seq, dt: 0.033, mx: 0, my: 0, aim: 0, aimDist: 6, fire: false, ability: false, pickup: false, ...patch };
}

function run(s: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += TICK_DT) tick(s, TICK_DT);
}

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

  it('drops the victim gun as a pickup', () => {
    const { s, a, b } = setup();
    b.gun = 'sniper';
    b.hp = 1;
    a.fire = true;
    run(s, 0.5);
    expect(b.alive).toBe(false);
    expect(s.pickups.some((k) => k.gun === 'sniper')).toBe(true);
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

describe('pickups', () => {
  it('swaps your gun and drops the old one', () => {
    const { s, a } = setup();
    s.pickups.push({ id: 999, gun: 'rocket', x: a.x + 0.5, y: a.y, expiresAt: null, spawnIndex: null });
    a.wantPickup = true;
    tick(s, TICK_DT);
    expect(a.gun).toBe('rocket');
    expect(s.pickups.some((k) => k.gun === 'pistol')).toBe(true);
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
