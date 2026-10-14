import { useSyncExternalStore } from 'react';
import type { GunId, HeroId, PlayerSnap } from '@gg/shared';

export interface FeedEntry {
  key: number;
  killer: string;
  victim: string;
  gun: GunId;
  mine: boolean;
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
  nearPickup: GunId | null;
  loadout: { hero: HeroId; gun: GunId };
  scoreboard: boolean;
  /** Bumps on each hit you take, used to flash the vignette. */
  hurtTick: number;
  toast: { key: number; text: string } | null;
  bots: number;
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
