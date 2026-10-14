export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const ARENA_W = 44;
export const ARENA_H = 32;

export const PLAYER_RADIUS = 0.6;
export const PLAYER_SPEED = 6.2;
export const MAX_HP = 100;
export const RESPAWN_TIME = 3;
export const SPAWN_SHIELD = 1.5;

export const KILLS_TO_WIN = 15;
export const MATCH_END_TIME = 6;
export const MAX_PLAYERS = 8;

export const PICKUP_RADIUS = 1.4;
export const DROP_LIFETIME = 20;
export const MAP_PICKUP_INTERVAL = 25;

/** Seconds other entities are rendered behind the newest snapshot. */
export const INTERP_DELAY = 0.1;
/** Largest dt the server accepts for one input message. */
export const MAX_INPUT_DT = 0.05;
