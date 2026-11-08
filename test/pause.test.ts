// Review R8: the lesson menu of M41-3 pauses the flight and speaks through the same speech queue. The lesson
// waits with the flight: pause(t) stops it and resume(t) moves every clock it keeps on by the pause, so a pause
// never counts as time held in a band, never runs an attempt out of time, never times a question out, and never
// starts a sound or a line over the menu (a report of the queue running empty while paused is the menu's).
// Each check has its control: the same host that only stops stepping the runner (v0.12's way, and this lane's
// before the fix) fails it. The replay takes the pause from the host's `session` events.
import { describe, expect, it } from 'vitest';
import type { Goal, SessionEvent, Vec3 } from '../src/contract';
import { getLesson, type RunnerAction } from '../src/lesson';
import { checkSession } from '../src/replay';
import { ScriptedPilot } from './helpers/pilot';
import { RecordingHost } from './helpers/record';

/** The flight paused for `seconds`: no frame meanwhile; `calls`: whether the host tells the runner (the fix) or not (the control). */
function pause(p: ScriptedPilot, seconds: number, calls: boolean): void {
    if (calls) p.press((run, t) => run.pause(t));
    p.t += seconds * 1000;
    if (calls) p.press((run, t) => run.resume(t));
}

const repeatCues = (actions: readonly RunnerAction[]): number => actions.filter((a) => a.kind === 'cue' && a.event.kind === 'repeat-cue').length;

describe('a pause of the flight (the lesson menu) is not lesson time (review R8)', () => {
    it('a question asked before the pause is still open after it; its 20 s to answer leave the pause out; control: it times out at once', () => {
        for (const calls of [true, false]) {
            const p = new ScriptedPilot(getLesson('ears-headphones'));
            p.begin();
            p.until(() => p.actions.some((a) => a.kind === 'ask'), 120);
            const askedAt = p.t;
            pause(p, 60, calls);
            p.tick();
            const skipped = (): boolean => p.of('answer').length > 0;
            if (!calls) {
                expect(skipped()).toBe(true); // the control: the pause ate the time to answer
                continue;
            }
            expect(skipped()).toBe(false);
            p.hold(18);
            expect(skipped()).toBe(false);
            p.hold(3);
            expect(skipped()).toBe(true);
            // it timed out 20 s of lesson time after it was asked: 80 s on the clock with the pause
            expect(((p.of('answer')[0] as SessionEvent).t - askedAt) / 1000).toBeGreaterThan(79.9);
        }
    }, 60000);

    it('hover-height: a pause in the band is not time held; control: the next frame counts the whole pause as held and meets the goal', () => {
        for (const calls of [true, false]) {
            const lesson = getLesson('hover-height');
            const goal = lesson.goals[0] as Extract<Goal, { kind: 'hold-height' }>;
            const p = new ScriptedPilot(lesson);
            p.begin();
            p.until(() => p.run.phase === 'flying', 60);
            p.flyTo([0, (goal.bandM[0] + goal.bandM[1]) / 2, lesson.start.pos[2]]);
            p.hold(3);
            pause(p, goal.seconds + 10, calls);
            p.tick();
            expect(p.of('goal').map((g) => g.what), String(calls)).toEqual(calls ? [] : ['met']);
        }
    }, 60000);

    it('rings-first: a pause longer than the attempt\'s time limit does not fail the attempt; control: it fails at the first frame after', () => {
        for (const calls of [true, false]) {
            const lesson = getLesson('rings-first');
            const p = new ScriptedPilot(lesson);
            p.begin();
            p.until(() => p.run.phase === 'flying', 60);
            const ring = p.object('ring-1').pos;
            p.flyTo([ring[0], ring[1], ring[2] + 3]); // on the way, 3 m before the ring
            pause(p, (lesson.attemptLimitS ?? 60) + 10, calls);
            p.tick();
            expect(p.lessonWhat().includes('attempt-fail'), String(calls)).toBe(!calls);
            if (calls) {
                p.flyTo([ring[0], ring[1], ring[2] - 3]);
                expect(p.lessonWhat()).toContain('attempt-pass');
            }
        }
    }, 60000);

    it('the end of the menu\'s speech starts no sound over the menu; after resume and the report the sound plays three times', () => {
        const p = new ScriptedPilot(getLesson('ears-glossary'));
        // speech is reported by hand here: the runner waits for it
        (p as unknown as { take: () => void }).take = function (this: ScriptedPilot): void {
            for (let guard = 0; guard < 64; guard++) {
                const a = this.run.takeActions();
                if (a.length === 0) return;
                this.actions.push(...a);
            }
        };
        p.begin();
        p.press((run, t) => run.next(t)); // step 2: the first sound's lines, then its three plays
        expect(repeatCues(p.actions)).toBe(0);
        p.press((run, t) => run.pause(t));
        p.hold(1);
        p.press((run, t) => run.spoken(t)); // the menu's lines are over
        p.hold(5);
        expect(repeatCues(p.actions)).toBe(0);
        expect(p.run.view().paused).toBe(true);
        p.press((run, t) => run.resume(t));
        p.press((run, t) => run.spoken(t)); // the host's queue is empty on resume
        p.hold(12);
        expect(repeatCues(p.actions)).toBe(3);
        // control: without the pause the same report starts the sound at once
        const q = new ScriptedPilot(getLesson('ears-glossary'));
        (q as unknown as { take: () => void }).take = (p as unknown as { take: () => void }).take;
        q.begin();
        q.press((run, t) => run.next(t));
        q.hold(1);
        q.press((run, t) => run.spoken(t));
        q.hold(0.1);
        expect(repeatCues(q.actions)).toBe(1);
    }, 60000);

    it('the replay takes the pause from the session events and re-derives the same events; control: without them it does not', async () => {
        const host = new RecordingHost(getLesson('rings-first'));
        host.begin();
        host.until(() => host.runner.phase === 'flying', 60);
        const ring = host.world?.objects().find((o) => o.id === 'ring-1')?.pos as Vec3;
        host.flyTo([ring[0], ring[1], ring[2] + 3], 3);
        host.pauseFor(70);
        host.flyTo([ring[0], ring[1], ring[2] - 3], 3);
        host.hold(2);
        expect(host.events.filter((e) => e.kind === 'lesson' && e.what === 'attempt-pass')).toHaveLength(1);
        const { pkg } = await host.toPackage();
        const { check } = checkSession(pkg);
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
        const without = checkSession({ ...pkg, events: pkg.events.filter((e) => !(e.kind === 'session' && (e.what === 'pause' || e.what === 'resume'))) }).check;
        expect(without.ok).toBe(false);
    }, 60000);
});
