import { useSyncExternalStore } from 'react';
import type { SmokeFog } from './smoke';
import type { HillSnap, Loadout, MapId, MapVote, ModeId, PlayerSnap, WeaponId } from '@gg/shared';

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

/** "Noodle is on a 5 streak" style call-out. */
export interface StreakCall {
  key: number;
  name: string;
  n: number;
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
  fps: number;
  killedBy: string | null;
  nearPickup: WeaponId | null;
  loadout: Loadout;
  mode: ModeId;
  target: number;
  teamScores: [number, number];
  hill: HillSnap | null;
  streak: StreakCall | null;
  /** Seconds left on a slow from a Stinger hit. */
  slowed: boolean;
  /** Seconds of flash blindness left for this player. */
  blind: number;
  smoke: SmokeFog[];
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
  /** The living player the camera follows while you are dead. */
  spectating: PlayerSnap | null;
  /** The connection dropped and we're trying to get back in. */
  reconnecting: boolean;
  /** Public lobby results screen: the next-map vote, and what we picked. */
  vote: MapVote | null;
  myVote: MapId | null;
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
