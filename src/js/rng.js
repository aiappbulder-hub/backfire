// Seedable RNG so that any run (and any bug) can be reproduced.
// mulberry32 — small, fast, good enough for game weighting.

/** Hash an arbitrary string/number seed into a 32-bit integer. */
export function hashSeed(seed) {
  const str = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * The RNG state is a plain integer held on the game state, so a whole game
 * is serialisable and deterministic: same seed + same inputs = same run.
 */
export function nextRandom(state) {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function randomInt(state, n) {
  return Math.floor(nextRandom(state) * n);
}

/** Pick one entry of `items` using `weightOf`. Returns null if all weights are 0. */
export function weightedPick(state, items, weightOf) {
  const weights = items.map(weightOf);
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return null;
  let roll = nextRandom(state) * total;
  for (let i = 0; i < items.length; i++) {
    roll -= Math.max(0, weights[i]);
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}
