export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MapId = 'playmat' | 'brickyard' | 'crossroads' | 'bigtop';

export interface MapDef {
  id: MapId;
  name: string;
  blurb: string;
  w: number;
  h: number;
  walls: Rect[];
  spawns: { x: number; y: number }[];
  /** Only the public lobby uses this map; it isn't offered for parties. */
  publicOnly?: boolean;
}

const BORDER = 1;

function borders(w: number, h: number): Rect[] {
  return [
    { x: 0, y: 0, w, h: BORDER },
    { x: 0, y: h - BORDER, w, h: BORDER },
    { x: 0, y: BORDER, w: BORDER, h: h - 2 * BORDER },
    { x: w - BORDER, y: BORDER, w: BORDER, h: h - 2 * BORDER },
  ];
}

/** Mirror one quadrant of cover into all four. Pieces must stay inside the quadrant. */
function mirrored(w: number, h: number, quadrant: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of quadrant) {
    out.push(
      r,
      { ...r, x: w - r.x - r.w },
      { ...r, y: h - r.y - r.h },
      { ...r, x: w - r.x - r.w, y: h - r.y - r.h },
    );
  }
  return out;
}

/** Spawn candidates: corners, edge midpoints and quarter points, 3 m in from the border. */
function ringSpawns(w: number, h: number, extra: { x: number; y: number }[] = []): { x: number; y: number }[] {
  const i = 3;
  return [
    { x: i, y: i }, { x: w - i, y: i }, { x: i, y: h - i }, { x: w - i, y: h - i },
    { x: w / 2, y: i }, { x: w / 2, y: h - i }, { x: i, y: h / 2 }, { x: w - i, y: h / 2 },
    { x: w / 4, y: i }, { x: (3 * w) / 4, y: h - i }, { x: (3 * w) / 4, y: i }, { x: w / 4, y: h - i },
    ...extra,
  ];
}

function makeMap(def: Omit<MapDef, 'walls' | 'spawns'> & { center: Rect[]; quadrant: Rect[]; extraSpawns?: { x: number; y: number }[] }): MapDef {
  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    w: def.w,
    h: def.h,
    publicOnly: def.publicOnly,
    walls: [...borders(def.w, def.h), ...def.center, ...mirrored(def.w, def.h, def.quadrant)],
    spawns: ringSpawns(def.w, def.h, def.extraSpawns),
  };
}

export const MAPS: Record<MapId, MapDef> = {
  playmat: makeMap({
    id: 'playmat', name: 'Play Mat', blurb: 'Balanced cover, open centre lanes.', w: 52, h: 36,
    center: [
      { x: 24, y: 16.8, w: 4, h: 2.4 },
      { x: 17.5, y: 16.5, w: 1.2, h: 3 },
      { x: 33.3, y: 16.5, w: 1.2, h: 3 },
    ],
    quadrant: [
      { x: 6, y: 6, w: 5, h: 1.2 },
      { x: 6, y: 7.2, w: 1.2, h: 3.8 },
      { x: 16.5, y: 3.5, w: 1.2, h: 5 },
      { x: 4, y: 15, w: 5, h: 1.2 },
      { x: 12, y: 11, w: 2.4, h: 2.4 },
      { x: 20.5, y: 9, w: 4, h: 1.2 },
    ],
  }),
  brickyard: makeMap({
    id: 'brickyard', name: 'Brickyard', blurb: 'Tight corridors and short sightlines. Shotguns love it.', w: 44, h: 34,
    center: [
      { x: 20, y: 15.4, w: 4, h: 3.2 },
      { x: 13, y: 16.4, w: 1.2, h: 1.2 },
      { x: 29.8, y: 16.4, w: 1.2, h: 1.2 },
      { x: 21.4, y: 7, w: 1.2, h: 3 },
      { x: 21.4, y: 24, w: 1.2, h: 3 },
    ],
    quadrant: [
      { x: 5, y: 5, w: 1.2, h: 6 },
      { x: 6.2, y: 5, w: 4, h: 1.2 },
      { x: 14, y: 3.5, w: 1.2, h: 4 },
      { x: 12, y: 10, w: 5, h: 1.2 },
      { x: 4, y: 14, w: 4, h: 1.2 },
      { x: 17.5, y: 5.5, w: 2.4, h: 2.4 },
      { x: 9, y: 13, w: 1.2, h: 3 },
    ],
  }),
  crossroads: makeMap({
    id: 'crossroads', name: 'Crossroads', blurb: 'Four big blocks and long streets. Bring a Longshot.', w: 40, h: 40,
    center: [
      { x: 16, y: 16, w: 1.6, h: 1.6 },
      { x: 22.4, y: 16, w: 1.6, h: 1.6 },
      { x: 16, y: 22.4, w: 1.6, h: 1.6 },
      { x: 22.4, y: 22.4, w: 1.6, h: 1.6 },
      { x: 19.2, y: 5, w: 1.6, h: 2.4 },
      { x: 19.2, y: 32.6, w: 1.6, h: 2.4 },
      { x: 5, y: 19.2, w: 2.4, h: 1.6 },
      { x: 32.6, y: 19.2, w: 2.4, h: 1.6 },
    ],
    quadrant: [
      { x: 8, y: 8, w: 7, h: 7 },
      { x: 3.5, y: 12, w: 1.2, h: 3 },
      { x: 12, y: 3.5, w: 3, h: 1.2 },
    ],
  }),
  bigtop: makeMap({
    id: 'bigtop', name: 'Big Top', blurb: 'The always-on public arena. Room for everyone.', w: 76, h: 52, publicOnly: true,
    center: [
      { x: 35.5, y: 24.5, w: 5, h: 3 },
      { x: 24, y: 24.5, w: 1.2, h: 3 },
      { x: 50.8, y: 24.5, w: 1.2, h: 3 },
      { x: 36.5, y: 15, w: 3, h: 1.2 },
      { x: 36.5, y: 35.8, w: 3, h: 1.2 },
    ],
    quadrant: [
      { x: 6, y: 6, w: 6, h: 1.2 },
      { x: 6, y: 7.2, w: 1.2, h: 5 },
      { x: 16, y: 4, w: 1.2, h: 6 },
      { x: 22, y: 8, w: 6, h: 1.2 },
      { x: 12, y: 14, w: 2.4, h: 2.4 },
      { x: 4, y: 19, w: 6, h: 1.2 },
      { x: 18, y: 17, w: 1.2, h: 5 },
      { x: 28, y: 15, w: 2.4, h: 2.4 },
      { x: 31, y: 4, w: 1.2, h: 4 },
    ],
    extraSpawns: [{ x: 22, y: 13 }, { x: 54, y: 39 }, { x: 22, y: 39 }, { x: 54, y: 13 }],
  }),
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const PARTY_MAP_IDS = MAP_IDS.filter((id) => !MAPS[id].publicOnly);
export const PUBLIC_MAP: MapId = 'bigtop';
export const DEFAULT_MAP: MapId = 'playmat';

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && v in MAPS;
}

/** Overlapping walls, or spawn points with no room to stand. Used by tests. */
export function mapProblems(map: MapDef): string[] {
  const out: string[] = [];
  const w = map.walls;
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j < w.length; j++) if (overlap(w[i], w[j])) out.push(`${map.id}: walls ${i} and ${j} overlap`);
  }
  const clear = (x: number, y: number, r: number) =>
    w.every((rect) => {
      const cx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
      const cy = Math.max(rect.y, Math.min(y, rect.y + rect.h));
      return (x - cx) ** 2 + (y - cy) ** 2 >= r * r;
    });
  for (const s of map.spawns) if (!clear(s.x, s.y, 1.2)) out.push(`${map.id}: spawn ${s.x},${s.y} is cramped`);
  return out;
}
