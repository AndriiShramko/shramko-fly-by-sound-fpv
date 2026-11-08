// Never silence in a flying lesson (v0.13, M41-10, the planner's part; owner's message 41): the height tone
// does not fall silent inside the band, and a quiet room bed stays on, between attempts too, so silence
// always means something is wrong. The motor (M41-16) is the host's and the motor bus's; the near-silence
// of v0.12's soft height tone (a pad swirling to its sub-octave every 3.3 s) is the engine's, measured by
// the virtual listener's rig.
import { describe, expect, it } from 'vitest';
import type { LessonDef } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { RecordingHost } from './helpers/record';

const flying = (l: LessonDef): boolean => l.world.kind !== 'none';

/** The ids that sound in each recorded frame from the first attempt on (intro speech excluded). */
function framesAfterStart(host: RecordingHost): string[][] {
    const start = host.events.find((e) => e.kind === 'lesson' && e.what === 'attempt-start');
    expect(start).toBeDefined();
    return host.frames.filter((f) => f.t >= (start as { t: number }).t).map((f) => [...f.c]);
}

const hasHeight = (ids: readonly string[]): boolean => ids.includes('height.tone') || ids.includes('height.rough');

describe('a flying lesson is never silent', () => {
    it('every flying lesson has the height tone and the room bed on', () => {
        const flyingLessons = SHIPPED_LESSON_IDS.map((id) => getLesson(id)).filter(flying);
        expect(flyingLessons.length).toBeGreaterThanOrEqual(16);
        for (const l of flyingLessons) {
            expect(l.layers.on, l.id).toContain('height');
            expect(l.layers.on, l.id).toContain('room');
        }
    });

    it('hover-height: the height tone in every frame, inside the band and out, and the bed between attempts too', () => {
        const host = new RecordingHost(getLesson('hover-height'));
        host.begin();
        host.until(() => host.runner.phase === 'flying', 120);
        // climb into the band (2 to 3 m) and hold it to the end of the attempt, then on through the pause
        host.flyTo([0, 2.5, 0], 0.8);
        host.until(() => host.runner.phase === 'between', 60);
        expect(host.runner.phase).toBe('between');
        host.hold(1);
        const frames = framesAfterStart(host);
        expect(frames.length).toBeGreaterThan(600);
        for (const ids of frames) {
            expect(hasHeight(ids), ids.join(' ')).toBe(true);
            expect(ids).toContain('room.bed');
        }
        // inside the band it is the steady tone with its target, not the rough one
        const last = frames.at(-1) as string[];
        expect(last).toContain('height.tone');
        expect(last).toContain('height.target');
    });

    it('walls-hall: no hazard in sight and still something sounds (control: the v0.12 layers fall silent there)', () => {
        const lesson = getLesson('walls-hall');
        const host = new RecordingHost(lesson);
        host.begin();
        host.until(() => host.runner.phase === 'flying', 120);
        host.hold(3); // hovering in the middle of the hall: no wall within 0.8 m, none closing
        const frames = framesAfterStart(host);
        expect(frames.every((ids) => ids.length > 0)).toBe(true);
        expect(frames.every((ids) => !ids.some((x) => x.startsWith('safety.')))).toBe(true);
        // the control: the same frames with the lesson's v0.12 layers (safety and voice only)
        const old: LessonDef = { ...lesson, layers: { ...lesson.layers, on: ['safety', 'voice'] } };
        const replanned = new CuePlanner({ theme: host.theme, layers: old.layers });
        const world = host.world;
        const startT = (host.events.find((e) => e.kind === 'lesson' && e.what === 'attempt-start') as { t: number }).t;
        const silent = host.frames
            .filter((f) => f.t >= startT)
            .map((f) => replanned.plan({ sample: { t: f.t, tick: f.tick, pos: f.p, vel: f.v, quat: f.q, rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: f.s, armed: true, touched: false, paused: false }, world, target: null, floorY: 0 }).cues.length === 0);
        expect(silent.length).toBeGreaterThanOrEqual(80);
        expect(silent.filter(Boolean).length).toBe(silent.length);
    });
});
