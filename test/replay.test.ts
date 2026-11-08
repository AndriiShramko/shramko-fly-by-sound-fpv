import { beforeAll, describe, expect, it } from 'vitest';
import type { FlightFrame, SessionEvent, SessionManifest, SonicObject } from '../src/contract';
import { getLesson } from '../src/lesson';
import {
    attitudeFromQuat,
    checkSession,
    compareCues,
    compareEvents,
    DEFAULT_TOLERANCES,
    formatReplayCheck,
    frameToSample,
    rebuildSession,
    REPLAY_KEY_ACTIONS,
    Replayer,
    replayFlight,
    ReplayError,
    SPEECH_END_KEY
} from '../src/replay';
import type { SessionPackage } from '../src/session';
import { quatRotate, yawQuat } from '../src/util/vec';
import { RecordingHost, type HostOptions } from './helpers/record';

const gatesOf = (host: RecordingHost): SonicObject[] => (host.world?.objects() ?? []).filter((o) => o.order !== null);

/** Flies through every gate in order along its axis, with a contact at gate number `touchAtGate` (0-based). */
function flyCourse(host: RecordingHost, speed = 6, touchAtGate = -1): void {
    gatesOf(host).forEach((g, k) => {
        const f = quatRotate(g.quat, [0, 0, -1]);
        host.flyTo([g.pos[0] - f[0] * 5, g.pos[1] - f[1] * 5, g.pos[2] - f[2] * 5], speed);
        if (k === touchAtGate) host.touch();
        host.flyTo([g.pos[0] + f[0] * 5, g.pos[1] + f[1] * 5, g.pos[2] + f[2] * 5], speed);
    });
}

const kinds = (events: readonly SessionEvent[], kind: SessionEvent['kind']): SessionEvent[] => events.filter((e) => e.kind === kind);
const lessonSteps = (events: readonly SessionEvent[]): string[] => events.filter((e) => e.kind === 'lesson').map((e) => (e.kind === 'lesson' ? e.what : ''));

/** rings-course: a failed attempt (a contact, and maxTouches is 0), then a clean one: the lesson is passed. */
async function ringsCourse(options: HostOptions = {}): Promise<{ host: RecordingHost; pkg: SessionPackage }> {
    const host = new RecordingHost(getLesson('rings-course'), options);
    host.begin();
    host.until(() => host.runner.phase === 'flying', 120);
    flyCourse(host, 6, 2);
    host.until(() => host.runner.attempt === 2 && host.runner.phase === 'flying', 120);
    flyCourse(host);
    host.until(() => host.runner.phase === 'passed', 60);
    host.hold(2);
    return { host, pkg: (await host.toPackage()).pkg };
}

/** rings-first: one ring; the first attempt passes, the pause goes by, the second attempt begins. */
async function ringsFirst(options: HostOptions = {}): Promise<{ host: RecordingHost; pkg: SessionPackage }> {
    const host = new RecordingHost(getLesson('rings-first'), options);
    host.begin();
    host.until(() => host.runner.phase === 'flying', 120);
    flyCourse(host, 5);
    host.until(() => host.runner.attempt === 2 && host.runner.phase === 'flying', 120);
    host.hold(2);
    return { host, pkg: (await host.toPackage()).pkg };
}

/** walls-hall with the pilot's keys: next, a reset to the checkpoint (none: the start) and a long reset, and a contact. */
async function wallsHall(options: HostOptions = {}): Promise<{ host: RecordingHost; pkg: SessionPackage }> {
    const host = new RecordingHost(getLesson('walls-hall'), options);
    host.begin();
    host.until(() => host.runner.phase === 'flying', 120);
    host.flyTo([0, 1.5, -27.5], 3);
    host.hold(1.2);
    host.press(REPLAY_KEY_ACTIONS.next);
    host.until(() => host.runner.phase === 'flying', 20);
    host.flyTo([0, 1.5, -20], 3);
    host.touch();
    host.flyTo([0, 1.5, -24], 3);
    host.press(REPLAY_KEY_ACTIONS.resetCheckpoint);
    host.hold(0.5);
    host.press(REPLAY_KEY_ACTIONS.resetStart);
    host.flyTo([0, 1.5, -27.5], 3);
    host.hold(1.5);
    host.hold(3);
    return { host, pkg: (await host.toPackage()).pkg };
}

/** ears-headphones: module 0, no world: questions asked by digits, answered by the pilot. */
async function earsHeadphones(options: HostOptions = {}): Promise<{ host: RecordingHost; pkg: SessionPackage }> {
    const host = new RecordingHost(getLesson('ears-headphones'), { answerer: (_q, i) => [1, 2, 2][i] ?? 0, ...options });
    host.begin();
    host.until(() => host.runner.phase === 'passed', 400);
    host.hold(1);
    return { host, pkg: (await host.toPackage()).pkg };
}

const mapFrames = (frames: readonly FlightFrame[], by: (f: FlightFrame) => FlightFrame): FlightFrame[] => frames.map(by);

describe('frames back to samples', () => {
    it('works out yaw, pitch and roll as the simulator does', () => {
        for (const yaw of [-170, -90, -33, 0, 45, 90, 179]) {
            const a = attitudeFromQuat(yawQuat(yaw));
            expect(a.yawDeg).toBeCloseTo(yaw, 6);
            expect(a.pitchDeg).toBeCloseTo(0, 6);
            expect(a.rollDeg).toBeCloseTo(0, 6);
        }
        // nose down 30 degrees: a rotation about the body's right axis (+X)
        const half = (30 * Math.PI) / 360;
        const down = attitudeFromQuat([Math.cos(half), -Math.sin(half), 0, 0]);
        expect(down.pitchDeg).toBeCloseTo(30, 6);
        // right side down 20 degrees: a rotation about the nose, -Z, by minus 20 degrees
        const r = (20 * Math.PI) / 360;
        expect(attitudeFromQuat([Math.cos(r), 0, 0, -Math.sin(r)]).rollDeg).toBeCloseTo(20, 6);
    });

    it('rebuilds the sample, the body rate and the pause flag', () => {
        const f0: FlightFrame = { t: 1000, tick: 1000, p: [1, 2, 3], v: [0, 0, -2], q: yawQuat(0), s: [0, 0, 0, 0], c: [] };
        const f1: FlightFrame = { t: 1033, tick: 1033, p: [1, 2, 2.9], v: [0, 0, -2], q: yawQuat(10), s: [0.1, 0, 0, 0], c: [] };
        const s0 = frameToSample(f0, null);
        expect(s0.rate).toEqual([0, 0, 0]);
        expect(s0.paused).toBe(false);
        expect(s0.armed).toBe(true);
        const s1 = frameToSample(f1, f0, { touched: true });
        expect(s1.touched).toBe(true);
        expect(s1.yawDeg).toBeCloseTo(10, 6);
        // 10 degrees about the up axis in 33 ms: 5.3 rad/s
        expect(Math.abs(s1.rate[1])).toBeGreaterThan(5);
        expect(Math.abs(s1.rate[1])).toBeLessThan(5.6);
        expect(frameToSample({ ...f1, tick: 1000 }, f0).paused).toBe(true);
    });
});

describe('the replay of a recorded flight: rings-course, a failed attempt then a clean one', () => {
    let pkg: SessionPackage;

    beforeAll(async () => {
        pkg = (await ringsCourse()).pkg;
    }, 120000);

    it('recorded what a lesson records', () => {
        expect(pkg.problems).toEqual([]);
        expect(lessonSteps(pkg.events)).toEqual(['open', 'intro', 'attempt-start', 'attempt-fail', 'attempt-start', 'attempt-pass', 'block-pass', 'passed']);
        expect(kinds(pkg.events, 'gate')).toHaveLength(12);
        expect(kinds(pkg.events, 'touch')).toHaveLength(1);
        expect(pkg.frames.length).toBeGreaterThan(1000);
        expect(pkg.events.some((e) => e.kind === 'speech' && e.key === SPEECH_END_KEY)).toBe(true);
    });

    it('re-derives every event within the tolerances, and the cues of at least 95 % of the frames', () => {
        const { check, setup } = checkSession(pkg);
        expect(setup.exact).toBe(true);
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
        expect(check.events.recorded).toBe(check.events.matched);
        expect(check.events.byKind.gate).toEqual({ recorded: 12, derived: 12, matched: 12 });
        expect(check.events.byKind.touch.matched).toBe(1);
        expect(check.events.maxDeltaMs).toBeLessThanOrEqual(DEFAULT_TOLERANCES.timeMs);
        expect(check.cues.share).toBeGreaterThanOrEqual(DEFAULT_TOLERANCES.minCueShare);
        expect(check.cues.classShare).toBeGreaterThanOrEqual(check.cues.share);
        expect(formatReplayCheck(check)).toMatch(/^replay check PASS: events \d+ of \d+ re-derived/);
    });

    it('a derived list that is off fails the comparer, for each way of being off (control for the comparer itself)', () => {
        const { result } = checkSession(pkg);
        const wrong = result.derivedEvents.map((e) => (e.kind === 'gate' && e.index === 2 ? { ...e, missM: e.missM + 0.5 } : e));
        const c = compareEvents(pkg.events, wrong);
        expect(c.diffs.map((d) => d.problem)).toEqual(['value', 'value']);
        expect(c.diffs[0]?.detail).toMatch(/miss/);
        const late = result.derivedEvents.map((e) => (e.kind === 'goal' ? { ...e, t: e.t + 250 } : e));
        expect(compareEvents(pkg.events, late).diffs.map((d) => d.problem)).toEqual(['time', 'time']);
        const dropped = result.derivedEvents.filter((e) => !(e.kind === 'gate' && e.index === 4));
        expect(compareEvents(pkg.events, dropped).diffs.map((d) => d.problem)).toEqual(['missing', 'missing']);
        const extra = [...result.derivedEvents, { t: 1, kind: 'checkpoint', id: 'cp-x' } as SessionEvent];
        expect(compareEvents(pkg.events, extra).diffs.map((d) => d.problem)).toEqual(['extra']);
        expect(compareCues(pkg.frames, pkg.frames.map(() => [])).share).toBeLessThan(0.5);
    });
});

describe('what the replay needs from the recording, and what it checks', () => {
    let first: { host: RecordingHost; pkg: SessionPackage };

    beforeAll(async () => {
        first = await ringsFirst();
    }, 60000);

    it('replays a lesson whose host never called spoken(): the runner estimates speech time, as the host did', async () => {
        const { pkg } = await ringsFirst({ speechEnds: 'estimate' });
        expect(pkg.events.some((e) => e.kind === 'speech' && e.key === SPEECH_END_KEY)).toBe(false);
        const { check } = checkSession(pkg);
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
        // the note is there for hosts that did call spoken() and did not write the marker
        expect(check.notes.some((n) => n.code === 'no-speech-end-markers')).toBe(true);
    });

    it('fails when the host called spoken() but wrote no markers (control: its speech took less time than the estimate)', () => {
        const stripped = first.pkg.events.filter((e) => !(e.kind === 'speech' && e.key === SPEECH_END_KEY));
        const { check } = checkSession({ ...first.pkg, events: stripped });
        expect(check.ok).toBe(false);
        expect(check.events.diffs.length).toBeGreaterThan(0); // the estimate is longer than the real speech: the attempt starts later, or never in the frames
        expect(check.notes.map((n) => n.code)).toContain('no-speech-end-markers');
        // and with the markers it passes: the recording is the same
        expect(checkSession(first.pkg).check.ok).toBe(true);
    });

    it('fails when the flight is not the recorded one: the track moved 2.5 m sideways (negative control)', () => {
        const frames = mapFrames(first.pkg.frames, (f) => ({ ...f, p: [f.p[0] + 2.5, f.p[1], f.p[2]] }));
        const { check } = checkSession({ ...first.pkg, frames });
        expect(check.ok).toBe(false);
        expect(check.events.diffs.length).toBeGreaterThan(0);
        expect(formatReplayCheck(check)).toMatch(/^replay check FAIL/);
    });

    it('fails when the frames and the events are not on one clock: 400 ms apart (negative control)', () => {
        const frames = mapFrames(first.pkg.frames, (f) => ({ ...f, t: f.t + 400, tick: f.tick + 400 }));
        const { check } = checkSession({ ...first.pkg, frames });
        expect(check.ok).toBe(false);
        expect(check.events.diffs.length).toBeGreaterThan(0);
    });

    it('fails when a recorded event is missing from the replay, or one is not recorded (negative control)', () => {
        const noGate = first.pkg.events.filter((e) => e.kind !== 'gate');
        const a = checkSession({ ...first.pkg, events: noGate }).check;
        expect(a.ok).toBe(false);
        expect(a.events.diffs.every((d) => d.problem === 'extra')).toBe(true);
        const fake: SessionEvent = { t: 5000, kind: 'checkpoint', id: 'cp-9' };
        const b = checkSession({ ...first.pkg, events: [...first.pkg.events, fake] }).check;
        expect(b.ok).toBe(false);
        expect(b.events.diffs.map((d) => d.problem)).toEqual(['missing']);
    });

    it('fails when the recorded cues are not the ones that sound (negative control)', () => {
        const frames = mapFrames(first.pkg.frames, (f) => ({ ...f, c: ['room.bed'] }));
        const { check } = checkSession({ ...first.pkg, frames });
        expect(check.events.diffs).toEqual([]);
        expect(check.cues.share).toBeLessThan(DEFAULT_TOLERANCES.minCueShare);
        expect(check.ok).toBe(false);
        expect(check.cues.mismatches.length).toBeGreaterThan(0);
    });

    it("says when the build is not the recording's own: another lesson version, theme version or an unknown theme", () => {
        const m = first.pkg.manifest;
        // a recording made with v0.12 (lesson version 1): said plainly, not a silent failure
        const lesson = { ...(m.lesson as NonNullable<SessionManifest['lesson']>), version: 1 };
        const a = checkSession({ ...first.pkg, manifest: { ...m, lesson } });
        expect(a.setup.exact).toBe(false);
        expect(a.setup.notes.map((n) => n.code)).toEqual(['lesson-version']);
        expect(formatReplayCheck(a.check)).toMatch(/not the recording's own build: lesson rings-first is version 2 here, the session was flown with 1/);
        expect(rebuildSession({ ...m, theme: { id: 'soft', version: 9 } }).notes.map((n) => n.code)).toEqual(['theme-version']);
        expect(rebuildSession({ ...m, theme: { id: 'my-own', version: 1 } }).notes.map((n) => n.code)).toEqual(['unknown-theme']);
        expect(rebuildSession(m).exact).toBe(true);
    });

    it('refuses what it cannot rebuild, naming why', () => {
        const m = first.pkg.manifest;
        expect(() => rebuildSession({ ...m, lesson: { id: 'warp-lesson', version: 1, path: 'full' } })).toThrow(ReplayError);
        try {
            rebuildSession({ ...m, lesson: { id: 'warp-lesson', version: 1, path: 'full' } });
        } catch (e) {
            expect((e as ReplayError).code).toBe('unknown-lesson');
        }
        const garden = { ...m, lesson: { id: 'free-garden', version: 1, path: 'full' as const }, scene: { kind: 'scan' as const, id: '7a475d38', version: 1, transform: [5, 0, 0, 0] as const } };
        expect(() => rebuildSession(garden)).toThrow(/pass the simulator's world/);
        const without = rebuildSession(garden, { world: null });
        expect(without.world).toBeNull();
        expect(without.notes.map((n) => n.code)).toContain('no-world');
    });
});

describe('keys, contacts and resets: walls-hall', () => {
    it("re-derives the events that follow the pilot's keys and a contact", async () => {
        const { pkg } = await wallsHall();
        expect(kinds(pkg.events, 'key').map((e) => (e.kind === 'key' ? e.action : ''))).toEqual(['next', 'reset.checkpoint', 'reset.start']);
        expect(kinds(pkg.events, 'touch')).toHaveLength(1);
        expect(kinds(pkg.events, 'reset').length).toBeGreaterThanOrEqual(2);
        const { check } = checkSession(pkg);
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
        expect(check.events.byKind.touch).toEqual({ recorded: 1, derived: 1, matched: 1 });
        // control: without the key events the replay cannot explain the resets
        const without = checkSession({ ...pkg, events: pkg.events.filter((e) => e.kind !== 'key') }).check;
        expect(without.ok).toBe(false);
        expect(without.events.diffs.length).toBeGreaterThan(0);
    }, 60000);
});

describe('questions and answers: ears-headphones, module 0', () => {
    it('re-derives the lesson from the answers the pilot gave', async () => {
        const { pkg } = await earsHeadphones();
        expect(kinds(pkg.events, 'answer')).toHaveLength(3);
        expect(lessonSteps(pkg.events)).toContain('passed');
        const { check } = checkSession(pkg);
        expect(check.events.diffs).toEqual([]);
        expect(check.ok).toBe(true);
        expect(check.events.byKind.answer.matched).toBe(3);
        // control: other answers give another lesson
        const swapped = pkg.events.map((e) => (e.kind === 'answer' && e.item.endsWith(':1:side') ? { ...e, value: 2 } : e));
        expect(checkSession({ ...pkg, events: swapped as SessionEvent[] }).check.ok).toBe(false);
    }, 60000);
});

describe('stepping, seeking and sessions without events', () => {
    it('steps frame by frame to the same result as running to the end, and a seek back gives the same step', async () => {
        const { pkg } = await ringsFirst();
        const input = { setup: rebuildSession(pkg.manifest), frames: pkg.frames, events: pkg.events };
        const whole = replayFlight(input);
        const r = new Replayer(input);
        const steps = [];
        for (let s = r.step(); s !== null; s = r.step()) steps.push(s);
        expect(steps).toHaveLength(pkg.frames.length);
        expect(r.done).toBe(true);
        expect(r.result().derivedEvents).toEqual(whole.derivedEvents);
        expect(r.result().cues).toEqual(whole.cues);
        expect(steps.map((s) => s.cues)).toEqual(whole.cues);
        // the steps carry what a viewer feeds the engine
        expect(steps[0]?.input.floorY).toBe(0);
        expect(steps.some((s) => s.actions.some((a) => a.kind === 'cue' && a.event.kind === 'gate'))).toBe(true);
        // seek back to the middle: the step is the one seen before
        const mid = Math.floor(steps.length / 2);
        expect(r.seek(mid)).toEqual(steps[mid]);
        expect(r.position).toBe(mid + 1);
        // and on to the end again
        r.runToEnd();
        expect(r.result().derivedEvents).toEqual(whole.derivedEvents);
    }, 60000);

    it('replays frames with no recorded events: the lesson begins at the first frame, cues are still derived', async () => {
        const { pkg } = await ringsFirst();
        const setup = rebuildSession(pkg.manifest);
        const result = replayFlight({ setup, frames: pkg.frames });
        expect(result.cues).toHaveLength(pkg.frames.length);
        expect(result.derivedEvents.some((e) => e.kind === 'lesson' && e.what === 'open')).toBe(true);
        expect(result.progress?.lessonId).toBe('rings-first');
        // and with no lesson at all: only cues
        const free = replayFlight({ setup: { ...setup, lesson: null, world: null }, frames: pkg.frames });
        expect(free.derivedEvents).toEqual([]);
        expect(free.progress).toBeNull();
        expect(free.cues).toHaveLength(pkg.frames.length);
    }, 60000);

    it('compares an empty recording with an empty replay', () => {
        expect(compareEvents([], []).diffs).toEqual([]);
        expect(compareCues([], []).share).toBe(1);
    });
});
