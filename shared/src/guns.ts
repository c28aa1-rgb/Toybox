export type GunId = 'pistol' | 'minismg' | 'thumper' | 'smg' | 'shotgun' | 'sniper' | 'rocket';

export type GunSlot = 'primary' | 'secondary';

export interface GunDef {
  id: GunId;
  slot: GunSlot;
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
    id: 'pistol', slot: 'secondary', name: 'Pea Shooter', blurb: 'Reliable. Hits where you point it.',
    damage: 19, cooldown: 0.3, speed: 26, range: 15, pellets: 1, spread: 0.04, unlockKills: 0,
  },
  minismg: {
    id: 'minismg', slot: 'secondary', name: 'Mini Buzz', blurb: 'Pocket sprayer. Fast and sloppy.',
    damage: 7, cooldown: 0.075, speed: 26, range: 9, pellets: 1, spread: 0.22, unlockKills: 0,
  },
  thumper: {
    id: 'thumper', slot: 'secondary', name: 'Thumper', blurb: 'Hand cannon. Slow, heavy, shoves people back.',
    damage: 36, cooldown: 0.65, speed: 32, range: 12, pellets: 1, spread: 0.03, knockback: 1.6, unlockKills: 0,
  },
  smg: {
    id: 'smg', slot: 'primary', name: 'Buzzbox', blurb: 'Sprays fast, loses accuracy at range.',
    damage: 9, cooldown: 0.09, speed: 28, range: 11, pellets: 1, spread: 0.16, unlockKills: 0,
  },
  shotgun: {
    id: 'shotgun', slot: 'primary', name: 'Boomstick', blurb: 'Six pellets. Get close.',
    damage: 11, cooldown: 0.85, speed: 22, range: 7.5, pellets: 6, spread: 0.42, knockback: 1.2, unlockKills: 5,
  },
  sniper: {
    id: 'sniper', slot: 'primary', name: 'Longshot', blurb: 'One slow, heavy round across the map.',
    damage: 72, cooldown: 1.35, speed: 60, range: 50, pellets: 1, spread: 0, unlockKills: 15,
  },
  rocket: {
    id: 'rocket', slot: 'primary', name: 'Party Popper', blurb: 'Slow rocket, big splash, sends people flying.',
    damage: 58, cooldown: 1.4, speed: 14, range: 18, pellets: 1, spread: 0,
    splashRadius: 2.6, knockback: 7, unlockKills: 30,
  },
};

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
