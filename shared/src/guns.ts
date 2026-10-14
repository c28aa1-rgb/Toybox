export type GunId = 'pistol' | 'smg' | 'shotgun' | 'sniper' | 'rocket';

export interface GunDef {
  id: GunId;
  name: string;
  blurb: string;
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  speed: number;
  range: number;
  pellets: number;
  /** Total spread cone in radians. */
  spread: number;
  /** Rockets explode on impact or at max range. */
  splashRadius?: number;
  knockback?: number;
  /** Lifetime kills needed to pick this gun in the lobby. 0 = always available. */
  unlockKills: number;
}

export const GUNS: Record<GunId, GunDef> = {
  pistol: {
    id: 'pistol', name: 'Pea Shooter', blurb: 'Reliable. Hits where you point it.',
    damage: 19, cooldown: 0.3, speed: 26, range: 15, pellets: 1, spread: 0.04, unlockKills: 0,
  },
  smg: {
    id: 'smg', name: 'Buzzbox', blurb: 'Sprays fast, loses accuracy at range.',
    damage: 9, cooldown: 0.09, speed: 28, range: 11, pellets: 1, spread: 0.16, unlockKills: 0,
  },
  shotgun: {
    id: 'shotgun', name: 'Boomstick', blurb: 'Six pellets. Get close.',
    damage: 11, cooldown: 0.85, speed: 22, range: 7.5, pellets: 6, spread: 0.42, knockback: 1.2, unlockKills: 5,
  },
  sniper: {
    id: 'sniper', name: 'Longshot', blurb: 'One slow, heavy round across the map.',
    damage: 72, cooldown: 1.35, speed: 55, range: 34, pellets: 1, spread: 0, unlockKills: 15,
  },
  rocket: {
    id: 'rocket', name: 'Party Popper', blurb: 'Slow rocket, big splash, sends people flying.',
    damage: 58, cooldown: 1.4, speed: 14, range: 18, pellets: 1, spread: 0,
    splashRadius: 2.6, knockback: 7, unlockKills: 30,
  },
};

export const GUN_IDS = Object.keys(GUNS) as GunId[];

export function isGunId(v: unknown): v is GunId {
  return typeof v === 'string' && v in GUNS;
}
