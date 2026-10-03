// Names the simulation's modules share: the zone's phases, the causes of a fall, and the mod lookup.
export const PHASE = { COUNTIN: 0, PLAY: 1, VAMP: 2, WARP: 3, DONE: 4, OVER: 5 };
export const DEATH = { flipper: 1, shot: 2, pulsar: 3, mine: 4, spike: 5, fuseball: 6, ghost: 7, weaver: 8, siren: 9, bomber: 10, boss: 11, tide: 12 };
export const DEATH_NAMES = Object.fromEntries(Object.entries(DEATH).map(([k, v]) => [v, k.toUpperCase()]));
/** How many of a mod a ship carries. */
export const mod = (ship, key) => ship.mods[key] || 0;
