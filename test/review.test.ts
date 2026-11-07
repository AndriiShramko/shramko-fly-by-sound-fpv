// Tests written by the independent review of stage1-rc1 (docs/dev/review-stage-1.md): each one
// fails on the code as reviewed and holds the fix of one confirmed defect.
import { describe, expect, it } from 'vitest';
import type { FlightSample, SessionEvent } from '../src/contract';
import { createLessonRunner, getLesson, type LessonSession, type RunnerAction } from '../src/lesson';
import { yawQuat } from '../src/util/vec';

type SayAction = Extract<RunnerAction, { kind: 'say' }>;
const says = (actions: readonly RunnerAction[]): SayAction[] => actions.filter((a): a is SayAction => a.kind === 'say');

function sampleAt(t: number): FlightSample {
    return { t, tick: t, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

/** Steps a runner in time until an action of `kind` comes out; returns every action handed out on the way, with the time it came. */
function runUntil(run: LessonSession, kind: RunnerAction['kind'], from: number, limitMs = 120000): { readonly actions: RunnerAction[]; readonly t: number } {
    const all: RunnerAction[] = [];
    for (let t = from; t < from + limitMs; t += 50) {
        run.step(sampleAt(t), null);
        const a = run.takeActions();
        all.push(...a);
        if (a.some((x) => x.kind === kind)) return { actions: all, t };
    }
    throw new Error(`no '${kind}' action within ${limitMs} ms`);
}

describe('review D2: a key the pilot presses cuts the speech in progress', () => {
    it('N during the intro: the first line of what follows interrupts, the rest of that step do not', () => {
        const run = createLessonRunner(getLesson('hover-height'));
        run.begin(0);
        const intro = says(run.takeActions());
        expect(intro.length).toBeGreaterThanOrEqual(3); // title and intro lines are queued with the speech
        expect(intro.every((a) => !a.interrupt)).toBe(true);
        run.next(100);
        const after = says(run.takeActions());
        expect(after.map((a) => a.line.key)).toEqual(['fly.go']);
        expect(after[0]?.interrupt, 'the queued intro must be cut by N').toBe(true);
    });

    it('N during the pause between attempts: the next attempt announcement interrupts', () => {
        const lesson = getLesson('hover-height');
        const run = createLessonRunner(lesson);
        run.begin(0);
        run.takeActions();
        run.next(10);
        run.takeActions();
        // the first attempt runs out of time: the retry lines are spoken, then the pause begins
        const limitMs = (lesson.attemptLimitS as number) * 1000;
        let t = 20;
        let phaseBetween = false;
        while (t < limitMs + 5000 && !phaseBetween) {
            run.step(sampleAt(t), null);
            run.takeActions();
            phaseBetween = run.phase === 'between';
            t += 50;
        }
        expect(phaseBetween).toBe(true);
        run.next(t);
        const after = says(run.takeActions());
        expect(after[0]?.line.key).toBe('fly.attempt');
        expect(after[0]?.interrupt).toBe(true);
    });

    it('an answer cuts the rest of the question that is still being read out', () => {
        const run = createLessonRunner(getLesson('ears-game'));
        run.begin(0);
        let t = 0;
        // play on until the first question has been put (its lines are queued with the speech)
        for (let guard = 0; guard < 40; guard++) {
            const got = runUntil(run, 'ask', t);
            t = got.t;
            const q = got.actions.find((a) => a.kind === 'ask');
            if (q !== undefined && q.kind === 'ask' && q.question.id.endsWith(':what')) break;
        }
        const events: readonly SessionEvent[] = run.answer(1, 'key', t + 100);
        expect(events.some((e) => e.kind === 'answer')).toBe(true);
        const after = says(run.takeActions());
        expect(after.length).toBeGreaterThan(0);
        expect(after[0]?.line.key === 'quiz.right' || after[0]?.line.key === 'quiz.wrong').toBe(true);
        expect(after[0]?.interrupt, 'the feedback must not wait behind the options still being read').toBe(true);
    });

    it('R (back to the start or to a checkpoint) interrupts too, and nothing else does by itself', () => {
        const run = createLessonRunner(getLesson('corridor'));
        run.begin(0);
        run.takeActions();
        run.next(10);
        const go = says(run.takeActions());
        expect(go[0]?.interrupt).toBe(true); // N, as above
        run.step(sampleAt(60), null);
        const quiet = says(run.takeActions());
        expect(quiet.every((a) => !a.interrupt)).toBe(true); // a line that follows on its own queues as before
        run.reset('start', 100);
        const back = says(run.takeActions());
        expect(back[0]?.line.key).toBe('fly.reset-start');
        expect(back[0]?.interrupt).toBe(true);
        run.spoken(150); // the host's speech queue ran empty
        run.takeActions();
        run.reset('checkpoint', 200);
        run.step(sampleAt(250), null);
        const cp = says(run.takeActions());
        expect(cp[0]?.line.key).toBe('fly.reset-checkpoint');
        expect(cp[0]?.interrupt).toBe(true);
    });
});
