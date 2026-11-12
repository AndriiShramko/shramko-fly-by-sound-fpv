// M41-6 and the package side of M41-3: N moves one step on (from the last step: the next lesson, this
// one marked skipped), B one step back (from step 1: the previous lesson), Z gives the step again from
// its first line. A flying lesson has two steps (the task, flying), a lesson of module 0 its intro and one
// step per sound, scene, trial or round. Every move is tested here; the replay re-derives them.
import { describe, expect, it } from 'vitest';
import type { CueEvent, Vec3 } from '../src/contract';
import { getLesson, lessonAfter, lessonBefore, lessonPaths, type RunnerAction } from '../src/lesson';
import { checkSession, REPLAY_KEY_ACTIONS } from '../src/replay';
import { RecordingHost } from './helpers/record';
import { ScriptedPilot } from './helpers/pilot';

type Say = Extract<RunnerAction, { kind: 'say' }>;
const actionsSince = (p: ScriptedPilot, from: number): RunnerAction[] => p.actions.slice(from);
const says = (actions: readonly RunnerAction[]): Say[] => actions.filter((a): a is Say => a.kind === 'say');
const gos = (actions: readonly RunnerAction[]): string[] => actions.flatMap((a) => (a.kind === 'go' ? [a.to] : []));
/** the sounds a step played (one entry per play) */
const previews = (actions: readonly RunnerAction[]): string[] => actions.flatMap((a) => (a.kind === 'cue' && (a.event.kind === 'preview' || a.event.kind === 'repeat-cue') ? [(a.event as Extract<CueEvent, { kind: 'repeat-cue' }>).cue] : []));

/** a pilot whose lines are said but never reported done: the runner stays in the step it is in until a key moves it */
function slowSpeech(id: string): ScriptedPilot {
    const p = new ScriptedPilot(getLesson(id));
    // the runner's own estimate rules (no spoken report): long enough to press keys in the middle of a step
    (p as unknown as { take: () => void }).take = function (this: ScriptedPilot): void {
        for (let guard = 0; guard < 64; guard++) {
            const a = this.run.takeActions();
            if (a.length === 0) return;
            this.actions.push(...a);
        }
    };
    return p;
}

describe('a flying lesson: the task (step 1) and flying (step 2)', () => {
    it('N in the task starts flying; N while flying goes to the next lesson and marks this one skipped', () => {
        const p = slowSpeech('hover-height');
        p.begin();
        expect(p.run.view()).toMatchObject({ step: 1, stepKind: 'task', phase: 'intro' });
        let from = p.actions.length;
        p.press((run, t) => run.next(t));
        expect(p.run.view()).toMatchObject({ step: 2, stepKind: 'fly', phase: 'flying', attempt: 1 });
        expect(says(actionsSince(p, from))[0]).toMatchObject({ line: { key: 'fly.go' }, interrupt: true });
        p.hold(2);
        from = p.actions.length;
        p.press((run, t) => run.next(t));
        expect(gos(actionsSince(p, from))).toEqual(['next']);
        expect(p.lessonWhat().at(-1)).toBe('leave');
        expect(p.run.progress()).toMatchObject({ passed: false, skipped: true });
        expect(p.run.view().skipped).toBe(true);
        // the runner is done: no more events, keys or actions
        const events = p.events.length;
        p.hold(2);
        p.press((run, t) => run.next(t));
        p.press((run, t) => run.previous(t));
        expect(p.events.length).toBe(events);
        expect(gos(actionsSince(p, from))).toEqual(['next']);
    });

    it('B in the task goes to the previous lesson; B while flying drops the attempt for the task, uncounted', () => {
        const back = slowSpeech('hover-height');
        back.begin();
        back.press((run, t) => run.previous(t));
        expect(gos(back.actions)).toEqual(['previous']);
        expect(back.run.progress().skipped).toBe(false);

        const p = slowSpeech('rings-first');
        p.begin();
        p.press((run, t) => run.next(t));
        const ring = p.object('ring-1').pos;
        p.flyTo([ring[0], ring[1], ring[2] + 2]);
        const from = p.actions.length;
        p.press((run, t) => run.previous(t));
        expect(p.run.view()).toMatchObject({ step: 1, stepKind: 'task', phase: 'intro', counted: 0, failsInARow: 0 });
        expect(says(actionsSince(p, from))[0]).toMatchObject({ line: { key: 'lesson.rings-first.title' }, interrupt: true });
        expect(p.lessonWhat()).not.toContain('attempt-fail');
        // after the task the next attempt begins at the start
        p.press((run, t) => run.next(t));
        expect(p.run.view()).toMatchObject({ step: 2, attempt: 2 });
        const place = actionsSince(p, from).filter((a): a is Extract<RunnerAction, { kind: 'place' }> => a.kind === 'place').at(-1);
        expect(place?.pose).toEqual(getLesson('rings-first').start);
    });

    it('Z in the task says it again from its first line; Z after an attempt says the task and the next attempt follows', () => {
        const p = slowSpeech('hover-height');
        p.begin();
        p.hold(3);
        let from = p.actions.length;
        p.press((run, t) => run.repeat(t));
        // the lines up to the one that names the sounds; the sounds come after them, then the goal line
        expect(says(actionsSince(p, from)).map((a) => a.line.key)).toEqual(['lesson.hover-height.title', 'lesson.hover-height.intro.1', 'lesson.hover-height.intro.2']);
        expect(says(actionsSince(p, from))[0]?.interrupt).toBe(true);
        expect(p.run.view().step).toBe(1);
        // fly out of the band until the attempt runs out of time, then Z in the pause
        p.press((run, t) => run.next(t));
        p.until(() => p.run.phase === 'between', 120);
        from = p.actions.length;
        p.press((run, t) => run.repeat(t));
        expect(says(actionsSince(p, from))[0]).toMatchObject({ line: { key: 'lesson.hover-height.title' }, interrupt: true });
        // no end of speech is reported here: the runner waits for each line at most twice its estimate, then the sounds play
        p.until(() => p.run.phase === 'flying', 200);
        expect(p.run.attempt).toBe(2);
    }, 60000);

    it('Z while flying says the task again while the attempt waits: its time limit and its goals stop meanwhile', () => {
        const lesson = getLesson('hover-height');
        const p = new ScriptedPilot(lesson);
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        p.flyTo([0, 2.5, 0]);
        p.hold(15);
        // 15 s of the 20 s in the band; Z, and the task is said (the pilot here speaks at once, the runner waits for the lines' estimate)
        const slow = p as unknown as { take: () => void };
        const keep = slow.take;
        slow.take = function (this: ScriptedPilot): void {
            for (let guard = 0; guard < 64; guard++) {
                const a = this.run.takeActions();
                if (a.length === 0) return;
                this.actions.push(...a);
            }
        };
        const from = p.actions.length;
        p.press((run, t) => run.repeat(t));
        expect(p.run.view()).toMatchObject({ step: 2, listening: true, phase: 'flying' });
        expect(says(actionsSince(p, from))[0]).toMatchObject({ line: { key: 'lesson.hover-height.title' }, interrupt: true });
        // about a minute of listening (no end of speech is reported: the lines' longest wait), far out of the band: no goal is met or missed meanwhile
        p.flyTo([0, 5, 0]);
        p.until(() => !p.run.view().listening, 120);
        expect(p.of('goal')).toEqual([]);
        expect(says(p.actions).map((a) => a.line.key)).toContain('fly.go-on');
        slow.take = keep;
        // back in the band: the 5 s left of the window, and the goal is met (the waiting did not count)
        p.flyTo([0, 2.5, 0]);
        p.hold(6);
        expect(p.of('goal').map((g) => g.what)).toEqual(['met']);
    }, 60000);

    it('the lesson menu: next lesson and previous lesson at once; a passed lesson is never marked skipped', () => {
        const a = slowSpeech('walls-hall');
        a.begin();
        a.press((run, t) => run.nextLesson(t));
        expect(gos(a.actions)).toEqual(['next']);
        expect(a.run.progress().skipped).toBe(true);
        const b = slowSpeech('walls-hall');
        b.begin();
        b.press((run, t) => run.previousLesson(t));
        expect(gos(b.actions)).toEqual(['previous']);
        expect(b.run.progress().skipped).toBe(false);
        // passed, then N: the next lesson, not skipped
        const c = new ScriptedPilot(getLesson('rings-course'));
        c.begin();
        c.until(() => c.run.phase === 'flying', 10);
        for (const g of c.objects().filter((o) => o.order !== null)) {
            c.flyTo([g.pos[0] + (g.quat[2] * 8), g.pos[1], g.pos[2] + 4]);
            c.flyTo([g.pos[0], g.pos[1], g.pos[2] - 4]);
        }
        expect(c.run.phase).toBe('passed');
        c.press((run, t) => run.next(t));
        expect(gos(c.actions)).toEqual(['next']);
        expect(c.run.progress()).toMatchObject({ passed: true, skipped: false });
    }, 60000);
});

describe('a lesson of module 0: the intro, then one step per sound', () => {
    it('N and B move exactly one step; B from step 1 and N from the last step leave the lesson', () => {
        const p = slowSpeech('ears-glossary');
        p.begin();
        const steps = p.run.view().steps;
        expect(steps).toBe(1 + 27); // the intro and each of its 27 sounds
        const seen: number[] = [p.run.view().step];
        for (let k = 1; k < steps; k++) {
            p.press((run, t) => run.next(t));
            seen.push(p.run.view().step);
        }
        expect(seen).toEqual(Array.from({ length: steps }, (_, i) => i + 1));
        const back: number[] = [];
        for (let k = steps; k > 1; k--) {
            p.press((run, t) => run.previous(t));
            back.push(p.run.view().step);
        }
        expect(back).toEqual(Array.from({ length: steps - 1 }, (_, i) => steps - 1 - i));
        expect(gos(p.actions)).toEqual([]);
        p.press((run, t) => run.previous(t));
        expect(gos(p.actions)).toEqual(['previous']);
        // and from the last step N is the next lesson
        const q = slowSpeech('ears-walls');
        q.begin();
        for (let k = 1; k < q.run.view().steps; k++) q.press((run, t) => run.next(t));
        q.press((run, t) => run.next(t));
        expect(gos(q.actions)).toEqual(['next']);
        expect(q.run.progress().skipped).toBe(true);
    });

    it('each step plays its own sound; Z plays the step again from its first line', () => {
        const p = slowSpeech('ears-glossary');
        p.begin();
        p.press((run, t) => run.next(t));
        p.press((run, t) => run.next(t));
        // step 3: the second sound of the glossary
        expect(p.run.view().step).toBe(3);
        const cue = (getLesson('ears-glossary').goals[0] as { cues: readonly string[] }).cues[1] as string;
        p.until(() => previews(p.actions).length > 0, 30);
        expect(previews(p.actions).at(-1)).toBe(cue);
        const from = p.actions.length;
        p.press((run, t) => run.repeat(t));
        expect(p.run.view().step).toBe(3);
        expect(says(actionsSince(p, from)).map((a) => a.line.key)).toEqual(['glossary.next', `cue.${cue}.name`, `cue.${cue}.glossary`]);
        expect(says(actionsSince(p, from))[0]?.interrupt).toBe(true);
        p.until(() => previews(actionsSince(p, from)).length >= 3, 60);
        expect(previews(actionsSince(p, from))).toEqual([cue, cue, cue]);
    });

    it('N during a question records it skipped and the next trial begins with its own line, cutting the question', () => {
        const p = slowSpeech('ears-headphones');
        p.begin();
        p.press((run, t) => run.next(t));
        expect(p.run.view()).toMatchObject({ step: 2, stepKind: 'trial' });
        p.until(() => p.actions.some((a) => a.kind === 'ask'), 60);
        const from = p.actions.length;
        p.press((run, t) => run.next(t));
        expect(p.of('answer').at(-1)).toMatchObject({ value: null, via: 'skip' });
        expect(p.run.view().step).toBe(3);
        expect(says(actionsSince(p, from))[0]).toMatchObject({ line: { key: 'headphones.trial', params: { n: 2, total: 3 } }, interrupt: true });
    });
});

describe('a lesson opened with G from another one: a detour back to it (review R3)', () => {
    const title = (id: string): string => getLesson(id).title.key;

    it('N through the glossary to its end leaves it as heard, not skipped; control: the same glossary on the ladder is marked skipped', () => {
        for (const returnTo of ['rings-line', null]) {
            const p = new ScriptedPilot(getLesson('ears-glossary'), returnTo === null ? {} : { returnTo });
            p.begin();
            for (let k = 0; k < 40 && gos(p.actions).length === 0; k++) p.press((run, t) => run.next(t));
            expect(gos(p.actions), String(returnTo)).toEqual(['next']);
            expect(p.run.progress(), String(returnTo)).toMatchObject({ passed: false, skipped: returnTo === null });
            expect(p.run.view().skipped).toBe(returnTo === null);
        }
    });

    it('heard to its end, the pass says the way back to the lesson G left; control: on the ladder it names the next lesson on the path', () => {
        const passLine = (o: { returnTo?: string }): Say['line'] | undefined => {
            const p = new ScriptedPilot(getLesson('ears-glossary'), o);
            p.begin();
            p.until(() => p.run.phase === 'passed', 900);
            expect(p.run.phase).toBe('passed');
            return says(p.actions).at(-1)?.line;
        };
        const back = passLine({ returnTo: 'rings-line' });
        expect(back?.key).toBe('fly.back-to');
        expect(back?.params?.['title']).toBe(new ScriptedPilot(getLesson('rings-line')).run.statusLine().params?.['title']);
        const ladder = passLine({});
        expect(ladder?.key).toBe('fly.lesson-passed');
        expect(lessonAfter('ears-glossary', 'full')?.title.key).toBe(title('ears-walls'));
        expect(ladder?.params?.['title']).toBe(new ScriptedPilot(getLesson('ears-walls')).run.statusLine().params?.['title']);
    }, 120000);
});

describe('where a go action leads', () => {
    it('the lesson after and before on the pilot\'s path, the full ladder off it, null at the ends', () => {
        const { full, fast } = lessonPaths();
        expect(lessonAfter('hover-height', 'fast')?.id).toBe(fast[fast.indexOf('hover-height') + 1]);
        expect(lessonBefore('hover-height', 'fast')?.id).toBe('ears-headphones');
        expect(lessonAfter('hover-turn', 'fast')?.id).toBe(full[full.indexOf('hover-turn') + 1]);
        expect(lessonBefore('hover-turn', 'fast')?.id).toBe('hover-height');
        expect(lessonBefore(full[0] as string, 'full')).toBeNull();
        expect(lessonAfter(full.at(-1) as string, 'full')).toBeNull();
    });
});

describe('the replay re-derives what N, B and Z did', () => {
    it('a glossary flown with N, B and Z replays to the same events; without the key events it does not (control)', async () => {
        const host = new RecordingHost(getLesson('ears-glossary'));
        host.begin();
        host.hold(1);
        host.press(REPLAY_KEY_ACTIONS.next);
        host.hold(2);
        host.press(REPLAY_KEY_ACTIONS.next);
        host.hold(1);
        host.press(REPLAY_KEY_ACTIONS.previous);
        host.hold(2);
        host.press(REPLAY_KEY_ACTIONS.repeat);
        host.hold(4);
        host.press(REPLAY_KEY_ACTIONS.nextLesson);
        host.hold(1);
        const { pkg } = await host.toPackage();
        const { check } = checkSession(pkg);
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
        const without = checkSession({ ...pkg, events: pkg.events.filter((e) => e.kind !== 'key') }).check;
        expect(without.ok).toBe(false);
    }, 60000);
});

describe('a key in the same millisecond as a step that was due (found while measuring review R4)', () => {
    it('N as the next attempt begins replays to the same events: the lesson catches up to the key\'s time first', async () => {
        const host = new RecordingHost(getLesson('rings-first'));
        host.begin();
        host.until(() => host.runner.phase === 'flying', 120);
        const ring = host.world?.objects().find((o) => o.id === 'ring-1')?.pos as Vec3;
        host.flyTo([ring[0], ring[1], ring[2] + 3], 4);
        host.flyTo([ring[0], ring[1], ring[2] - 3], 4); // through the ring: the attempt counts, the pause between attempts begins
        host.until(() => host.runner.attempt === 2, 30); // stops in the frame that began attempt 2
        host.press(REPLAY_KEY_ACTIONS.next); // N in that same millisecond: it leaves from attempt 2, as the live runner saw it
        host.hold(1);
        expect(host.events.filter((e) => e.kind === 'lesson').map((e) => (e.kind === 'lesson' ? `${e.what}:${e.attempt}` : '')).slice(-2)).toEqual(['attempt-start:2', 'leave:2']);
        const { pkg } = await host.toPackage();
        const { check } = checkSession(pkg);
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
    }, 60000);
});
