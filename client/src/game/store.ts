import { useSyncExternalStore } from 'react';
import type { GunId, HeroId, MapId, PlayerSnap, UtilId, WeaponId } from '@gg/shared';

export interface FeedEntry {
  key: number;
  killer: string;
  victim: string;
  gun: WeaponId;
  mine: boolean;
}

export interface ChatLine {
  key: number;
  /** null for system lines such as joins. */
  name: string | null;
  text: string;
  mine: boolean;
  at: number;
}

export interface Banner {
  key: number;
  kind: 'eliminated' | 'eliminatedBy';
  name: string;
}

export interface HudState {
  connected: boolean;
  error: string | null;
  room: string;
  host: boolean;
  myId: string | null;
  me: PlayerSnap | null;
  players: PlayerSnap[];
  phase: 'playing' | 'ended';
  winner: string | null;
  endsIn: number;
  feed: FeedEntry[];
  ping: number;
  killedBy: string | null;
  nearPickup: WeaponId | null;
  loadout: { hero: HeroId; gun: GunId; secondary: GunId; utility: UtilId };
  /** Seconds of flash blindness left for this player. */
  blind: number;
  /** Standing inside a smoke cloud: the whole view is covered. */
  smoked: boolean;
  scoreboard: boolean;
  /** Bumps on each hit you take, used to flash the vignette. */
  hurtTick: number;
  toast: { key: number; text: string } | null;
  bots: number;
  isPublic: boolean;
  map: MapId | null;
  chat: ChatLine[];
  chatOpen: boolean;
  banner: Banner | null;
  scoped: boolean;
}

type Listener = () => void;

export class HudStore {
  private state: HudState;
  private listeners = new Set<Listener>();

  constructor(initial: HudState) {
    this.state = initial;
  }

  get(): HudState {
    return this.state;
  }

  set(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useHud(store: HudStore): HudState {
  return useSyncExternalStore(store.subscribe, () => store.get());
}
