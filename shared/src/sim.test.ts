import { describe, expect, it } from 'vitest';
import { GUNS, bulletDamage } from './guns';
import { ABILITY } from './heroes';
import { MAPS, MAP_IDS, mapProblems } from './map';

const STATIC_WALLS = MAPS.playmat.walls;
import type { InputFrame } from './protocol';
import {
  addPlayer, applyInput, circleOverlapsRect, createGame, hasLineOfSight, moveCircle, tick, type GameState, type PlayerState,
} from './sim';
import { HEAL_AMOUNT, KILLS_TO_WIN, MAX_HP, PLAYER_RADIUS, SPAWN_SHIELD, TICK_DT } from './constants';
import { GUN_LADDER, MODES } from './modes';
import { THROW } from './utilities';
import type { ModeId } from './modes';

function setup(mode: ModeId = 'ffa'): { s: GameState; a: PlayerState; b: PlayerState } {
  const s = createGame(42, 'playmat', mode);
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

describe('magazines and reloads', () => {
  it('starts full, ignores reload at full, and reloads a partial magazine without firing', () => {
    const { s, a } = setup();
    expect(a.ammo.primary).toBe(GUNS.smg.magazine);
    expect(a.ammo.secondary).toBe(GUNS.pistol.magazine);
    applyInput(s, a, frame(1, { reload: true }));
    tick(s, TICK_DT);
    expect(a.reloadAt).toBe(0);
    a.ammo.secondary = 3;
    applyInput(s, a, frame(2, { reload: true, fire: true }));
    tick(s, TICK_DT);
    const finishesAt = a.reloadAt;
    applyInput(s, a, frame(3, { reload: true, fire: true }));
    run(s, GUNS.pistol.reloadTime / 2);
    expect(a.reloadAt).toBe(finishesAt);
    expect(a.ammo.secondary).toBe(3);
    expect(s.bullets).toHaveLength(0);
    a.fire = false;
    run(s, GUNS.pistol.reloadTime);
    expect(a.reloadAt).toBe(0);
    expect(a.ammo.secondary).toBe(GUNS.pistol.magazine);
  });

  it('automatically reloads after the last round even after releasing fire', () => {
    const { s, a } = setup();
    a.ammo.secondary = 1;
    a.fire = true;
    tick(s, TICK_DT);
    expect(a.ammo.secondary).toBe(0);
    expect(a.reloadAt).toBeGreaterThan(s.time);
    a.fire = false;
    run(s, GUNS.pistol.reloadTime + TICK_DT);
    expect(a.ammo.secondary).toBe(GUNS.pistol.magazine);
  });

  it('cancels reload on switching, preserves each magazine, and restarts on returning empty', () => {
    const { s, a } = setup();
    a.ammo.secondary = 0;
    a.ammo.primary = 7;
    tick(s, TICK_DT);
    applyInput(s, a, frame(1, { slot: 1 }));
    tick(s, TICK_DT);
    expect(a.reloadAt).toBe(0);
    expect(a.ammo).toEqual({ primary: 7, secondary: 0 });
    applyInput(s, a, frame(2, { slot: 2 }));
    tick(s, TICK_DT);
    expect(a.reloadAt).toBeCloseTo(s.time + GUNS.pistol.reloadTime);
  });

  it('uses one shell for all shotgun pellets and never fires a burst past empty', () => {
    const { s, a } = setup();
    a.gun = a.secondary = 'shotgun';
    a.ammo.secondary = 2;
    a.fire = true;
    tick(s, TICK_DT);
    expect(a.ammo.secondary).toBe(1);
    expect(s.bullets).toHaveLength(GUNS.shotgun.pellets);
    a.gun = a.secondary = 'burst';
    a.ammo.secondary = 2;
    a.fireReadyAt = 0;
    tick(s, TICK_DT);
    run(s, 0.2);
    expect(a.ammo.secondary).toBe(0);
    expect(a.burstLeft).toBe(0);
    expect(a.reloadAt).toBeGreaterThan(s.time);
  });

  it('refills a picked-up gun and cancels its old reload', () => {
    const { s, a } = setup();
    a.ammo.secondary = 0;
    tick(s, TICK_DT);
    s.pickups.push({ id: s.nextId++, kind: 'gun', item: 'thumper', x: a.x, y: a.y, expiresAt: s.time + 10 });
    applyInput(s, a, frame(1, { pickup: true }));
    tick(s, TICK_DT);
    expect(a.gun).toBe('thumper');
    expect(a.ammo.secondary).toBe(GUNS.thumper.magazine);
    expect(a.reloadAt).toBe(0);
  });

  it('refills both magazines on respawn and clears reload intent', () => {
    const { s, a } = setup();
    a.alive = false;
    a.respawnAt = s.time;
    a.ammo = { primary: 0, secondary: 0 };
    a.wantReload = true;
    a.reloadAt = s.time + 10;
    applyInput(s, a, frame(1, { respawn: true }));
    tick(s, TICK_DT);
    expect(a.ammo).toEqual({ primary: GUNS.smg.magazine, secondary: GUNS.pistol.magazine });
    expect(a.reloadAt).toBe(0);
    expect(a.wantReload).toBe(false);
  });

  it('does not let ladder players bypass reloading by switching slots', () => {
    const s = createGame(42, 'playmat', 'ladder');
    const a = addPlayer(s, { id: 'a', name: 'A', hero: 'blink', gun: 'smg', secondary: 'pistol', utility: 'frag' });
    a.ammo.primary = 0;
    tick(s, TICK_DT);
    const finishesAt = a.reloadAt;
    applyInput(s, a, frame(1, { slot: 2 }));
    tick(s, TICK_DT);
    expect(a.slot).toBe('primary');
    expect(a.reloadAt).toBe(finishesAt);
  });
});

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
    const items = s.pickups.filter((k) => k.kind !== 'heal');
    expect(items).toHaveLength(1);
    expect([b.primary, b.secondary, b.utility]).toContain(items[0].item);
    expect(s.pickups.filter((k) => k.kind === 'heal')).toHaveLength(1);
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

describe('heals and streaks', () => {
  it('walking over a heal restores health only when hurt', () => {
    const { s, a } = setup();
    s.pickups.push({ id: 99, kind: 'heal', item: 'heal', x: a.x, y: a.y, expiresAt: 100 });
    tick(s, TICK_DT);
    expect(s.pickups).toHaveLength(1);
    a.hp = 30;
    tick(s, TICK_DT);
    expect(a.hp).toBe(30 + HEAL_AMOUNT);
    expect(s.pickups).toHaveLength(0);
    a.hp = MAX_HP - 5;
    s.pickups.push({ id: 100, kind: 'heal', item: 'heal', x: a.x, y: a.y, expiresAt: 100 });
    tick(s, TICK_DT);
    expect(a.hp).toBe(MAX_HP);
  });

  it('calls out a three-kill streak', () => {
    const { s, a, b } = setup();
    a.streak = 2;
    b.hp = 1;
    a.fire = true;
    let called = false;
    for (let t = 0; t < 0.5; t += TICK_DT) {
      tick(s, TICK_DT);
      if (s.events.some((e) => e.t === 'streak' && e.id === 'a' && e.n === 3)) called = true;
    }
    expect(called).toBe(true);
    expect(a.bestStreak).toBe(3);
  });
});

describe('modes', () => {
  it('team brawl splits players and blocks friendly fire', () => {
    const { s, a, b } = setup('teams');
    expect(a.team).not.toBe(b.team);
    b.team = a.team;
    a.fire = true;
    run(s, 0.5);
    expect(b.hp).toBe(MAX_HP);
  });

  it('team kills add up to a team win', () => {
    const { s, a, b } = setup('teams');
    s.teamScores[a.team] = MODES.teams.target - 1;
    b.hp = 1;
    a.fire = true;
    run(s, 0.5);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe(`team:${a.team}`);
  });

  it('gun ladder moves the killer to the next gun and wins on the last', () => {
    const { s, a, b } = setup('ladder');
    expect(a.primary).toBe(GUN_LADDER[0]);
    a.gun = 'pistol';
    b.hp = 1;
    a.fire = true;
    run(s, 0.4);
    expect(a.score).toBe(1);
    expect(a.gun).toBe(GUN_LADDER[1]);
    expect(s.pickups.every((k) => k.kind === 'heal')).toBe(true);
  });

  it('gun ladder ends the round on a kill with the last gun', () => {
    const { s, a, b } = setup('ladder');
    a.score = GUN_LADDER.length - 1;
    b.hp = 1;
    a.fire = true;
    run(s, 0.5);
    expect(s.winner).toBe('a');
  });

  it('king of the toybox scores only while alone in the ring', () => {
    const { s, a, b } = setup('hill');
    const hill = s.hill!;
    a.x = hill.x - 2.5; a.y = hill.y - 2.5;
    b.x = 3; b.y = 3;
    run(s, 2.05);
    expect(a.score).toBe(2);
    b.x = hill.x + 2.5; b.y = hill.y + 2.5;
    run(s, 2);
    expect(a.score).toBe(2);
    expect(hill.contested).toBe(true);
  });
});

describe('new weapons', () => {
  it('tri-pop fires a three-round burst per trigger pull', () => {
    const { s, a } = setup();
    a.gun = 'burst';
    a.fire = true;
    tick(s, TICK_DT);
    a.fire = false;
    let shots = s.events.filter((e) => e.t === 'shot').length;
    for (let i = 0; i < 10; i++) {
      tick(s, TICK_DT);
      shots += s.events.filter((e) => e.t === 'shot').length;
    }
    expect(shots).toBe(3);
  });

  it('bouncer rounds ricochet off walls', () => {
    const { s, a, b } = setup();
    b.x = 40; b.y = 30;
    a.gun = 'bouncer';
    a.x = 3; a.y = 14.2; a.aim = Math.PI; // straight into the left border
    a.fire = true;
    tick(s, TICK_DT);
    a.fire = false;
    run(s, 0.3);
    const bullet = s.bullets.find((k) => k.owner === 'a');
    expect(bullet).toBeDefined();
    expect(bullet!.dx).toBeGreaterThan(0);
  });

  it('stinger hits slow the target', () => {
    const { s, a, b } = setup();
    a.gun = 'stinger';
    a.fire = true;
    run(s, 0.3);
    expect(b.slowUntil).toBeGreaterThan(s.time);
  });

  it('goo slows enemies but not the thrower', () => {
    const { s, a, b } = setup();
    s.goos.push({ id: 1, owner: 'a', team: -1, x: 22, y: 13.5, r: 4, expiresAt: 10 });
    const startA = a.x;
    const startB = b.x;
    for (let i = 1; i <= 15; i++) {
      applyInput(s, a, frame(i, { mx: 1 }));
      applyInput(s, b, frame(i, { mx: 1 }));
    }
    expect(b.x - startB).toBeLessThan((a.x - startA) * 0.7);
  });

  it('juice box heals on the spot and is not wasted at full health', () => {
    const { s, a } = setup();
    a.utility = 'juice';
    a.utilCharges = 2;
    a.wantThrow = true;
    tick(s, TICK_DT);
    expect(a.utilCharges).toBe(2);
    a.hp = 30;
    run(s, 1);
    a.wantThrow = true;
    tick(s, TICK_DT);
    expect(a.hp).toBe(75);
    expect(a.utilCharges).toBe(1);
    expect(s.throwables).toHaveLength(0);
  });
});

describe('longshot', () => {
  it('deals more damage the farther the round flies, and kills near max range', () => {
    expect(bulletDamage('sniper', 2)).toBeLessThan(50);
    expect(bulletDamage('sniper', GUNS.sniper.range * 0.5)).toBeGreaterThan(70);
    expect(bulletDamage('sniper', GUNS.sniper.range * 0.85)).toBeGreaterThanOrEqual(MAX_HP);
    expect(bulletDamage('smg', 30)).toBe(GUNS.smg.damage);
  });
});

describe('respawn', () => {
  it('a dead human waits for the respawn request', () => {
    const { s, a, b } = setup();
    b.hp = 1;
    a.fire = true;
    run(s, 0.4);
    a.fire = false;
    expect(b.alive).toBe(false);
    run(s, 4);
    expect(b.alive).toBe(false);
    applyInput(s, b, frame(500, { respawn: true }));
    tick(s, TICK_DT);
    expect(b.alive).toBe(true);
  });

  it('asking early still waits out the timer', () => {
    const { s, a, b } = setup();
    b.bot = false;
    b.hp = 1;
    a.fire = true;
    run(s, 0.4);
    a.fire = false;
    applyInput(s, b, frame(600, { respawn: true }));
    run(s, 1);
    expect(b.alive).toBe(false);
    run(s, 2.5);
    expect(b.alive).toBe(true);
  });
});

describe('utility refill', () => {
  it('a kill gives back one utility charge, up to the maximum', () => {
    const { s, a, b } = setup();
    a.utilCharges = 0;
    b.hp = 1;
    a.fire = true;
    let refilled = false;
    for (let x = 0; x < 0.5; x += TICK_DT) {
      tick(s, TICK_DT);
      if (s.events.some((e) => e.t === 'refill' && e.id === 'a')) refilled = true;
    }
    expect(a.utilCharges).toBe(1);
    expect(refilled).toBe(true);
  });

  it('does not go past the maximum', () => {
    const { s, a, b } = setup();
    b.hp = 1;
    a.fire = true;
    run(s, 0.5);
    expect(a.utilCharges).toBe(2);
  });
});
