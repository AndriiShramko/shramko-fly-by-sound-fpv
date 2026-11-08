// M41-8: no endless trials. The owner flew hover-height and hover-turn on the live v0.12: "on one task
// about 12 attempts", "15 attempts and it still does not move on". Format 2 counts in total: r counted
// attempts pass a lesson (r = 3 for flying lessons unless the lesson says fewer), failures in between do
// not reset, and after 3 failures in a row the pilot hears why and that N goes on. Each check here has
// its control: the same pilots under the v0.12 block rule (testHooks.passRule, with the lessons'
// v0.12 numbers from test/fixtures/v012-pass-rules.json) must fail it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Goal, SonicObject } from '../src/contract';
import { getLesson, SHIPPED_LESSON_IDS, type RunnerAction, type RunnerOptions, type V012PassRule } from '../src/lesson';
import { createRng } from '../src/util/rng';
import { ScriptedPilot } from './helpers/pilot';
import { playLesson } from './helpers/truth';

const V012 = (JSON.parse(readFileSync(new URL('./fixtures/v012-pass-rules.json', import.meta.url), 'utf8')) as { rules: Record<string, V012PassRule> }).rules;
const v012 = (id: string): RunnerOptions => ({ testHooks: { passRule: V012[id] as V012PassRule } });

/** Every shipped lesson that flies an analytic world, and free-garden over a stand-in for its scan's ring track. */
const FLYING = SHIPPED_LESSON_IDS.filter((id) => getLesson(id).world.kind !== 'none');
const GARDEN_GATES: SonicObject[] = [-10, -25, -40].map((z, i) => ({ id: `g${i + 1}`, shape: { kind: 'ring', diameter: 3, tube: 0.1 }, pos: [0, 3, z], quat: [1, 0, 0, 0], order: i, solid: false, material: 'obstacle' }));

function pilotFor(id: string, options: RunnerOptions = {}): ScriptedPilot {
    const lesson = getLesson(id);
    if (lesson.world.kind === 'scan') return new ScriptedPilot(lesson, { ...options, objects: GARDEN_GATES, start: { pos: [0, 3, 0], yawDeg: 0 } }, null);
    return new ScriptedPilot(lesson, options);
}

const results = (p: ScriptedPilot): string => p.results();
const sayKeys = (actions: readonly RunnerAction[]): string[] => actions.flatMap((a) => (a.kind === 'say' ? [a.line.key] : []));

/**
 * hover-turn with a pilot who mistakes a sound behind for a sound in front (a front/back reversal,
 * research 01: 10 to 50 % with a generic HRTF): an attempt that starts with the ring in front of the
 * ears is turned to and held; one that starts with it behind is not turned to (the pilot believes he
 * already faces it) and runs out of time.
 */
function frontBackPilot(attempts: number, options: RunnerOptions = {}): ScriptedPilot {
    const lesson = getLesson('hover-turn');
    const goal = lesson.goals[0] as Extract<Goal, { kind: 'turn-to' }>;
    const p = new ScriptedPilot(lesson, options);
    const ring = (): SonicObject => p.object(goal.objectId);
    p.begin();
    p.until(() => p.run.phase === 'flying', 120);
    for (let k = 0; k < attempts && p.run.phase !== 'passed'; k++) {
        const startedAt = p.run.attempt;
        if (Math.abs(p.bearingOf(ring())) < 90) {
            p.face(ring().pos);
            p.hold(1);
        }
        p.until(() => p.run.attempt > startedAt || p.run.phase === 'passed', 120);
        p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 60);
    }
    return p;
}

/** hover-height with a pilot who holds the band in an attempt with probability `share` (seeded), else stays above it 40 % of the time. */
function coinPilot(share: number, seed: number, options: RunnerOptions = {}, maxAttempts = 200): ScriptedPilot {
    const lesson = getLesson('hover-height');
    const goal = lesson.goals[0] as Extract<Goal, { kind: 'hold-height' }>;
    const rng = createRng(seed);
    const p = new ScriptedPilot(lesson, options);
    p.begin();
    p.until(() => p.run.phase === 'flying', 120);
    for (let k = 0; k < maxAttempts && p.run.phase !== 'passed'; k++) {
        const startedAt = p.run.attempt;
        const good = rng.next() < share;
        p.flyTo([p.pos[0], (goal.bandM[0] + goal.bandM[1]) / 2, p.pos[2]]);
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

function attemptsToPass(make: (seed: number) => ScriptedPilot, runs: number): number[] {
    const counts: number[] = [];
    for (let seed = 1; seed <= runs; seed++) {
        const p = make(seed);
        expect(p.run.phase, `seed ${seed}`).toBe('passed');
        counts.push(p.run.attempt);
    }
    return counts.sort((a, b) => a - b);
}

/** The longest run of failed attempts that came with no reason and no offer to go on (nor the lesson moving on). */
function longestUnansweredFailRun(p: ScriptedPilot): number {
    let run = 0;
    let longest = 0;
    for (const x of p.log) {
        if ('event' in x && x.event.kind === 'lesson') {
            if (x.event.what === 'attempt-fail') longest = Math.max(longest, ++run);
            else if (x.event.what === 'attempt-pass') run = 0;
        } else if ('action' in x && x.action.kind === 'say' && (x.action.line.key === 'fly.offer-next' || x.action.line.key === 'fly.moving-on')) run = 0;
    }
    return longest;
}

describe('format 2: r counted attempts in total pass a lesson (M41-8)', () => {
    it('the truth bot passes every shipped flying lesson in exactly r attempts, without a touch', () => {
        for (const id of FLYING) {
            const p = pilotFor(id);
            playLesson(p, () => 'truth', 8);
            const r = p.lesson.pass.required;
            expect(r, id).toBeLessThanOrEqual(3);
            expect(p.run.phase, `${id}: ${results(p)}`).toBe('passed');
            expect(results(p), id).toBe('P'.repeat(r));
            expect(p.of('touch'), id).toEqual([]);
        }
    }, 300000);

    it('a pilot who fails every other attempt passes every shipped flying lesson in at most 2 x r attempts', () => {
        for (const id of FLYING) {
            const p = pilotFor(id);
            playLesson(p, (attempt) => (attempt % 2 === 1 ? 'fail' : 'truth'), 12);
            const r = p.lesson.pass.required;
            expect(p.run.phase, `${id}: ${results(p)}`).toBe('passed');
            expect(p.run.attempt, id).toBeLessThanOrEqual(2 * r);
            expect(results(p), id).toBe('FP'.repeat(r));
        }
    }, 600000);

    it('no lesson runs more than 3 failed attempts in a row without the reason and the offer to go on', () => {
        for (const id of SHIPPED_LESSON_IDS) {
            const p = pilotFor(id);
            p.begin();
            // a pilot who does nothing and answers nothing: every attempt that can fail fails
            p.until(() => p.run.phase === 'passed' || p.of('lesson').filter((e) => e.what === 'attempt-fail').length >= 7, 4 * 3600);
            const fails = p.of('lesson').filter((e) => e.what === 'attempt-fail').length;
            const rule = p.lesson.pass;
            expect(rule.attempts, id).toBeLessThanOrEqual(3);
            expect(longestUnansweredFailRun(p), `${id}: ${results(p)}`).toBeLessThanOrEqual(rule.attempts);
            if (fails > 0 && !rule.blocking) {
                // a lesson that does not block moved on by itself
                expect(p.run.phase, id).toBe('passed');
                expect(p.said(), id).toContain('fly.moving-on');
                expect(p.run.progress().blocksPassed, id).toBe(0);
                // saved as left without a pass, as N leaves it, not as passed (review R7)
                expect(p.run.progress(), id).toMatchObject({ passed: false, skipped: true });
                expect(p.run.view(), id).toMatchObject({ phase: 'passed', passed: false, skipped: true });
            }
            if (fails >= rule.attempts && rule.blocking) {
                expect(p.said().filter((k) => k === 'fly.offer-next').length, id).toBe(Math.floor(fails / rule.attempts));
                expect(p.run.phase, id).not.toBe('passed');
            }
        }
    }, 600000);

    it('the offer says why, in a line for each goal (the band, the turn, the gate, the touches, the time)', () => {
        // the reason lines said just before the first offer
        const offerLines = (p: ScriptedPilot): string[] => {
            const keys = sayKeys(p.actions);
            let i = keys.indexOf('fly.offer-next');
            const out: string[] = [];
            while (i > 0 && (keys[i - 1] as string).startsWith('reason.')) out.unshift(keys[--i] as string);
            return out;
        };
        const reasonOf = (p: ScriptedPilot): RunnerAction | undefined => p.actions.find((a) => a.kind === 'say' && a.line.key.startsWith('reason.'));
        // hover-height: 60 % in the band, then above it
        const h = coinPilot(0, 1, {}, 3);
        expect(offerLines(h)).toEqual(['reason.height-high']);
        const pct = (reasonOf(h) as Extract<RunnerAction, { kind: 'say' }>).line.params?.['percent'] as number;
        expect(pct).toBeGreaterThan(30);
        expect(pct).toBeLessThan(50);
        // hover-turn: never turned; the third start has the sound behind
        const turn = pilotFor('hover-turn');
        turn.begin();
        turn.until(() => turn.said().includes('fly.offer-next'), 300);
        expect(offerLines(turn)).toEqual(['reason.time', 'reason.turn-behind']);
        // rings-first: three times beside the ring
        const ring = pilotFor('rings-first');
        ring.begin();
        for (let k = 0; k < 3; k++) {
            ring.until(() => ring.run.phase === 'flying', 60);
            ring.flyTo([1.9, 3, 66]);
            ring.flyTo([1.9, 3, 55]);
            ring.until(() => ring.run.phase !== 'flying', 10);
        }
        ring.until(() => ring.said().includes('fly.offer-next'), 30);
        expect(offerLines(ring)).toEqual(['reason.gate-missed']);
        // walls-row allows no touch: three touches
        const row = pilotFor('walls-row');
        row.begin();
        for (let k = 0; k < 3; k++) {
            row.until(() => row.run.phase === 'flying', 60);
            row.touchNext = true;
            row.tick();
            const start = row.pos;
            row.flyTo([3.5, start[1], start[2]], Infinity, false);
            row.flyTo([3.5, start[1], start[2] - 24]);
            row.until(() => row.run.phase !== 'flying', 10);
        }
        row.until(() => row.said().includes('fly.offer-next'), 30);
        expect(offerLines(row)).toEqual(['reason.touches-none']);
        // walls-pillar: a pilot who never flies round the pillar hears that, not "only 0 degrees" (review R12)
        const pillar = pilotFor('walls-pillar');
        pillar.begin();
        pillar.until(() => pillar.said().includes('fly.offer-next'), 3600);
        expect(offerLines(pillar).at(-1)).toBe('reason.around-none');
    }, 300000);

    it('hover-turn: the pilot who mistakes behind for in front passes at the fifth attempt', () => {
        const p = frontBackPilot(15);
        expect(results(p)).toBe('PFFPP');
        expect(p.run.phase).toBe('passed');
        expect(p.run.progress()).toMatchObject({ attempts: 5, successes: 3, blocksPassed: 1, passed: true });
    }, 60000);

    it('hover-height: 200 pilots who each hold the band in 6 of 10 attempts pass in 5 attempts at the median, 7 at the 90th percentile', () => {
        const counts = attemptsToPass((seed) => coinPilot(0.6, seed), 200);
        // measured 2026-11-08; the rule alone, 20 000 runs: mean 4.9, median 5, 90th percentile 7
        expect(counts[100]).toBe(5);
        expect(counts[180]).toBeLessThanOrEqual(7);
        expect(counts[199]).toBeLessThanOrEqual(14);
    }, 120000);
});

describe('control: the v0.12 block rule fails the same checks', () => {
    it('hover-turn: the pilot who mistakes behind for in front passes 7 of 15 attempts and never the lesson', () => {
        const p = frontBackPilot(15, v012('hover-turn'));
        // the starts turn through 0, 180, 90, -135 degrees (runner TURN_OFFSETS): the ring is at -83, +97, -173, +52 degrees
        expect(results(p)).toBe('PFFPPFFPPFFPPFF');
        expect(p.run.phase).not.toBe('passed');
        expect(p.lessonWhat().filter((w) => w === 'block-pass')).toEqual([]);
        expect(p.run.progress()).toMatchObject({ attempts: 15, successes: 7, passed: false });
    }, 60000);

    it('a pilot who fails every other attempt never passes hover-turn, and hears no offer to go on', () => {
        const p = pilotFor('hover-turn', v012('hover-turn'));
        playLesson(p, (attempt) => (attempt % 2 === 1 ? 'fail' : 'truth'), 12);
        expect(p.run.phase).not.toBe('passed');
        expect(p.run.attempt).toBeGreaterThan(2 * getLesson('hover-turn').pass.required);
        expect(p.said()).not.toContain('fly.offer-next');
    }, 120000);

    it('an idle pilot runs more than 3 failed attempts in a row with no reason and no offer', () => {
        const p = pilotFor('hover-height', v012('hover-height'));
        p.begin();
        p.until(() => p.of('lesson').filter((e) => e.what === 'attempt-fail').length >= 7, 3600);
        expect(longestUnansweredFailRun(p)).toBeGreaterThan(3);
    }, 120000);

    it('hover-height: the same 200 pilots need 9 attempts at the median, 1 in 4 of them 16 or more', () => {
        const counts = attemptsToPass((seed) => coinPilot(0.6, seed, v012('hover-height')), 200);
        // measured 2026-11-08: mean 13.1, median 9, 75th percentile 16, 90th 27 (the rule alone, 20 000 runs: mean 11.0, median 9, 75th 14)
        expect(counts[100]).toBe(9);
        expect(counts[150]).toBe(16);
        expect(counts[180]).toBe(27);
    }, 120000);
});

// the lessons' v0.12 numbers are the ones v0.12 shipped (a lesson changed since would make the control meaningless)
describe('the v0.12 numbers of the control', () => {
    it('are the format 1 rules of every shipped lesson', () => {
        expect(Object.keys(V012).sort()).toEqual([...SHIPPED_LESSON_IDS].sort());
        expect(V012['hover-turn']).toMatchObject({ attempts: 5, required: 4, blocks: 1 });
        expect(V012['hover-height']).toMatchObject({ attempts: 5, required: 4, blocks: 1 });
    });
});
