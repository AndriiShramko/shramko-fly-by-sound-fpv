// The stream budget wired into the planner (sonic3 plan 2.2, stage Z4): a lesson with layers.speedBudget plays at most
// the tier's streams at speed, no shape trace and no height layer and no speed ticks from tier 2 (the brake cue may sound);
// a lesson without it plays as before.
import { describe, expect, it } from 'vitest';
import type { FramePlan } from '../src/cues/planner';
import { TIER_STREAMS } from '../src/cues/budget';
import { getLesson, scanFreeLesson } from '../src/lesson/library';
import { flyLesson } from '../src/pilot/ladder';

const streams = (p: FramePlan): string[] => p.voices.map((v) => v.key).filter((k) => !k.startsWith('preview:'));

function plans(id: string, speed: number, budget: boolean | undefined): FramePlan[] {
    const out: FramePlan[] = [];
    flyLesson(getLesson(id), speed, 1, { ...(budget === undefined ? {} : { budget }), trace: (f) => out.push(f.plan) });
    return out;
}

describe('the stream budget in the planner', () => {
    it('at 10 m/s on the rings course: tier 2 is reached and then at most 2 streams, no shape, no height or speed layer', () => {
        const ps = plans('rings-course', 10, true);
        const fast = ps.filter((p) => (p.tier ?? 0) >= 2);
        expect(fast.length).toBeGreaterThan(10);
        for (const p of fast) {
            expect(streams(p).length).toBeLessThanOrEqual(TIER_STREAMS[2]);
            expect(streams(p).some((k) => k.startsWith('shape'))).toBe(false);
            expect(p.height).toBeNull();
            // the speed ticks stay off; only the brake cue (cues/brake.ts, design 4) may sound
            expect(p.speed === null || p.speed.brake === true).toBe(true);
        }
    });

    it('at 6 m/s on the corridor: tier 1 keeps at most 3 streams and no shape trace', () => {
        const mid = plans('corridor', 6, true).filter((p) => p.tier === 1);
        expect(mid.length).toBeGreaterThan(20);
        for (const p of mid) {
            expect(streams(p).length).toBeLessThanOrEqual(TIER_STREAMS[1]);
            expect(streams(p).some((k) => k.startsWith('shape'))).toBe(false);
        }
    });

    it('control: the corridor at 6 m/s without the budget plays more than 3 streams in some frame', () => {
        const ps = plans('corridor', 6, false);
        expect(ps.every((p) => (p.tier ?? 0) === 0)).toBe(true);
        expect(Math.max(...ps.map((p) => streams(p).length))).toBeGreaterThan(3);
    });

    it('at 3 m/s on rings-course, climbs included, the budget changes nothing (the 2-loudest pilot kept its 3 m/s rung)', () => {
        const a = plans('rings-course', 3, true).map((p) => streams(p).join(','));
        const b = plans('rings-course', 3, false).map((p) => streams(p).join(','));
        expect(a.length).toBeGreaterThan(100);
        expect(a).toEqual(b);
    });

    it('below 3 m/s the budget changes nothing: the same voices in every frame', () => {
        const a = plans('rings-course', 2, true).map((p) => streams(p).join(','));
        const b = plans('rings-course', 2, false).map((p) => streams(p).join(','));
        expect(a.length).toBeGreaterThan(100);
        expect(a).toEqual(b);
    });

    it('the free flight over a scan has the budget on; the shipped lessons do not yet', () => {
        expect(scanFreeLesson('any-scene', [1, 0, 0, 0]).layers.speedBudget).toBe(true);
        expect(getLesson('rings-course').layers.speedBudget).toBeUndefined();
    });
});
