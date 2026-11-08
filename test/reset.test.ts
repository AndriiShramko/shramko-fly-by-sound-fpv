// A new lesson or a seek: reset() forgets what was sounding (lane s13-int; the simulator's need at a new lesson, its lane
// v13-host "Needs from the package" 2). A host starts its frame clock again at every lesson it opens; the scene sampler
// keeps an active sector holdMs (300 ms) on when the clock goes back (src/sense/sampler.ts, meant for a seek), so the
// first 0.3 s of the next lesson voiced the last one's sectors with the new geometry, and a one-off note of the last lesson
// stayed listed until the new clock reached its end. The engine's reset() (src/audio/engine.ts, a browser module: its own
// check is the audio proof 'engine-reset' in test-audio/page/proofs.ts) resets this planner and forgets the last frame;
// here the planner's part, with the control: the same frames without the reset.
import { describe, expect, it } from 'vitest';
import type { FlightSample, SonicEngine, SonicFrameInput, Vec3 } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { getLesson } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { DEFAULT_SAMPLER_CONFIG } from '../src/sense';
import { getBuiltinTheme } from '../src/theme';
import { createAnalyticWorld } from '../src/world';

const lesson = getLesson('walls-hall');
const spec = lesson.world.kind === 'analytic' ? lesson.world.spec : null;
if (spec === null) throw new Error('walls-hall has no analytic world');
const room = createAnalyticWorld(spec);
const FRONT: Vec3 = [0, 0, -1];

function sample(t: number, pos: Vec3, vel: Vec3): FlightSample {
    return { t, tick: t, pos, vel, quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}
const frame = (t: number, pos: Vec3, vel: Vec3 = [0, 0, 0]): SonicFrameInput => ({ sample: sample(t, pos, vel), world: room, target: null, floorY: room.floorY });
const planner = (): CuePlanner => new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: lesson.layers });
const hazardIds = (ids: readonly string[]): string[] => ids.filter((id) => /^safety\.(wall|floor|ceiling|object)/.test(id));

// the room's middle, half way between floor and ceiling, and the front wall straight ahead of it (heading -z at yaw 0)
const b = room.bounds;
const mid: Vec3 = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
const down = room.castRay([mid[0], room.floorY + 1, mid[2]], [0, -1, 0], 50);
const up = room.castRay([mid[0], room.floorY + 1, mid[2]], [0, 1, 0], 50);
if (down === null || up === null) throw new Error('the room has no floor or ceiling over its middle');
const centre: Vec3 = [mid[0], (down.point[1] + up.point[1]) / 2, mid[2]];
const ahead = room.castRay(centre, FRONT, 50);
if (ahead === null) throw new Error('the room has no front wall');
/** 0.5 m before the front wall, flying at it at 1.5 m/s: a third of a second to contact */
const nearWall: Vec3 = [centre[0], centre[1], ahead.point[2] + 0.5];
const LATE_MS = 60_000;

/** The last lesson's end: the craft flies at the front wall until LATE_MS, a gate chime at the last frame. */
function lastLessonEnds(p: CuePlanner): readonly string[] {
    let ids: readonly string[] = [];
    for (let k = 30; k >= 0; k--) ids = p.plan(frame(LATE_MS - k * 16, [nearWall[0], nearWall[1], nearWall[2] + k * 0.024], [0, 0, -1.5])).cues.map((c) => c.id);
    p.cue({ kind: 'gate', index: 0, of: 3 }, LATE_MS);
    return ids;
}

describe('reset(): the next frame is planned from nothing (a new lesson, a seek)', () => {
    it('the scene: at rest in the room\'s middle every surface is 1.5 m or more away (walls-hall is 3.2 m high), under the sampler\'s release: a new planner voices no hazard there', () => {
        const nearest = Math.min(...([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]] as Vec3[]).map((d) => room.castRay(centre, d, 50)?.distance ?? Infinity));
        expect(nearest).toBeGreaterThanOrEqual(1.5);
        expect(DEFAULT_SAMPLER_CONFIG.enterDistM.up / nearest).toBeLessThan(DEFAULT_SAMPLER_CONFIG.releaseRatio);
        const fresh = planner();
        for (const t of [0, 100, DEFAULT_SAMPLER_CONFIG.holdMs - 20, DEFAULT_SAMPLER_CONFIG.holdMs + 20]) expect(hazardIds(fresh.plan(frame(t, centre)).cues.map((c) => c.id)), `${t} ms`).toEqual([]);
    });

    it('a hazard voiced at a late frame, then a frame whose clock went back to 0 far from every wall: with reset() nothing of the last lesson is voiced or listed, as with a new planner', () => {
        const p = planner();
        const before = lastLessonEnds(p);
        expect(hazardIds(before)).toContain('safety.wall:front');
        p.reset();
        const after = p.plan(frame(0, centre));
        expect(hazardIds(after.cues.map((c) => c.id))).toEqual([]);
        expect(after.cues.map((c) => c.id)).not.toContain('target.note');
        expect(after.voices.filter((v) => v.layer === 'safety')).toEqual([]);
        // and it plans on as a new planner does, frame by frame (a slow drift to the left wall and back)
        const fresh = planner();
        for (let k = 0; k <= 120; k++) {
            const input = frame(k * 16, [centre[0] - 0.03 * Math.min(k, 120 - k), centre[1], centre[2]], [k < 60 ? -1.9 : 1.9, 0, 0]);
            expect(p.plan(input).cues, `frame ${k}`).toEqual(fresh.plan(input).cues);
        }
    });

    it('control: the same frames without reset() voice the last lesson\'s sectors for holdMs (the sampler\'s hold) and list its gate chime on', () => {
        const p = planner();
        lastLessonEnds(p);
        // the sectors active at the wall are held (the ceiling's and the floor's too: their side rays met the wall, and the
        // two voices went to the front and the front left), and voiced with the room's ceiling and floor 1.6 m away
        const after = p.plan(frame(0, centre));
        expect(hazardIds(after.cues.map((c) => c.id)).length).toBeGreaterThan(0);
        expect(after.cues.map((c) => c.id)).toContain('target.note');
        expect(hazardIds(p.plan(frame(DEFAULT_SAMPLER_CONFIG.holdMs - 20, centre)).cues.map((c) => c.id)).length).toBeGreaterThan(0);
        // the hold ends holdMs after the clock went back; the note stays until the new clock reaches its old end
        const held = p.plan(frame(DEFAULT_SAMPLER_CONFIG.holdMs + 20, centre));
        expect(hazardIds(held.cues.map((c) => c.id))).toEqual([]);
        expect(held.cues.map((c) => c.id)).toContain('target.note');
    });

    it('a cue before the next frame is stamped at 0 after reset(), as a new planner stamps it; without reset() at the last lesson\'s time', () => {
        const preview = { kind: 'preview', cue: 'safety.wall', dir: [-1, 0, 0] } as const;
        const p = planner();
        lastLessonEnds(p);
        p.reset();
        p.cue(preview);
        const fresh = planner();
        fresh.cue(preview);
        expect(p.plan(frame(0, centre)).cues).toEqual(fresh.plan(frame(0, centre)).cues);
        expect(p.previewsAt(0)).toBe(1);
        // control: not reset, the preview is stamped at the last lesson's time and the new clock passes it by
        const q = planner();
        lastLessonEnds(q);
        q.cue(preview);
        expect(q.previewsAt(0)).toBe(0);
    });

    it('the contract: reset is optional on SonicEngine, so an engine made before it still type-checks', () => {
        const older: Pick<SonicEngine, 'reset'> = {};
        expect(older.reset?.()).toBeUndefined();
    });
});
