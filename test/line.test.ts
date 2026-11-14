// The racing line (sonic3 plan 2.3, stage Z4 pass 2): the look-ahead grows with speed, the place on the line never runs
// back nor jumps to a later leg that passes near, the side is a level difference up to 10 dB, the distance off the line
// is beating; a lesson with layers.racingLine points the hum at the look-ahead point.
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/contract';
import { LINE_BEAT_FULL_M, LINE_LOOK_MIN_M, LINE_SIDE_DB, lineBeat, lineSideIldDb, RacingLine, smoothLine } from '../src/cues/line';
import type { FramePlan } from '../src/cues/planner';
import { pannerDirection } from '../src/cues/rules';
import { getLesson } from '../src/lesson/library';
import { flyLesson } from '../src/pilot/ladder';

const DEG = Math.PI / 180;
const at = (deg: number): Vec3 => [Math.sin(deg * DEG), 0, -Math.cos(deg * DEG)];
/** the level difference the engine makes of a VoicePlan's ildDb at `dir` (ildDb times |x| of the panner direction) */
const heardIld = (ildDb: number, dir: Vec3): number => ildDb * Math.abs(pannerDirection(dir)[0]);

describe('the racing line, pure', () => {
    it('passes through every track point', () => {
        const pts: Vec3[] = [[0, 0, 0], [0, 0, -10], [6, 1, -16], [6, 2, -30]];
        const line = smoothLine(pts);
        for (const p of pts) expect(Math.min(...line.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])))).toBeLessThan(1e-6);
    });

    it('looks ahead max(3 m, 1 s x speed) along the line', () => {
        const line = new RacingLine([[0, 0, 0], [0, 0, -40]]);
        expect(line.update([0, 0, -10], 2).ahead[2]).toBeCloseTo(-10 - LINE_LOOK_MIN_M, 3);
        expect(line.update([0, 0, -10], 10).ahead[2]).toBeCloseTo(-20, 3);
        const off = line.update([1.5, 0, -12], 0);
        expect(off.offM).toBeCloseTo(1.5, 3);
        expect(off.s).toBeCloseTo(12, 3);
    });

    it('never runs back more than 2 m and does not jump to a later leg that passes near (a loop)', () => {
        const line = new RacingLine([[0, 0, 0], [0, 0, -20], [4, 0, -20], [4, 0, 0]]);
        expect(line.update([0, 0, -15], 0).s).toBeCloseTo(15, 1);
        // back to z -5: the place stays within 2 m of the furthest reached
        expect(line.update([0, 0, -5], 0).s).toBeGreaterThanOrEqual(13 - 1e-6);
        const loop = new RacingLine([[0, 0, 0], [0, 0, -20], [4, 0, -20], [4, 0, 0]]);
        loop.update([0, 0, -5], 0);
        // nearer the way back (x 4) than the way out, but the way back is 30 m on: the place stays on the way out
        const p = loop.update([3, 0, -5], 0);
        expect(p.s).toBeLessThan(10);
        expect(p.offM).toBeGreaterThan(2.5);
    });

    it('the side is a level difference: 10 dB at 30 degrees and beyond, in proportion below, 0 ahead', () => {
        expect(heardIld(lineSideIldDb(at(30)), at(30))).toBeCloseTo(LINE_SIDE_DB, 0);
        expect(heardIld(lineSideIldDb(at(-60)), at(-60))).toBeCloseTo(LINE_SIDE_DB, 0);
        expect(heardIld(lineSideIldDb(at(15)), at(15))).toBeCloseTo(LINE_SIDE_DB / 2, 1);
        expect(lineSideIldDb(at(0))).toBe(0);
    });

    it('off the line is beating: none on it, full at 1.5 m', () => {
        expect(lineBeat(0).depth).toBe(0);
        expect(lineBeat(LINE_BEAT_FULL_M / 2).depth).toBeCloseTo(0.5, 6);
        expect(lineBeat(LINE_BEAT_FULL_M * 3).depth).toBe(1);
        expect(lineBeat(LINE_BEAT_FULL_M).hz).toBeGreaterThan(lineBeat(0.3).hz);
    });
});

function hums(line: boolean): { dist: number[]; sideIld: number[] } {
    const plans: FramePlan[] = [];
    flyLesson(getLesson('rings-course'), 2, 1, { line, trace: (f) => plans.push(f.plan) });
    const dist: number[] = [];
    const sideIld: number[] = [];
    for (const p of plans) {
        const v = p.voices.find((x) => x.key === 'target');
        if (v === undefined) continue;
        dist.push(v.distance);
        if (Math.abs(pannerDirection(v.dir)[0]) >= Math.sin(30 * DEG)) sideIld.push(heardIld(v.ildDb, v.dir));
    }
    return { dist, sideIld };
}

describe('the racing line in a lesson (layers.racingLine)', () => {
    const on = hums(true);
    const off = hums(false);
    /** the 5th percentile of the hum's distance, m */
    const low = (d: number[]): number => [...d].sort((a, b) => a - b)[Math.floor(d.length * 0.05)] ?? 0;

    it('the hum points at the look-ahead point, at least 3 m ahead, not at the gate the craft is passing', () => {
        expect(on.dist.length).toBeGreaterThan(100);
        expect(low(on.dist)).toBeGreaterThan(LINE_LOOK_MIN_M - 0.5);
        expect(low(off.dist)).toBeLessThan(1.5);
    });

    it('a hum 30 degrees or more to the side is heard with at least 10 dB between the ears (the beacon alone: 2 dB)', () => {
        expect(on.sideIld.length).toBeGreaterThan(0);
        expect(Math.min(...on.sideIld)).toBeGreaterThanOrEqual(LINE_SIDE_DB - 0.5);
    });

    it('the ear pilot flies rings-course on the line at 2 m/s', () => {
        expect(flyLesson(getLesson('rings-course'), 2, 1, { line: true }).why).toBe('pass');
    });
});
