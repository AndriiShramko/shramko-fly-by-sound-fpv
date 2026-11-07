// A seeded random source for the generators (mulberry32: integer arithmetic only, so every
// JavaScript engine gives the same sequence). A generator draws its numbers in one fixed order;
// changing that order changes the geometry and needs a new generator version.

export interface Rng {
    /** uniform in [0, 1) */
    next(): number;
    /** uniform in [lo, hi) */
    range(lo: number, hi: number): number;
    /** uniform integer in [lo, hi] */
    int(lo: number, hi: number): number;
    /** -1 or 1 */
    sign(): number;
}

export function createRng(seed: number): Rng {
    let a = Math.trunc(seed) >>> 0;
    const next = (): number => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        range: (lo, hi) => lo + (hi - lo) * next(),
        int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
        sign: () => (next() < 0.5 ? -1 : 1)
    };
}
