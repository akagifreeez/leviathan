// Deterministic seeded PRNG (mulberry32). Browser Math.random isn't seedable,
// and we need the creature's skeleton (organ placement, particle scatter) to be
// identical every render/replay.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// uniform in [lo, hi)
export function rangeOf(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
