export type HatId = 'none' | 'party' | 'propeller' | 'viking' | 'crown';

export interface HatDef {
  id: HatId;
  name: string;
  /** Lifetime kills needed to wear it. */
  unlockKills: number;
}

export const HATS: Record<HatId, HatDef> = {
  none: { id: 'none', name: 'No hat', unlockKills: 0 },
  party: { id: 'party', name: 'Party Hat', unlockKills: 5 },
  propeller: { id: 'propeller', name: 'Propeller Cap', unlockKills: 20 },
  viking: { id: 'viking', name: 'Horned Helmet', unlockKills: 50 },
  crown: { id: 'crown', name: 'Crown', unlockKills: 100 },
};

export const HAT_IDS = Object.keys(HATS) as HatId[];

export function isHatId(v: unknown): v is HatId {
  return typeof v === 'string' && v in HATS;
}
