// M41-8: no endless trials. The owner flew hover-height and hover-turn on the live v0.12: "on one task
// about 12 attempts", "15 attempts and it still does not move on". These tests reproduce both with a
// scripted pilot on the runner, and show why: the v0.12 block rule (pass.attempts per block,
// pass.required successes in it, a block that can no longer pass starts again from zero).
import { describe, expect, it } from 'vitest';
import type { Goal, SonicObject } from '../src/contract';
import { getLesson } from '../src/lesson';
import { createRng } from '../src/util/rng';
import { ScriptedPilot } from './helpers/pilot';

/**
 * hover-turn with a pilot who mistakes a sound behind for a sound in front (a front/back reversal,
 * research 01: 10 to 50 % with a generic HRTF): an attempt that starts with the ring in front of the
 * ears is turned to and held; one that starts with it behind is not turned to (the pilot believes he
 * already faces it) and runs out of time.
 */
function frontBackPilot(attempts: number): ScriptedPilot {
    const lesson = getLesson('hover-turn');
    const goal = lesson.goals[0] as Extract<Goal, { kind: 'turn-to' }>;
    const p = new ScriptedPilot(lesson);
    const ring = (): SonicObject => p.object(goal.objectId);
    p.begin();
    p.until(() => p.run.phase === 'flying', 120);
    for (let k = 0; k < attempts && p.run.phase !== 'passed'; k++) {
        const startedAt = p.run.attempt;
        if (Math.abs(p.bearingOf(ring())) < 90) {
            p.face(ring().pos);
            p.hold(1);
        }
        // the attempt ends (met, or out of time), the pause goes by, the next one begins
        p.until(() => p.run.attempt > startedAt || p.run.phase === 'passed', 120);
        p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 60);
    }
    return p;
}

/** hover-height with a pilot who holds the band in an attempt with probability `share` (seeded), else stays above it. */
function coinPilot(share: number, seed: number, maxAttempts = 200): ScriptedPilot {
    const lesson = getLesson('hover-height');
    const goal = lesson.goals[0] as Extract<Goal, { kind: 'hold-height' }>;
    const rng = createRng(seed);
    const p = new ScriptedPilot(lesson);
    p.begin();
    p.until(() => p.run.phase === 'flying', 120);
    for (let k = 0; k < maxAttempts && p.run.phase !== 'passed'; k++) {
        const startedAt = p.run.attempt;
        const good = rng.next() < share;
        const centre = (goal.bandM[0] + goal.bandM[1]) / 2;
        p.flyTo([p.pos[0], centre, p.pos[2]]);
        // in the band the whole time, or 40 % of the time above it
        p.hold(good ? goal.seconds + 1 : 0.6 * goal.seconds);
        if (!good) {
            p.flyTo([p.pos[0], goal.bandM[1] + 0.5, p.pos[2]]);
            p.hold(0.4 * goal.seconds + 1);
        }
        p.until(() => p.run.attempt > startedAt || p.run.phase === 'passed', 120);
        p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 60);
    }
    return p;
}

describe('v0.12: why the trials did not end (facts of M41-8, the block rule as shipped)', () => {
    it('hover-turn: the pilot who mistakes behind for in front passes 7 of 15 attempts and never the lesson', () => {
        const p = frontBackPilot(15);
        // the starts turn through 0, 180, 90, -135 degrees (runner TURN_OFFSETS): the ring is at -83, +97, -173, +52 degrees
        expect(p.results()).toBe('PFFPPFFPPFFPPFF');
        expect(p.run.phase).not.toBe('passed');
        // 4 of 5 per block: every block meets two failures in a row before its fourth success and starts again
        expect(p.lessonWhat().filter((w) => w === 'block-pass')).toEqual([]);
        expect(p.run.progress()).toMatchObject({ attempts: 15, successes: 7, passed: false });
    }, 60000);

    it('hover-height: 200 pilots who each hold the band in 6 of 10 attempts need 9 attempts at the median, 1 in 4 of them 16 or more', () => {
        const counts: number[] = [];
        for (let seed = 1; seed <= 200; seed++) {
            const p = coinPilot(0.6, seed);
            expect(p.run.phase, `seed ${seed}`).toBe('passed');
            counts.push(p.run.attempt);
        }
        counts.sort((a, b) => a - b);
        const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
        // measured 2026-11-08: mean 13.1, median 9, 75th percentile 16, 90th 27 (the rule alone, 20 000 seeded runs: mean 11.0, median 9, 75th 14)
        expect(counts[100]).toBe(9);
        expect(counts[150]).toBe(16);
        expect(counts[180]).toBe(27);
        expect(mean).toBeGreaterThan(12);
    }, 120000);
});
