// The digit keys of the headphone check (the owner's complaint of 2026-11-10, simulator plan docs/wip/sonic-keys-plan.md):
// a digit pressed while the trial's sound plays answers it, every digit is acknowledged by a short sound and a word, a
// wait for an answer is never silent, a failed check asks again only what failed, without its intro, and asks only left and right.
import { describe, expect, it } from 'vitest';
import type { CueEvent, FlightSample, SessionEvent } from '../src/contract';
import { ASK_TIMEOUT_S, createLessonRunner, getLesson, type LessonSession, type RunnerAction } from '../src/lesson';
import { yawQuat } from '../src/util/vec';

const sampleAt = (t: number): FlightSample => ({ t, tick: t, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false });

interface Logged {
    readonly t: number;
    readonly a: RunnerAction;
}

/** A host that says every line at once and steps every 50 ms; `onAction` may press a digit (returns its value) at any action. */
class Host {
    readonly run: LessonSession = createLessonRunner(getLesson('ears-headphones'));
    readonly log: Logged[] = [];
    readonly events: SessionEvent[] = [];
    t = 0;
    /** `speak`: the host reports every line said at once; false: it never does (the runner waits out its fallback time) */
    constructor(
        private readonly onAction: (a: RunnerAction, h: Host) => number | null = () => null,
        private readonly speak = true
    ) {
        this.events.push(...this.run.begin(0));
        this.take();
    }
    take(): void {
        for (let guard = 0; guard < 50; guard++) {
            const actions = this.run.takeActions();
            if (actions.length === 0) return;
            for (const a of actions) this.log.push({ t: this.t, a });
            if (this.speak && actions.some((a) => a.kind === 'say')) this.events.push(...this.run.spoken(this.t));
            for (const a of actions) {
                const n = this.onAction(a, this);
                if (n !== null) this.events.push(...this.run.answer(n, 'key', this.t));
            }
        }
    }
    press(n: number): void {
        this.events.push(...this.run.answer(n, 'key', this.t));
        this.take();
    }
    until(done: (h: Host) => boolean, limitS = 200): void {
        for (const end = this.t + limitS * 1000; this.t < end && !done(this); ) {
            this.t += 50;
            this.events.push(...this.run.step(sampleAt(this.t), null));
            this.take();
        }
    }
    said(): string[] {
        return this.log.flatMap((l) => (l.a.kind === 'say' ? [l.a.line.key] : []));
    }
    cues(): CueEvent[] {
        return this.log.flatMap((l) => (l.a.kind === 'cue' ? [l.a.event] : []));
    }
    answers(): Extract<SessionEvent, { kind: 'answer' }>[] {
        return this.events.filter((e): e is Extract<SessionEvent, { kind: 'answer' }> => e.kind === 'answer');
    }
    asks(): string[] {
        return this.log.flatMap((l) => (l.a.kind === 'ask' ? [l.a.question.id] : []));
    }
}

const isPlay = (a: RunnerAction): boolean => a.kind === 'cue' && a.event.kind === 'repeat-cue';
const failed = (h: Host): boolean => h.events.some((e) => e.kind === 'lesson' && e.what === 'attempt-fail');

describe('sonic-keys (a): a digit pressed while the trial sounds is taken', () => {
    it('answers trial 1 at its first play and trial 2 at its second, with no question asked yet', () => {
        let plays = 0;
        const h = new Host((a) => {
            if (!isPlay(a)) return null;
            plays++;
            return plays === 1 ? 1 : plays === 3 ? 2 : null; // trial 2's sound starts again at play 1 of 3: the 3rd play overall is its 2nd
        });
        h.until((x) => x.answers().length >= 2, 120);
        const got = h.answers();
        expect(got.map((a) => [a.value, a.via])).toEqual([
            [1, 'key'],
            [2, 'key']
        ]);
        // taken during the sound: the question's lines were never said
        expect(h.said()).not.toContain('headphones.q-side');
    });

    it('a digit before the sound plays is not taken (the pilot has heard nothing yet)', () => {
        const h = new Host(undefined, false);
        h.press(1);
        expect(h.answers()).toEqual([]);
    });
});

describe('sonic-keys (b): every digit is acknowledged by a short sound and a word', () => {
    it('a taken answer: the answer sound and "taken", said first, cutting what was being said', () => {
        let done = false;
        const h = new Host((a) => (!done && isPlay(a) ? ((done = true), 2) : null));
        h.until((x) => x.answers().length >= 1, 60);
        h.until(() => false, 0.2);
        const i = h.log.findIndex((l) => l.a.kind === 'say' && l.a.line.key === 'answer.got');
        expect(i).toBeGreaterThan(-1);
        const got = h.log[i]?.a as Extract<RunnerAction, { kind: 'say' }>;
        expect(got.line.params?.['n']).toBe(2);
        expect(got.interrupt).toBe(true);
        expect(h.cues()).toContainEqual({ kind: 'answer', what: 'yes' });
        const next = h.log.findIndex((l, k) => k > i && l.a.kind === 'say' && l.a.line.key === 'headphones.trial');
        expect(next).toBeGreaterThan(i);
    });

    it('a digit with nothing to answer, and one out of range: the "no" sound and a word', () => {
        const h = new Host(undefined, false);
        h.press(1);
        expect(h.cues()).toContainEqual({ kind: 'answer', what: 'no' });
        // pressed during the intro: the word waits for the intro's lines (review I1), then comes before what follows
        expect(h.said()).not.toContain('answer.not-now');
        h.until((x) => x.said().includes('answer.not-now'), 60);
        const said = h.said();
        expect(said.indexOf('answer.not-now')).toBeGreaterThan(said.indexOf('lesson.ears-headphones.goal.1'));
        expect(said.filter((k) => k === 'answer.not-now')).toHaveLength(1);
        // the question of trial 1 asked (lines said at once), then a 7
        const q = new Host();
        q.until((x) => x.asks().length > 0, 60);
        q.press(7);
        expect(q.answers()).toEqual([]);
        expect(q.cues()).toContainEqual({ kind: 'answer', what: 'no' });
        const range = q.log.find((l) => l.a.kind === 'say' && l.a.line.key === 'answer.range')?.a as Extract<RunnerAction, { kind: 'say' }> | undefined;
        expect(range?.line.params?.['max']).toBe(3);
    });
});

describe('sonic-keys (c): no long silence and no silent skip', () => {
    it('a question left unanswered: a waiting sound and the keys again, then the skip said in words before the next trial', () => {
        const h = new Host();
        h.until((x) => x.asks().length > 0, 60);
        const asked = h.t;
        h.until((x) => x.answers().length > 0, ASK_TIMEOUT_S + 10);
        const waits = h.log.filter((l) => l.t > asked && l.a.kind === 'say' && l.a.line.key === 'answer.waiting');
        expect(waits.length).toBeGreaterThanOrEqual(1);
        // no gap of more than 8 s without a word or a sound after the question
        const marks = [asked, ...h.log.filter((l) => l.t > asked && (l.a.kind === 'say' || l.a.kind === 'cue')).map((l) => l.t)];
        for (let k = 1; k < marks.length; k++) expect((marks[k] as number) - (marks[k - 1] as number)).toBeLessThanOrEqual(8000);
        expect(h.cues()).toContainEqual({ kind: 'answer', what: 'wait' });
        expect(h.answers()[0]?.via).toBe('skip');
        h.until(() => false, 0.5);
        const said = h.said();
        const timeout = said.indexOf('answer.timeout');
        expect(timeout).toBeGreaterThan(-1);
        expect(said.indexOf('headphones.trial', timeout)).toBeGreaterThan(timeout);
    });

    it('waits with a paused lesson: no reminder and no skip while paused', () => {
        const h = new Host();
        h.until((x) => x.asks().length > 0, 60);
        h.run.pause(h.t);
        const before = h.log.length;
        for (let k = 0; k < 600; k++) {
            h.t += 50;
            h.run.step(sampleAt(h.t), null);
            h.take();
        }
        expect(h.log.slice(before).filter((l) => l.a.kind === 'say')).toEqual([]);
        expect(h.answers()).toEqual([]);
    });
});

describe('sonic-keys (d): a failed check asks again only what failed, without its intro', () => {
    it('trial 2 answered wrong: attempt 2 is that one trial, with no headphone intro', () => {
        const h = new Host((a) => (a.kind === 'ask' ? (a.question.id.split(':')[2] === '2' ? 1 : a.question.id.split(':')[2] === '1' ? 1 : 1) : null));
        h.until(failed, 200);
        const firstFail = h.log.length;
        const introKeys = ['headphones.intro', 'headphones.wired', 'headphones.os-spatial'];
        h.until((x) => x.run.phase === 'passed' || x.events.filter((e) => e.kind === 'lesson' && e.what === 'attempt-fail').length >= 2, 200);
        const second = h.log.slice(firstFail);
        const secondSaid = second.flatMap((l) => (l.a.kind === 'say' ? [l.a.line.key] : []));
        for (const k of introKeys) expect(secondSaid, k).not.toContain(k);
        const secondAsks = second.flatMap((l) => (l.a.kind === 'ask' ? [l.a.question.id] : []));
        expect(secondAsks.length).toBe(1);
        expect(secondAsks[0]?.split(':')[1]).toBe('2');
        // it was the right-hand trial; answered 1 (left) again it fails again, answered 2 it passes
        const h2 = new Host((a) => (a.kind === 'ask' ? (a.question.id.split(':')[1] === '1' && a.question.id.split(':')[2] === '2' ? 1 : a.question.id.split(':')[2] === '2' || a.question.id.split(':')[1] === '2' ? 2 : 1) : null));
        h2.until((x) => x.run.phase === 'passed', 300);
        expect(h2.run.phase).toBe('passed');
    });

    it('the repeat key on trial 1 plays its sound again without the headphone intro', () => {
        const h = new Host();
        h.until((x) => x.asks().length > 0, 60);
        const from = h.log.length;
        h.run.repeat(h.t);
        h.take();
        h.until((x) => x.asks().length > 1, 60);
        const again = h.log.slice(from).flatMap((l) => (l.a.kind === 'say' ? [l.a.line.key] : []));
        expect(again).toContain('headphones.trial');
        expect(again).not.toContain('headphones.intro');
    });
});

describe('sonic-keys (e): the headphone check asks left and right only', () => {
    it('no front-and-back question, three trials left, right, left', () => {
        const h = new Host((a) => (a.kind === 'ask' ? (a.question.id.split(':')[2] === '2' ? 2 : 1) : null));
        h.until((x) => x.run.phase === 'passed', 200);
        expect(h.run.phase).toBe('passed');
        expect(h.asks().some((id) => id.endsWith(':front-back'))).toBe(false);
        expect(h.said()).not.toContain('headphones.q-front-back');
        const dirs = h.log.flatMap((l) => (l.a.kind === 'cue' && l.a.event.kind === 'repeat-cue' && l.a.event.index === 1 ? [l.a.event.dir?.[0]] : []));
        expect(dirs).toEqual([-1, 1, -1]);
    });
});
