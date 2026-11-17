export interface SeededRng {
  /** Returns a float in [0, 1). */
  next: () => number;
  /** Returns an integer in [min, max] inclusive. */
  nextInt: (min: number, max: number) => number;
  /** Returns a float in [min, max). */
  nextFloat: (min: number, max: number) => number;
  /** Returns true with probability p in [0, 1]. */
  chance: (p: number) => boolean;
  /** Picks a random element from a non-empty array. */
  pick: <T>(items: readonly T[]) => T;
}

/**
 * Mulberry32 deterministic PRNG.
 */
export function createSeededRng(seed: number): SeededRng {
  let state = (seed | 0) >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (min: number, max: number): number => {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(next() * (hi - lo + 1));
  };

  const nextFloat = (min: number, max: number): number => {
    return min + next() * (max - min);
  };

  const chance = (p: number): boolean => {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return next() < p;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[Math.floor(next() * items.length)];
  };

  return { next, nextInt, nextFloat, chance, pick };
}
