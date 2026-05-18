/*
 * demo/rng.js — deterministic pseudo-random number generator for the
 * demo data pack.
 *
 * Every demo preset MUST be reproducible: the same seed produces
 * byte-identical fields and rows on every page load.  That lets us
 * (a) keep zero JSON fixtures in the bundle (~1.4 MB saved vs
 * pre-baked datasets), (b) screenshot deterministically for E2E
 * tests, and (c) let a user "Reset" the demo without seeing
 * different data.
 *
 * Algorithm: mulberry32.  ~10 lines, very fast, passes basic
 * randomness tests, period 2^32.  More than enough for visualisation
 * jitter — we are NOT generating crypto keys.
 *
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 *
 * Usage:
 *   import { createRng } from './rng.js';
 *   const rng = createRng(42);
 *   rng.next();          // 0.0..1.0
 *   rng.range(10, 20);   // 10..20
 *   rng.int(0, 100);     // 0..99
 *   rng.pick(['a','b']); // 'a' or 'b'
 *   rng.gauss(0, 1);     // Box-Muller normal
 */

/**
 * Build a seeded RNG. Treat returned object as opaque; do not reach
 * into `_state`.
 *
 * @param {number} seed Integer; same seed → same sequence.
 * @returns {{
 *   next: () => number,
 *   range: (lo: number, hi: number) => number,
 *   int: (lo: number, hi: number) => number,
 *   pick: <T>(arr: T[]) => T,
 *   gauss: (mean?: number, stddev?: number) => number,
 *   chance: (p: number) => boolean
 * }}
 */
export function createRng(seed) {
    var state = (seed | 0) >>> 0;
    if (state === 0) {
        // mulberry32 cycles short for seed=0; bump it.
        state = 0x9e3779b9;
    }

    function next() {
        state = (state + 0x6D2B79F5) >>> 0;
        var t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function range(lo, hi) {
        return lo + (hi - lo) * next();
    }

    function int(lo, hi) {
        return Math.floor(range(lo, hi));
    }

    function pick(arr) {
        if (!arr || arr.length === 0) return undefined;
        return arr[int(0, arr.length)];
    }

    /**
     * Box-Muller normal distribution. Useful for "most values near a
     * mean, occasional outliers" — sensor temperatures, traffic
     * speeds, risk scores.
     */
    function gauss(mean, stddev) {
        var m = (typeof mean === 'number') ? mean : 0;
        var s = (typeof stddev === 'number') ? stddev : 1;
        var u1 = next();
        var u2 = next();
        // Guard against u1=0 → log(0) = -Infinity.
        if (u1 < 1e-12) u1 = 1e-12;
        var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return m + z * s;
    }

    function chance(p) {
        return next() < p;
    }

    return {
        next: next,
        range: range,
        int: int,
        pick: pick,
        gauss: gauss,
        chance: chance
    };
}
