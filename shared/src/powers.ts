/** Mid-round power-ups: they drop onto the floor every so often and anyone can grab them. */
export const POWER_IDS = ['speed', 'damage', 'armor'] as const;
export type PowerId = (typeof POWER_IDS)[number];

export interface PowerDef {
  id: PowerId;
  name: string;
  blurb: string;
  /** Seconds the effect lasts. Grabbing the same one again restarts the clock. */
  duration: number;
  color: string;
}

export const POWERS: Record<PowerId, PowerDef> = {
  speed: { id: 'speed', name: 'Sugar Rush', blurb: 'Run 35% faster', duration: 10, color: '#FFE45C' },
  damage: { id: 'damage', name: 'Mega Pop', blurb: 'Hit 50% harder', duration: 10, color: '#FF5FA2' },
  armor: { id: 'armor', name: 'Pillow Armor', blurb: 'Take half damage', duration: 10, color: '#4FB3FF' },
};

export const POWER = {
  speedFactor: 1.35,
  damageFactor: 1.5,
  armorFactor: 0.5,
  /** First drop this long into a round, then one roughly every `every` seconds. */
  firstAfter: 15,
  every: 20,
  /** Extra random wait added to `every`, so drops can't be timed exactly. */
  jitter: 6,
  maxOnMap: 2,
  /** The drop spot is marked this long before the power-up lands and can be taken. */
  warnTime: 1.6,
  /** How long an untouched power-up stays once it has landed. */
  lifetime: 25,
  /** Drops land at least this far from any living player. */
  minPlayerDist: 5,
};

export function isPowerId(v: unknown): v is PowerId {
  return typeof v === 'string' && (POWER_IDS as readonly string[]).includes(v);
}
