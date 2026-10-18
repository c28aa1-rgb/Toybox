/**
 * Cosmetics: purely visual, unlocked by lifetime kills.
 * - paint: recolours your hero's body.
 * - trail: what you leave behind while running.
 * - killFx: how the players you knock out pop.
 */
export type PaintId = 'classic' | 'mint' | 'midnight' | 'chrome' | 'gold';
export type TrailId = 'none' | 'sparkle' | 'bubbles' | 'confetti' | 'rainbow';
export type KillFxId = 'shatter' | 'confetti' | 'squeak' | 'balloons' | 'fireworks';
export type CosmeticKind = 'paint' | 'trail' | 'killFx';

export interface CosmeticDef<Id extends string = string> {
  id: Id;
  name: string;
  blurb: string;
  /** Lifetime kills needed to use it. */
  unlockKills: number;
}

export interface PaintDef extends CosmeticDef<PaintId> {
  /** Body colour; null keeps the hero's own colour. */
  color: string | null;
  /** Soft self-glow, for the darker and shinier paints. */
  glow?: string;
}

export const PAINTS: Record<PaintId, PaintDef> = {
  classic: { id: 'classic', name: 'Classic', blurb: 'Fresh out of the box.', unlockKills: 0, color: null },
  mint: { id: 'mint', name: 'Mint Chip', blurb: 'Cool minty plastic.', unlockKills: 5, color: '#7FE3C3' },
  midnight: { id: 'midnight', name: 'Midnight', blurb: 'Deep violet with a faint glow.', unlockKills: 20, color: '#3B2A6E', glow: '#4B2F9A' },
  chrome: { id: 'chrome', name: 'Chrome', blurb: 'Polished silver.', unlockKills: 50, color: '#D7DCE6', glow: '#3A3F4A' },
  gold: { id: 'gold', name: 'Gold', blurb: 'Solid gold toy. Sparkles.', unlockKills: 100, color: '#FFC83A', glow: '#6B4A00' },
};

export const TRAILS: Record<TrailId, CosmeticDef<TrailId>> = {
  none: { id: 'none', name: 'No trail', blurb: 'Just footsteps.', unlockKills: 0 },
  sparkle: { id: 'sparkle', name: 'Sparkle', blurb: 'Little twinkles at your heels.', unlockKills: 10 },
  bubbles: { id: 'bubbles', name: 'Bubbles', blurb: 'Soap bubbles float up behind you.', unlockKills: 25 },
  confetti: { id: 'confetti', name: 'Confetti', blurb: 'A party everywhere you go.', unlockKills: 40 },
  rainbow: { id: 'rainbow', name: 'Rainbow', blurb: 'A ribbon of every colour.', unlockKills: 75 },
};

export const KILL_FX: Record<KillFxId, CosmeticDef<KillFxId>> = {
  shatter: { id: 'shatter', name: 'Shatter', blurb: 'They burst into plastic bits.', unlockKills: 0 },
  confetti: { id: 'confetti', name: 'Confetti Pop', blurb: 'A cannon of confetti and a party horn.', unlockKills: 15 },
  squeak: { id: 'squeak', name: 'Squeaky Toy', blurb: 'A loud squeak and a ring of stars.', unlockKills: 30 },
  balloons: { id: 'balloons', name: 'Balloons', blurb: 'A bunch of balloons floats away.', unlockKills: 60 },
  fireworks: { id: 'fireworks', name: 'Fireworks', blurb: 'Rockets go up and burst overhead.', unlockKills: 120 },
};

export const PAINT_IDS = Object.keys(PAINTS) as PaintId[];
export const TRAIL_IDS = Object.keys(TRAILS) as TrailId[];
export const KILL_FX_IDS = Object.keys(KILL_FX) as KillFxId[];

export const COSMETICS: { [K in CosmeticKind]: Record<string, CosmeticDef> } = { paint: PAINTS, trail: TRAILS, killFx: KILL_FX };
export const COSMETIC_DEFAULTS = { paint: 'classic', trail: 'none', killFx: 'shatter' } as const;

export function isPaintId(v: unknown): v is PaintId {
  return typeof v === 'string' && v in PAINTS;
}
export function isTrailId(v: unknown): v is TrailId {
  return typeof v === 'string' && v in TRAILS;
}
export function isKillFxId(v: unknown): v is KillFxId {
  return typeof v === 'string' && v in KILL_FX;
}

export function cosmeticUnlocked(kind: CosmeticKind, id: string, kills: number): boolean {
  const def = COSMETICS[kind][id];
  return !!def && def.unlockKills <= kills;
}

/** Everything unlocked at `kills`, as "kind:id" keys (used to spot new unlocks). */
export function unlockedCosmetics(kills: number): string[] {
  return (Object.keys(COSMETICS) as CosmeticKind[]).flatMap((kind) =>
    Object.values(COSMETICS[kind]).filter((d) => d.unlockKills <= kills).map((d) => `${kind}:${d.id}`));
}
