// Tests written by the independent review of stage1-rc1 (docs/dev/review-stage-1.md): each one
// fails on the code as reviewed and holds the fix of one confirmed defect.
import { describe, expect, it } from 'vitest';
import type { FlightSample, Goal, LayerId, LessonLayers, Pose, SessionEvent, SonicObject, ThemeDef } from '../src/contract';
import { DemoHost, type EngineLike } from '../demo/host';
import { createLessonRunner, getLesson, SHIPPED_LESSON_IDS, type LessonSession, type RunnerAction } from '../src/lesson';
import { applyCalm, getBuiltinTheme, validateTheme } from '../src/theme';
import { quatRotate, yawQuat } from '../src/util/vec';
import { createAnalyticWorld } from '../src/world';
import { buildReport, type Report } from '../tools/report';
import { RecordingHost } from './helpers/record';

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

describe('review D1: leaving a lesson makes the engine quiet', () => {
    it('the engine is told that no layer sounds once the lesson is left, and hears the next lesson\'s layers again', () => {
        const layers: LessonLayers[] = [];
        const engine: EngineLike = { update: () => undefined, cue: () => undefined, say: () => Promise.resolve(), setLayers: (l) => void layers.push(l) };
        const host = new DemoHost({ engine, locale: 'en' });
        host.open('hover-height', 0);
        expect(layers.at(-1)?.on).toContain('height');
        host.leave();
        // the engine re-plans the last frame for as long as no new one comes: only an empty layer set silences it
        expect(layers.at(-1)?.on, 'the height tone of the lesson left must not go on sounding').toEqual([]);
        host.open('hover-turn', 100);
        expect(layers.at(-1)?.on).toContain('target');
    });
});

/** Plays the headphone check with a scripted pilot who answers by question id; speaks every line at once. */
function playHeadphoneCheck(answer: (questionId: string) => number, seconds = 120): { readonly said: string[]; readonly events: SessionEvent[]; readonly run: LessonSession } {
    const run = createLessonRunner(getLesson('ears-headphones'));
    const said: string[] = [];
    const events: SessionEvent[] = [];
    let t = 0;
    const take = (): void => {
        for (let guard = 0; guard < 50; guard++) {
            const actions = run.takeActions();
            if (actions.length === 0) return;
            for (const a of actions) if (a.kind === 'say') said.push(a.line.key);
            if (actions.some((a) => a.kind === 'say')) events.push(...run.spoken(t));
            for (const a of actions) if (a.kind === 'ask') events.push(...run.answer(answer(a.question.id), 'key', t));
        }
    };
    events.push(...run.begin(t));
    take();
    for (; t < seconds * 1000 && run.phase !== 'passed' && !events.some((e) => e.kind === 'lesson' && e.what === 'attempt-fail'); t += 50) {
        events.push(...run.step(sampleAt(t), null));
        take();
    }
    return { said, events, run };
}

// the check puts a sound on the left, on the right and behind; its question ids end in :side or :front-back
const lateralRight = (id: string): number => (id.split(':')[2] === '1' ? 1 : 2);

describe('review D3: the headphone check is about left and right, not about front and back', () => {
    it('a pilot who tells left from right passes whatever they say about front and behind', () => {
        for (const frontBack of [1, 3]) {
            // 1: heard the sound behind as in front (a front/back reversal), 3: "not sure"
            const r = playHeadphoneCheck((id) => (id.endsWith(':side') ? lateralRight(id) : frontBack));
            expect(r.run.phase, `front/back answer ${frontBack}`).toBe('passed');
            expect(r.said).toContain('headphones.good');
            expect(r.said).not.toContain('headphones.unclear');
        }
    });

    it('stays strict where it must: swapped or unsure left and right still fail, with their own message', () => {
        const swapped = playHeadphoneCheck((id) => (id.endsWith(':side') ? 3 - lateralRight(id) : 2));
        expect(swapped.run.phase).not.toBe('passed');
        expect(swapped.said).toContain('headphones.swapped');
        const unsure = playHeadphoneCheck((id) => (id.endsWith(':side') ? 3 : 2));
        expect(unsure.run.phase).not.toBe('passed');
        expect(unsure.said).toContain('headphones.unclear');
        const oneWrong = playHeadphoneCheck((id) => (id.endsWith(':side') ? (id.split(':')[2] === '1' ? 1 : 1) : 2));
        expect(oneWrong.run.phase).not.toBe('passed');
    });

    it('still asks the front and behind question and records the answer for the report', () => {
        const r = playHeadphoneCheck((id) => (id.endsWith(':side') ? lateralRight(id) : 1));
        const answers = r.events.filter((e): e is Extract<SessionEvent, { kind: 'answer' }> => e.kind === 'answer');
        expect(answers.map((a) => a.item.split(':').slice(-1)[0])).toEqual(['side', 'side', 'front-back']);
        expect(answers[2]?.value).toBe(1);
    });
});

describe('review D4: the report does not call an optional lesson passed when no attempt was', () => {
    // shapes-square is not blocking: after its block of 3 attempts the runner ends it ("passed") whatever the score
    const run = async (fly: boolean): Promise<Report> => {
        const host = new RecordingHost(getLesson('shapes-square'));
        host.begin();
        host.until(() => host.runner.phase === 'flying', 120);
        if (fly) {
            const gate = (host.world?.objects() ?? []).find((o) => o.order !== null) as SonicObject;
            const f = quatRotate(gate.quat, [0, 0, -1]);
            for (let k = 0; k < 2; k++) {
                host.flyTo([gate.pos[0] - f[0] * 5, gate.pos[1] - f[1] * 5, gate.pos[2] - f[2] * 5], 5);
                host.flyTo([gate.pos[0] + f[0] * 5, gate.pos[1] + f[1] * 5, gate.pos[2] + f[2] * 5], 5);
                host.until(() => host.runner.phase === 'flying' || host.runner.phase === 'passed', 30);
            }
        }
        host.until(() => host.runner.phase === 'passed', 900);
        expect(host.runner.phase).toBe('passed'); // the runner ends the optional lesson either way
        const { pkg } = await host.toPackage();
        return buildReport(pkg, { replay: false });
    };

    it('a block in which every attempt failed is not a pass', async () => {
        const r = await run(false);
        expect(r.attempts.map((a) => a.result)).toEqual(['fail', 'fail']); // 2 of 3 needed: the block ends once it is out of reach
        expect(r.outcome.success).toBe(false);
        expect(r.outcome.status).toBe('not-passed');
        expect(r.outcome.passedAtMs).toBeNull();
    }, 60000);

    it('a block that was passed still is one (negative control: the fix does not turn every optional lesson into a failure)', async () => {
        const r = await run(true);
        expect(r.attempts.filter((a) => a.result === 'pass').length).toBeGreaterThanOrEqual(2);
        expect(r.outcome.success).toBe(true);
        expect(r.outcome.status).toBe('passed');
        expect(r.outcome.passedAtMs).not.toBeNull();
    }, 60000);
});

/** A pilot who never touches a control: the craft stays where the runner puts it, every line is spoken at once. */
function idlePilot(lessonId: string, seconds: number): { readonly events: SessionEvent[]; readonly places: Pose[] } {
    const lesson = getLesson(lessonId);
    const world = lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
    const run = createLessonRunner(lesson);
    const events: SessionEvent[] = [];
    const places: Pose[] = [];
    let pos = lesson.start.pos;
    let yaw = lesson.start.yawDeg;
    let t = 0;
    const take = (): void => {
        for (let guard = 0; guard < 50; guard++) {
            const actions = run.takeActions();
            if (actions.length === 0) return;
            for (const a of actions) {
                if (a.kind === 'place') {
                    pos = a.pose.pos;
                    yaw = a.pose.yawDeg;
                    places.push(a.pose);
                }
            }
            if (actions.some((a) => a.kind === 'say')) events.push(...run.spoken(t));
        }
    };
    events.push(...run.begin(t));
    take();
    for (; t < seconds * 1000; t += 20) {
        const s: FlightSample = { t, tick: t, pos, vel: [0, 0, 0], quat: yawQuat(yaw), rate: [0, 0, 0], yawDeg: yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
        events.push(...run.step(s, world));
        take();
    }
    return { events, places };
}

describe('review D5: no attempt of a flying lesson can be passed without a single input', () => {
    const flying = SHIPPED_LESSON_IDS.filter((id) => getLesson(id).world.kind === 'analytic');

    it('a pilot who touches nothing passes no attempt of any lesson, in 20 minutes', () => {
        const passes: string[] = [];
        for (const id of flying) {
            const r = idlePilot(id, 1200);
            for (const e of r.events) if (e.kind === 'lesson' && e.what === 'attempt-pass') passes.push(`${id} attempt ${e.attempt}`);
        }
        expect(passes).toEqual([]);
    });

    it('in a turn lesson the sound starts at least 45 degrees off the nose in every attempt, so there is something to turn to', () => {
        const lesson = getLesson('hover-turn');
        const goal = lesson.goals.find((g) => g.kind === 'turn-to') as Extract<Goal, { kind: 'turn-to' }>;
        if (lesson.world.kind !== 'analytic') throw new Error('hover-turn has a lesson world');
        const ring = createAnalyticWorld(lesson.world.spec).objects().find((o) => o.id === goal.objectId) as SonicObject;
        const r = idlePilot('hover-turn', 600);
        expect(r.places.length).toBeGreaterThanOrEqual(8); // at least two turns of the four starting directions
        for (const [i, p] of r.places.entries()) {
            const bearing = (Math.atan2(ring.pos[0] - p.pos[0], -(ring.pos[2] - p.pos[2])) * 180) / Math.PI;
            const off = Math.abs(((((bearing - p.yawDeg) % 360) + 540) % 360) - 180);
            expect(off, `start ${i + 1} (yaw ${p.yawDeg}): the sound is ${off.toFixed(1)} degrees off the nose`).toBeGreaterThanOrEqual(45);
        }
    });
});

describe('review D6: the calm preset keeps a valid theme valid', () => {
    const soft = getBuiltinTheme('soft');
    const themeWith = (layer: LayerId, params: Record<string, number>): ThemeDef => ({ ...soft, id: 'tight', layers: { ...soft.layers, [layer]: { ...soft.layers[layer], params: { ...soft.layers[layer].params, ...params } } } });
    // a pair of parameters that sit close together inside their ranges: a flat pulse, a flat tick, a narrow hum rate
    const TIGHT: readonly [string, ThemeDef][] = [
        ['pulse periods 299 and 300 ms', themeWith('safety', { periodNearMs: 299, periodFarMs: 300 })],
        ['low-pass 15999 and 16000 Hz', themeWith('safety', { lowpassFarHz: 15999, lowpassNearHz: 16000 })],
        ['tick rates 5 and 6 Hz', themeWith('speed', { tempoMinHz: 5, tempoMaxHz: 6 })],
        ['hum rates 3.9 and 4 Hz', themeWith('target', { rateFarHz: 3.9, rateNearHz: 4 })],
        ['reverb 0.44 and 0.45', themeWith('room', { reverbMin: 0.44, reverbMax: 0.45 })]
    ];

    it('every ordering rule of the schema still holds after the preset, also for themes whose pairs sit close together', () => {
        for (const [name, theme] of TIGHT) {
            expect(validateTheme(theme).ok, `${name}: the theme is valid to begin with`).toBe(true);
            const calm = validateTheme(applyCalm(theme));
            expect(calm.ok ? [] : calm.issues.map((i) => `${i.path}: ${i.message}`), `${name}: the calm version`).toEqual([]);
        }
    });

    it('still makes the shipped themes calm (negative control: the repair does not switch the preset off)', () => {
        for (const id of ['soft', 'clear', 'race'] as const) {
            const t = getBuiltinTheme(id);
            const calm = applyCalm(t);
            expect(calm.layers.safety.params['periodNearMs']).toBeGreaterThan(t.layers.safety.params['periodNearMs'] as number);
            expect(calm.layers.target.params['rateNearHz']).toBeLessThan(t.layers.target.params['rateNearHz'] as number);
            expect(calm.layers.speed.params['tempoMaxHz']).toBeLessThan(t.layers.speed.params['tempoMaxHz'] as number);
        }
    });
});
