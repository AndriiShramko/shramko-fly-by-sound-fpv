// The racing line (sonic3 plan 2.3, the owner's message 51: "show the direction as the line we fly along on drones, the
// light one"). One continuous guide along the course: the lesson's track points smoothed by a centripetal Catmull-Rom
// curve; the craft's place on it (arc length s) only moves forward, never back more than LINE_BACK_MAX_M, so a loop does
// not jump; the hum points at the look-ahead point s + max(LINE_LOOK_MIN_M, LINE_LOOK_S x speed), so a turn ahead is
// heard before it comes. Left and right of the line do not rest on the HRTF alone: a level difference between the ears up
// to LINE_SIDE_DB; the distance off the line is beating, full at LINE_BEAT_FULL_M. Pure: no DOM, no audio.

import type { SonicObject, Vec3 } from '../contract';
import { DEG, distance, dot, length, sub } from '../util/vec';
import { pannerDirection, targetBeat } from './rules';

/** look-ahead time, s (estimate, plan 2.3; the ear pilot measures it) */
export const LINE_LOOK_S = 1.0;
/** the look-ahead is never shorter than this, m (estimate) */
export const LINE_LOOK_MIN_M = 3;
/** the craft's place on the line never moves back more than this, m (plan 2.3) */
export const LINE_BACK_MAX_M = 2;
/** the place is searched at most this far ahead of the last one, m (estimate: a loop passing near never pulls it on) */
export const LINE_AHEAD_WINDOW_M = 20;
/** farther than this from the line inside the window the place is searched along the whole line (a respawn), m (estimate) */
export const LINE_LOST_M = 8;
/** the level difference between the ears at LINE_SIDE_FULL_DEG and beyond, dB (estimate, plan 2.3) */
export const LINE_SIDE_DB = 10;
export const LINE_SIDE_FULL_DEG = 30;
/** beating is full this far off the line, m (estimate, plan 2.3) */
export const LINE_BEAT_FULL_M = 1.5;
/** the smoothed line is sampled every this many metres */
const STEP_M = 0.25;

/** The hum's target when it follows the line: the look-ahead point, and how far the craft is off the line. */
export interface SonicLineTarget extends SonicObject {
    readonly lineOffM: number;
}

export function isLineTarget(o: SonicObject): o is SonicLineTarget {
    return typeof (o as Partial<SonicLineTarget>).lineOffM === 'number';
}

/** One centripetal Catmull-Rom segment between p1 and p2 at u in 0..1 (alpha 0.5). */
function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
    const knot = (a: Vec3, b: Vec3): number => Math.max(Math.sqrt(distance(a, b)), 1e-4);
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const t = t1 + (t2 - t1) * u;
    const lerp = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 => {
        const w = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
    };
    const a1 = lerp(p0, p1, 0, t1);
    const a2 = lerp(p1, p2, t1, t2);
    const a3 = lerp(p2, p3, t2, t3);
    const b1 = lerp(a1, a2, 0, t2);
    const b2 = lerp(a2, a3, t1, t3);
    return lerp(b1, b2, t1, t2);
}

/** The points smoothed into a dense polyline through every point (repeated points dropped). */
export function smoothLine(points: readonly Vec3[]): Vec3[] {
    const p: Vec3[] = [];
    for (const q of points) if (p.length === 0 || distance(p[p.length - 1] as Vec3, q) > 1e-3) p.push(q);
    if (p.length < 2) return p.slice();
    const out: Vec3[] = [p[0] as Vec3];
    for (let i = 0; i < p.length - 1; i++) {
        const p1 = p[i] as Vec3;
        const p2 = p[i + 1] as Vec3;
        const p0 = i > 0 ? (p[i - 1] as Vec3) : sub(p1, sub(p2, p1));
        const p3 = i + 2 < p.length ? (p[i + 2] as Vec3) : sub(p2, sub(p1, p2));
        const n = Math.max(1, Math.ceil(distance(p1, p2) / STEP_M));
        for (let k = 1; k <= n; k++) out.push(k === n ? p2 : catmull(p0, p1, p2, p3, k / n));
    }
    return out;
}

export interface LinePlace {
    /** arc length of the craft's place, m */
    readonly s: number;
    /** the craft's distance from the line, m */
    readonly offM: number;
    /** the look-ahead point */
    readonly ahead: Vec3;
}

export class RacingLine {
    readonly points: readonly Vec3[];
    private readonly cum: number[];
    private s = 0;

    constructor(track: readonly Vec3[]) {
        this.points = smoothLine(track);
        this.cum = [0];
        for (let i = 1; i < this.points.length; i++) this.cum.push((this.cum[i - 1] as number) + distance(this.points[i - 1] as Vec3, this.points[i] as Vec3));
    }

    get lengthM(): number {
        return this.cum[this.cum.length - 1] ?? 0;
    }

    /** The point at arc length s (clamped to the ends). */
    pointAt(s: number): Vec3 {
        const pts = this.points;
        if (pts.length === 0) return [0, 0, 0];
        if (s <= 0) return pts[0] as Vec3;
        if (s >= this.lengthM) return pts[pts.length - 1] as Vec3;
        let lo = 0;
        let hi = this.cum.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if ((this.cum[mid] as number) <= s) lo = mid;
            else hi = mid;
        }
        const a = pts[lo] as Vec3;
        const b = pts[hi] as Vec3;
        const w = (s - (this.cum[lo] as number)) / Math.max((this.cum[hi] as number) - (this.cum[lo] as number), 1e-9);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
    }

    /** The nearest point of the segments whose arc lies in [s0, s1]: its arc length and distance. */
    private nearest(pos: Vec3, s0: number, s1: number): { s: number; d: number } {
        let best = { s: this.s, d: Infinity };
        for (let i = 0; i < this.points.length - 1; i++) {
            const c0 = this.cum[i] as number;
            const c1 = this.cum[i + 1] as number;
            if (c1 < s0 || c0 > s1) continue;
            const a = this.points[i] as Vec3;
            const ab = sub(this.points[i + 1] as Vec3, a);
            const len2 = dot(ab, ab);
            let w = len2 > 1e-12 ? dot(sub(pos, a), ab) / len2 : 0;
            const lo = c1 > c0 ? Math.max(0, (s0 - c0) / (c1 - c0)) : 0;
            const hi = c1 > c0 ? Math.min(1, (s1 - c0) / (c1 - c0)) : 1;
            w = Math.min(Math.max(w, lo), hi);
            const q: Vec3 = [a[0] + ab[0] * w, a[1] + ab[1] * w, a[2] + ab[2] * w];
            const d = distance(pos, q);
            if (d < best.d) best = { s: c0 + (c1 - c0) * w, d };
        }
        return best;
    }

    /** Back to the start of the line (a new attempt). */
    reset(): void {
        this.s = 0;
    }

    /** Where the craft is on the line and where the hum points at this speed. */
    update(pos: Vec3, speedMps: number): LinePlace {
        let n = this.nearest(pos, this.s - LINE_BACK_MAX_M, this.s + LINE_AHEAD_WINDOW_M);
        if (n.d > LINE_LOST_M) n = this.nearest(pos, 0, this.lengthM);
        // never back more than LINE_BACK_MAX_M behind the furthest place reached
        this.s = Math.max(this.s, n.s);
        const look = Math.max(LINE_LOOK_MIN_M, LINE_LOOK_S * Math.max(speedMps, 0));
        return { s: n.s, offM: n.d, ahead: this.pointAt(Math.max(this.s, n.s) + look) };
    }
}

/**
 * The VoicePlan ildDb that gives a voice at `dir` LINE_SIDE_DB between the ears at LINE_SIDE_FULL_DEG and beyond, in
 * proportion below it: the engine applies ildDb times |x| of the panner direction, so the wanted level is divided by
 * that |x| (as beacon.ts beaconSideIldDb). 0 straight ahead.
 */
export function lineSideIldDb(dir: Vec3): number {
    const x = Math.abs(pannerDirection(dir)[0]);
    if (!(x > 1e-6)) return 0;
    const sideDeg = Math.asin(Math.min(1, x)) / DEG;
    const wanted = LINE_SIDE_DB * Math.min(1, sideDeg / LINE_SIDE_FULL_DEG);
    return wanted / x;
}

/** Beating by the distance off the line: none on it, full at LINE_BEAT_FULL_M. */
export function lineBeat(offM: number): { readonly hz: number; readonly depth: number } {
    return targetBeat(Math.min(1, Math.max(0, offM) / LINE_BEAT_FULL_M));
}

/** Unit length of a vector, 0 for none (exported for tests). */
export function lineLength(v: Vec3): number {
    return length(v);
}
