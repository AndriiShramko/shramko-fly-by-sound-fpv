// A free flight does not undo what the pilot flew while its task was said (train 3, the owner's message 54: "I just want to
// open a scan and fly"). RunnerOptions.freeFlight: the first attempt begins where the craft is when the task ends; without it a
// course's first attempt still begins at its start when the craft left it during the task (the corridor's rule, review R9).
// And the narrator setting (SonicPrefs.narrator): on by default, kept, a document written before it still valid.
import { describe, expect, it } from 'vitest';
import type { FlightSample, SessionEvent, Vec3 } from '../src/contract';
import { createLessonRunner, scanFreeLesson } from '../src/lesson';
import type { RunnerAction } from '../src/lesson/runner';
import { defaultPrefs, readPrefs, validatePrefs } from '../src/prefs';

function sample(t: number, pos: Vec3, vel: Vec3): FlightSample {
    return { t, tick: t, pos, vel, quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0.5, 0, 0], armed: true, touched: false, paused: false };
}

/** The pilot flies 4 m/s forward from the first frame while the task is said; what the runner does when the task ends. */
function flyDuringTask(freeFlight: boolean): { places: RunnerAction[]; resets: SessionEvent[]; flyingAt: number | null } {
    const lesson = scanFreeLesson('887f27aa', [1, 0, 0, 0]);
    const run = createLessonRunner(lesson, { start: { pos: [0, 1, 0], yawDeg: 0 }, ...(freeFlight ? { freeFlight: true } : {}) });
    const events: SessionEvent[] = [...run.begin(0)];
    run.takeActions(); // the place at the lesson's start (the craft is put there before the first frame)
    const places: RunnerAction[] = [];
    let flyingAt: number | null = null;
    for (let t = 50; t <= 60000; t += 50) {
        const pos: Vec3 = [0, 1, -4 * (t / 1000)];
        events.push(...run.step(sample(t, pos, [0, 0, -4]), null));
        if (t % 1000 === 0) events.push(...run.spoken(t));
        for (const a of run.takeActions()) if (a.kind === 'place') places.push(a);
        if (flyingAt === null && run.phase === 'flying') flyingAt = t;
        if (flyingAt !== null && t > flyingAt + 1000) break;
    }
    return { places, resets: events.filter((e) => e.kind === 'reset'), flyingAt };
}

describe('free flight: the task is said over the flight (train 3, message 54)', () => {
    it('freeFlight: the first attempt begins where the craft is; nothing flown during the task is undone', () => {
        const free = flyDuringTask(true);
        expect(free.flyingAt).not.toBeNull();
        expect(free.places).toEqual([]);
        expect(free.resets).toEqual([]);
    });

    it('control: without freeFlight the craft that left the start during the task is sent back once', () => {
        const course = flyDuringTask(false);
        expect(course.flyingAt).not.toBeNull();
        expect(course.places.filter((a) => a.kind === 'place' && a.to === 'start')).toHaveLength(1);
        expect(course.resets).toHaveLength(1);
    });
});

describe('SonicPrefs.narrator (train 3)', () => {
    it('is on by default, valid either way, and a document written before it is still valid and reads as on', () => {
        expect(defaultPrefs().narrator).toBe(true);
        expect(validatePrefs({ ...defaultPrefs(), narrator: false }).ok).toBe(true);
        expect(validatePrefs({ ...defaultPrefs(), narrator: 'no' }).ok).toBe(false);
        const old: Record<string, unknown> = { ...defaultPrefs() };
        delete old['narrator'];
        expect(validatePrefs(old).ok).toBe(true);
        expect(readPrefs(old).prefs.narrator).toBe(true);
        const kept = readPrefs({ ...defaultPrefs(), narrator: false });
        expect(kept.prefs.narrator).toBe(false);
        expect(kept.issues).toEqual([]);
    });
});
