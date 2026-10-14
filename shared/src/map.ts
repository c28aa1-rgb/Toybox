import { ARENA_H, ARENA_W } from './constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const T = 1; // border thickness

/** One quadrant of cover. Mirrored into the other three. */
const QUADRANT: Rect[] = [
  { x: 5, y: 5, w: 4.5, h: 1.2 },
  { x: 5, y: 5, w: 1.2, h: 4.5 },
  { x: 14, y: 3.5, w: 1.2, h: 5 },
  { x: 4, y: 13.2, w: 4.5, h: 1.2 },
  { x: 11, y: 10, w: 2.4, h: 2.4 },
];

function mirror(r: Rect, mx: boolean, my: boolean): Rect {
  return {
    x: mx ? ARENA_W - r.x - r.w : r.x,
    y: my ? ARENA_H - r.y - r.h : r.y,
    w: r.w,
    h: r.h,
  };
}

function buildWalls(): Rect[] {
  const walls: Rect[] = [
    { x: 0, y: 0, w: ARENA_W, h: T },
    { x: 0, y: ARENA_H - T, w: ARENA_W, h: T },
    { x: 0, y: 0, w: T, h: ARENA_H },
    { x: ARENA_W - T, y: 0, w: T, h: ARENA_H },
    // center block and side pillars
    { x: ARENA_W / 2 - 2, y: ARENA_H / 2 - 1.2, w: 4, h: 2.4 },
    { x: 15, y: ARENA_H / 2 - 1.5, w: 1.2, h: 3 },
    { x: ARENA_W - 15 - 1.2, y: ARENA_H / 2 - 1.5, w: 1.2, h: 3 },
  ];
  for (const r of QUADRANT) {
    walls.push(r, mirror(r, true, false), mirror(r, false, true), mirror(r, true, true));
  }
  return walls;
}

export const STATIC_WALLS: Rect[] = buildWalls();

export const SPAWN_POINTS: { x: number; y: number }[] = [
  { x: 3, y: 3 }, { x: ARENA_W - 3, y: 3 }, { x: 3, y: ARENA_H - 3 }, { x: ARENA_W - 3, y: ARENA_H - 3 },
  { x: ARENA_W / 2, y: 3 }, { x: ARENA_W / 2, y: ARENA_H - 3 },
  { x: 3, y: ARENA_H / 2 }, { x: ARENA_W - 3, y: ARENA_H / 2 },
];

/** Spots where premium guns appear on a timer. */
export const PICKUP_SPAWNS: { x: number; y: number }[] = [
  { x: ARENA_W / 2, y: ARENA_H / 2 - 4 },
  { x: ARENA_W / 2, y: ARENA_H / 2 + 4 },
  { x: 10, y: ARENA_H / 2 },
  { x: ARENA_W - 10, y: ARENA_H / 2 },
];
