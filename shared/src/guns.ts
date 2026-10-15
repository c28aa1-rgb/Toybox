export type GunId = 'pistol' | 'minismg' | 'thumper' | 'bouncer' | 'stinger' | 'smg' | 'burst' | 'shotgun' | 'sniper' | 'rocket';

export type GunSlot = 'primary' | 'secondary';

export interface GunDef {
  id: GunId;
  slot: GunSlot;
  name: string;
  blurb: string;
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  magazine: number;
  /** Seconds to refill a magazine; reserve ammo is unlimited. */
  reloadTime: number;
  speed: number;
  range: number;
  pellets: number;
  /** Total spread cone in radians. */
  spread: number;
  /** Rockets explode on impact or at max range. */
  splashRadius?: number;
  knockback?: number;
  /** Shots per trigger pull; the extra shots follow `burstGap` seconds apart. */
  burst?: number;
  burstGap?: number;
  /** Times a bullet ricochets off walls before it stops. */
  bounces?: number;
  /** Seconds a hit slows the target. */
  slow?: number;
  /** Damage grows with distance travelled: `near` at the muzzle up to `far` once the round has flown `fullAt` of its range. */
  ramp?: { near: number; far: number; fullAt: number };
}

export const GUNS: Record<GunId, GunDef> = {
  pistol: {
    magazine: 12, reloadTime: 1.2,
    id: 'pistol', slot: 'secondary', name: 'Pea Shooter', blurb: 'Reliable. Hits where you point it.',
    damage: 19, cooldown: 0.3, speed: 26, range: 15, pellets: 1, spread: 0.04,
  },
  minismg: {
    magazine: 20, reloadTime: 1.4,
    id: 'minismg', slot: 'secondary', name: 'Mini Buzz', blurb: 'Pocket sprayer. Fast and sloppy.',
    damage: 7, cooldown: 0.075, speed: 26, range: 9, pellets: 1, spread: 0.22,
  },
  thumper: {
    magazine: 6, reloadTime: 1.6,
    id: 'thumper', slot: 'secondary', name: 'Thumper', blurb: 'Hand cannon. Slow, heavy, shoves people back.',
    damage: 36, cooldown: 0.65, speed: 32, range: 12, pellets: 1, spread: 0.03, knockback: 1.6,
  },
  bouncer: {
    magazine: 10, reloadTime: 1.4,
    id: 'bouncer', slot: 'secondary', name: 'Bouncer', blurb: 'Rubber rounds bounce off walls twice. Shoot around corners.',
    damage: 17, cooldown: 0.34, speed: 24, range: 22, pellets: 1, spread: 0.04, bounces: 2,
  },
  stinger: {
    magazine: 16, reloadTime: 1.4,
    id: 'stinger', slot: 'secondary', name: 'Stinger', blurb: 'Light darts. Every hit slows the target for a moment.',
    damage: 11, cooldown: 0.2, speed: 30, range: 11, pellets: 1, spread: 0.08, slow: 0.9,
  },
  smg: {
    magazine: 24, reloadTime: 1.6,
    id: 'smg', slot: 'primary', name: 'Buzzbox', blurb: 'Sprays fast, loses accuracy at range.',
    damage: 9, cooldown: 0.09, speed: 28, range: 11, pellets: 1, spread: 0.16,
  },
  burst: {
    magazine: 24, reloadTime: 1.7,
    id: 'burst', slot: 'primary', name: 'Tri-Pop', blurb: 'Three-round bursts. Accurate at mid range.',
    damage: 15, cooldown: 0.5, speed: 34, range: 17, pellets: 1, spread: 0.05, burst: 3, burstGap: 0.07,
  },
  shotgun: {
    magazine: 6, reloadTime: 1.9,
    id: 'shotgun', slot: 'primary', name: 'Boomstick', blurb: 'Six pellets. Get close.',
    damage: 11, cooldown: 0.85, speed: 22, range: 7.5, pellets: 6, spread: 0.42, knockback: 1.2,
  },
  sniper: {
    magazine: 4, reloadTime: 2.1,
    id: 'sniper', slot: 'primary', name: 'Longshot', blurb: 'Hits harder the farther it flies. One-shots at long range.',
    damage: 72, ramp: { near: 40, far: 100, fullAt: 0.8 }, cooldown: 1.35, speed: 60, range: 34, pellets: 1, spread: 0,
  },
  rocket: {
    magazine: 2, reloadTime: 2.3,
    id: 'rocket', slot: 'primary', name: 'Party Popper', blurb: 'Slow rocket, big splash, sends people flying.',
    damage: 58, cooldown: 1.4, speed: 14, range: 18, pellets: 1, spread: 0,
    splashRadius: 2.6, knockback: 7,
  },
};

/** Damage for a round that has flown `travelled` metres. Only guns with a ramp change with distance. */
export function bulletDamage(gun: GunId, travelled: number): number {
  const def = GUNS[gun];
  if (!def.ramp) return def.damage;
  const k = Math.min(1, travelled / (def.range * def.ramp.fullAt));
  return def.ramp.near + (def.ramp.far - def.ramp.near) * k;
}

export const GUN_IDS = Object.keys(GUNS) as GunId[];
export const PRIMARY_IDS = GUN_IDS.filter((g) => GUNS[g].slot === 'primary');
export const SECONDARY_IDS = GUN_IDS.filter((g) => GUNS[g].slot === 'secondary');

export function isGunId(v: unknown): v is GunId {
  return typeof v === 'string' && v in GUNS;
}

export function isPrimary(v: unknown): v is GunId {
  return isGunId(v) && GUNS[v].slot === 'primary';
}

export function isSecondary(v: unknown): v is GunId {
  return isGunId(v) && GUNS[v].slot === 'secondary';
}
