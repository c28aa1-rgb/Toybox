import type { GunId } from './guns';
import type { HeroId } from './heroes';
import type { MapId } from './map';

/** One frame of player intent. Movement is applied for `dt` seconds. */
export interface InputFrame {
  seq: number;
  dt: number;
  /** Movement direction, each axis in [-1, 1]. */
  mx: number;
  my: number;
  aim: number;
  /** Distance from the player to the cursor on the ground, in meters. */
  aimDist: number;
  fire: boolean;
  /** Held: aiming down the scope. */
  scope: boolean;
  /** Edge-triggered: true only on the frame the key went down. */
  ability: boolean;
  pickup: boolean;
}

export interface Loadout {
  hero: HeroId;
  gun: GunId;
}

// ---- client -> server ----

export type ClientMsg =
  /** public: the always-on lobby. create: a new private room on `map`. join: a private room by code. */
  | { type: 'join'; mode: 'public' | 'create' | 'join'; room?: string; map?: MapId; name: string; hero: HeroId; gun: GunId }
  | { type: 'chat'; text: string }
  | { type: 'input'; frames: InputFrame[] }
  | { type: 'loadout'; hero: HeroId; gun: GunId }
  | { type: 'bots'; count: number }
  | { type: 'ping'; t: number };

// ---- server -> client ----

export interface PlayerSnap {
  id: string;
  name: string;
  hero: HeroId;
  gun: GunId;
  x: number;
  y: number;
  aim: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  bot: boolean;
  /** Spawn shield is active. */
  shield: boolean;
  scoped: boolean;
  respawnIn: number;
  abilityReadyIn: number;
}

export interface BulletSnap {
  id: number;
  gun: GunId;
  x: number;
  y: number;
  fake: boolean;
}

export interface PickupSnap {
  id: number;
  gun: GunId;
  x: number;
  y: number;
}

export interface WallSnap {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  owner: string;
}

export interface BubbleSnap {
  id: number;
  x: number;
  y: number;
  r: number;
  owner: string;
  endsIn: number;
}

export interface DecoySnap {
  id: number;
  owner: string;
  x: number;
  y: number;
  aim: number;
}

export type GameEvent =
  | { t: 'shot'; id: string; gun: GunId; x: number; y: number; a: number }
  | { t: 'hit'; target: string; by: string; dmg: number; x: number; y: number }
  | { t: 'kill'; killer: string; victim: string; gun: GunId }
  | { t: 'blink'; id: string; x1: number; y1: number; x2: number; y2: number }
  | { t: 'swap'; id: string; target: string }
  | { t: 'swapFail'; id: string }
  | { t: 'bubble'; id: string; x: number; y: number }
  | { t: 'decoy'; id: string }
  | { t: 'wall'; id: string; x: number; y: number }
  | { t: 'wallBreak'; x: number; y: number }
  | { t: 'decoyPop'; x: number; y: number }
  | { t: 'explode'; x: number; y: number; r: number }
  | { t: 'pickup'; id: string; gun: GunId }
  | { t: 'win'; id: string };

export interface Snapshot {
  type: 'snap';
  /** Server sim time in seconds. */
  time: number;
  /** Last input seq processed for the receiving player. */
  ack: number;
  phase: 'playing' | 'ended';
  winner: string | null;
  endsIn: number;
  players: PlayerSnap[];
  bullets: BulletSnap[];
  pickups: PickupSnap[];
  walls: WallSnap[];
  bubbles: BubbleSnap[];
  decoys: DecoySnap[];
  events: GameEvent[];
}

export type ServerMsg =
  | { type: 'welcome'; id: string; room: string; host: boolean; map: MapId; isPublic: boolean }
  | { type: 'chat'; id: string | null; name: string; text: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number }
  | Snapshot;
