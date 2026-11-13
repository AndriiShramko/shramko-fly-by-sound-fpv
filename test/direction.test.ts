// M41-15: which way is forward. "I flew, turned round and started flying, and it turned out I was flying
// the wrong way." A lesson with a track (the world's checkpoint list, the lesson's checkpoints, a course's
// gates) tells a pilot who flies against it for more than a second: the cue event 'wrong-way' and "You are
// flying back. Turn around.", at most once every 5 s; a gate crossed from its back side is told and not counted.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CueEvent, LessonDef, Pose, SonicObject, SonicWorld, TrackFile, Vec3 } from '../src/contract';
import { getLesson, LINE_UP_M, lessonTrack, lineUpM, toLocal, worldCheckpoints, WRONG_WAY_EVERY_S, type RunnerAction, type RunnerTestHooks } from '../src/lesson';
import { parseTrack, scanToFlown, trackToObjects } from '../src/track';
import { quatRotate, yawQuat } from '../src/util/vec';
import { createAnalyticWorld } from '../src/world';
import { ScriptedPilot } from './helpers/pilot';
import { playImperfect } from './helpers/imperfect';
import { flyTruth, truthAnswerer } from './helpers/truth';

type Say = Extract<RunnerAction, { kind: 'say' }>;
const lines = (p: ScriptedPilot, key: string): number => p.actions.filter((a): a is Say => a.kind === 'say' && a.line.key === key).length;
const cueOf = (p: ScriptedPilot, kind: CueEvent['kind']): CueEvent[] => p.actions.flatMap((a) => (a.kind === 'cue' && a.event.kind === kind ? [a.event] : []));

/** A landmark of a lesson's world (lane s13-worlds: the corridor's start, section-* and end; a room's walls): flights are laid out from it. */
function landmark(lessonId: string, id: string): Vec3 {
    const w = getLesson(lessonId).world;
    if (w.kind !== 'analytic') throw new Error(`${lessonId} has no analytic world`);
    const m = createAnalyticWorld(w.spec).landmarks.find((l) => l.id === id);
    if (m === undefined) throw new Error(`${lessonId} has no landmark ${id}`);
    return m.pos;
}
/** `metres` back along +Z from a point (the corridor's first straight runs along -Z) */
const back = (p: Vec3, metres: number): Vec3 => [p[0], p[1], p[2] + metres];

/** the corridor, flying: a pilot at its start */
function inCorridor(world?: SonicWorld): ScriptedPilot {
    const p = new ScriptedPilot(getLesson('corridor'), {}, world);
    p.begin();
    p.until(() => p.run.phase === 'flying', 60);
    return p;
}

describe('flying the wrong way along a corridor', () => {
    it('is told after a second of flying back, at most once every 5 s; flying forward never', () => {
        const p = inCorridor();
        // the corridor's first straight to its end (15 m), where the obstacle section begins
        const straightEnd = landmark('corridor', 'section-obstacle');
        p.flyTo(straightEnd);
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        // turned round, flying back at 2 m/s for 7 s
        p.turnTo(180);
        const t0 = p.t;
        p.flyTo(back(straightEnd, 14), 2, false);
        expect(lines(p, 'fly.wrong-way')).toBe(2);
        const told = p.actions.filter((a) => a.kind === 'cue' && a.event.kind === 'wrong-way');
        expect(told).toHaveLength(2);
        // the cue says where the track goes: behind a pilot who faces back
        const dir = (cueOf(p, 'wrong-way')[0] as Extract<CueEvent, { kind: 'wrong-way' }>).dir as Vec3;
        expect(dir[2]).toBeGreaterThan(0.9);
        expect((p.t - t0) / 1000).toBeGreaterThan(WRONG_WAY_EVERY_S + 1);
    }, 60000);

    it('is not told for a slow drift back or a short move back (controls)', () => {
        const p = inCorridor();
        const placed = p.placed;
        const straightEnd = landmark('corridor', 'section-obstacle');
        p.flyTo(straightEnd);
        p.flyTo(back(straightEnd, 1.5), 0.3, false); // 5 s at 0.3 m/s
        p.flyTo(back(straightEnd, 2.7), 2, false); // 0.6 s at 2 m/s
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        expect(p.placed, 'no touch moved the craft').toBe(placed);
        // and a room has no track: back and forth there is never the wrong way (from 0.5 m before its front wall to
        // 0.5 m before its back wall)
        const hall = new ScriptedPilot(getLesson('walls-hall'));
        hall.begin();
        hall.until(() => hall.run.phase === 'flying', 60);
        hall.flyTo([0, 1.5, landmark('walls-hall', 'wall-front')[2] + 0.5], 3, false);
        hall.flyTo([0, 1.5, landmark('walls-hall', 'wall-back')[2] - 0.5], 3, false);
        expect(lines(hall, 'fly.wrong-way')).toBe(0);
    }, 60000);

    // train 2, the owner: "If I back the drone up, that does not mean I fly the wrong way. Wrong way is only when I
    // fly FORWARD and it turns out to be the wrong direction."
    it.each([1, 2, 3])('is never told for backing up along the track, nose forward, at %d m/s (owner, train 2)', (v) => {
        const p = inCorridor();
        const straightEnd = landmark('corridor', 'section-obstacle');
        p.flyTo(straightEnd);
        const yaw = p.yaw;
        const t0 = p.t;
        p.flyTo(back(straightEnd, 12), v, false); // 12 m back, 4 to 12 s, the nose still forward
        expect(p.yaw).toBe(yaw);
        expect((p.t - t0) / 1000).toBeGreaterThan(3.5);
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        expect(cueOf(p, 'wrong-way')).toHaveLength(0);
        // sliding sideways (the nose across the track) is not flying back either
        p.flyTo(straightEnd);
        p.turnTo(yaw + 90);
        p.flyTo(back(straightEnd, 12), v, false);
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        // control: the same way back nose-first is told
        p.flyTo(straightEnd);
        p.turnTo(yaw + 180);
        p.flyTo(back(straightEnd, 12), v, false);
        expect(lines(p, 'fly.wrong-way')).toBeGreaterThan(0);
    }, 60000);

    it('takes the way from the world\'s own checkpoint list when the world has one (lane s13-worlds adds it)', () => {
        const lesson = getLesson('corridor');
        if (lesson.world.kind !== 'analytic') throw new Error('the corridor has a world');
        const built = createAnalyticWorld(lesson.world.spec);
        // the corridor's own world has its list (lane s13-worlds), and it rules
        expect(worldCheckpoints(built)?.length).toBeGreaterThan(lesson.checkpoints.length);
        expect(lessonTrack(lesson, built, built.objects(), lesson.start)?.source).toBe('world');
        // a list that says the first straight runs the other way: flying forward is now flying back
        const straightEnd = landmark('corridor', 'section-obstacle');
        const reversed = Object.assign(Object.create(built) as SonicWorld, { checkpoints: [15, 12.5, 10, 7.5, 5, 2.5, 0].map((m) => ({ pos: back(straightEnd, m), dir: [0, 0, 1] as Vec3 })) });
        expect(worldCheckpoints(reversed)).toHaveLength(7);
        expect(lessonTrack(lesson, reversed, built.objects(), lesson.start)?.source).toBe('world');
        const p = inCorridor(reversed);
        p.flyTo(straightEnd, 3);
        expect(lines(p, 'fly.wrong-way')).toBeGreaterThan(0);
        // control: the same flight with the world's own list is forward
        const q = inCorridor();
        q.flyTo(straightEnd, 3);
        expect(lines(q, 'fly.wrong-way')).toBe(0);
        // a list that is not one is ignored, and the lesson's checkpoints rule
        const broken = Object.assign(Object.create(built) as SonicWorld, { checkpoints: [{ pos: [0, 0] }] });
        expect(worldCheckpoints(broken)).toBeNull();
        expect(lessonTrack(lesson, broken, built.objects(), lesson.start)?.source).toBe('checkpoints');
    }, 60000);
});

/** A point in a gate's own frame (x to its side, z out of its front), in the world. */
const atGate = (g: Pick<SonicObject, 'pos' | 'quat'>, l: Vec3): Vec3 => {
    const r = quatRotate(g.quat, l);
    return [g.pos[0] + r[0], g.pos[1] + r[1], g.pos[2] + r[2]];
};

describe('flying back to a gate that was missed (review R1)', () => {
    // a pilot passes ring 2 beside it (further than a near miss: its frame and 2.5 m, inside the room), so the attempt
    // goes on and ring 2 stays the target, flies 3 m past it (short of ring 3), hears its hum behind him, turns round and
    // flies back at 3 m/s to its front (7 to 8 m, over 2 s), then through it
    it.each(['rings-line', 'rings-small', 'rings-course'])('%s: is never told the wrong way, and ring 2 counts from the front', (id) => {
        const p = new ScriptedPilot(getLesson(id));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1, r2] = p.objects().filter((o) => o.order !== null) as [SonicObject, SonicObject];
        const beside = (r2.shape as { diameter: number }).diameter / 2 + 2 * (r2.shape as { tube: number }).tube + 2.5;
        // the side of ring 2 with more room, and its front short of ring 1 (the rings are 5 to 7 m apart)
        const room = (sign: number): number => (p.analytic as NonNullable<typeof p.analytic>).sdf(...atGate(r2, [sign * beside, 0, 0]));
        const side = room(1) >= room(-1) ? 1 : -1;
        const front = Math.min(5, toLocal(r2, r1.pos)[2] - 1.5);
        p.flyTo(atGate(r1, [0, 0, 3]));
        p.flyTo(atGate(r1, [0, 0, -2])); // ring 1, forward
        p.flyTo(atGate(r2, [side * beside, 0, 3]));
        p.flyTo(atGate(r2, [side * beside, 0, -3])); // beside ring 2, past it
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id]);
        expect(p.run.phase).toBe('flying');
        p.flyTo(atGate(r2, [0, 0, front]), 3); // back to its front
        p.face(r2.pos);
        p.flyTo(atGate(r2, [0, 0, -2])); // and through it
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id, r2.id]);
        expect(lines(p, 'fly.wrong-way')).toBe(0);
        expect(cueOf(p, 'wrong-way')).toHaveLength(0);
        expect(lines(p, 'fly.wrong-side')).toBe(0);
    }, 60000);

    it('control: the same way back along the corridor is told', () => {
        const p = inCorridor();
        const straightEnd = landmark('corridor', 'section-obstacle');
        p.flyTo(straightEnd);
        p.turnTo(180);
        p.flyTo(back(straightEnd, 11), 3, false);
        expect(lines(p, 'fly.wrong-way')).toBe(1);
    }, 60000);

    it('control: in a course, flying back from the gate that counts next toward the start is still told', () => {
        const p = new ScriptedPilot(getLesson('rings-line'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1] = p.objects().filter((o) => o.order !== null) as [SonicObject];
        p.flyTo(atGate(r1, [0, 0, 4]));
        p.flyTo(atGate(r1, [0, 0, -2])); // ring 1, forward; ring 2 counts next, 4 m ahead
        p.turnTo(180);
        // back to 0.6 m before the room's back wall (7 m in front of ring 1), away from ring 2: further than LINE_UP_M
        // from it for the last 4.4 m, about 1.5 s at 3 m/s
        const wall = (p.world as SonicWorld).castRay(r1.pos, [0, 0, 1], 50)!.distance;
        p.flyTo(atGate(r1, [0, 0, wall - 0.6]), 3, false);
        expect(lines(p, 'fly.wrong-way')).toBe(1);
        // the cue says where ring 2 is: behind a pilot who faces back
        const dir = (cueOf(p, 'wrong-way')[0] as Extract<CueEvent, { kind: 'wrong-way' }>).dir as Vec3;
        expect(dir[2]).toBeGreaterThan(0.9);
    }, 60000);
});

describe('a gate crossed from its back side', () => {
    it('is told and not counted; crossed from the front it counts', () => {
        const p = new ScriptedPilot(getLesson('rings-line'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1, r2] = p.objects().filter((o) => o.order !== null) as [SonicObject, SonicObject];
        // beside ring 2: further than a near miss (its frame and 2 m) and inside the room (its walls 5 m from the line)
        const beside = (r2.shape as { diameter: number }).diameter / 2 + 2 * (r2.shape as { tube: number }).tube + 2.5;
        p.flyTo(atGate(r1, [0, 0, 3]));
        p.flyTo(atGate(r1, [0, 0, -2])); // ring 1, forward
        p.flyTo(atGate(r2, [beside, 0, 3]));
        p.flyTo(atGate(r2, [beside, 0, -3])); // beside ring 2, past it
        p.flyTo(atGate(r2, [0, 0, -2]));
        expect(lines(p, 'fly.wrong-side')).toBe(0);
        p.flyTo(atGate(r2, [0, 0, 2]), 3, false); // back through ring 2, from its back side
        expect(lines(p, 'fly.wrong-side')).toBe(1);
        expect(cueOf(p, 'wrong-side')).toHaveLength(1);
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id]);
        p.turnTo(0);
        p.flyTo(atGate(r2, [0, 0, -2])); // and through it from the front
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id, r2.id]);
        expect(lines(p, 'fly.wrong-side')).toBe(1);
    }, 60000);

    // the truth bot flies 4 m before and 4 m past each gate, so with gates 5 to 7 m apart it flies back 1 to 3 m between
    // two of them, within LINE_UP_M of the gate that counts next: a correct flight (s13-worlds' note to the merge); and
    // every attempt after the first begins with a place at the start, from past a gate (merge item 8g of s13-merge: the
    // runner took that jump for a crossing from the back side and told "wrong side" at the start of attempts 2 and 3)
    it.each(['rings-first', 'rings-line', 'rings-small', 'rings-heights', 'rings-course', 'shapes-square', 'shapes-series', 'shapes-cube'])('%s flown by the truth bot to its pass: never told the wrong way or the wrong side', (id) => {
        const p = new ScriptedPilot(getLesson(id));
        p.answerer = truthAnswerer(p);
        p.begin();
        const phase = (): string => p.run.phase;
        for (let k = 0; k < 6 && phase() !== 'passed'; k++) {
            p.until(() => phase() === 'flying' || phase() === 'passed', 600);
            if (phase() !== 'passed') flyTruth(p);
        }
        expect(phase()).toBe('passed');
        expect(p.of('touch')).toEqual([]);
        expect(cueOf(p, 'wrong-way')).toEqual([]);
        expect(cueOf(p, 'wrong-side')).toEqual([]);
        expect(lines(p, 'fly.wrong-way') + lines(p, 'fly.wrong-side')).toBe(0);
    }, 60000);

    it('control: a course flown forward is never told either thing', () => {
        const p = new ScriptedPilot(getLesson('rings-course'));
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        for (const g of p.objects().filter((o) => o.order !== null)) {
            const f = [2 * (g.quat[0] * g.quat[2]), 0, 1 - 2 * g.quat[2] * g.quat[2]] as Vec3; // the gate's +Z axis
            p.flyTo([g.pos[0] + f[0] * 4, g.pos[1], g.pos[2] + f[2] * 4]);
            p.flyTo([g.pos[0] - f[0] * 4, g.pos[1], g.pos[2] - f[2] * 4]);
        }
        expect(p.run.phase).toBe('passed');
        expect(lines(p, 'fly.wrong-way') + lines(p, 'fly.wrong-side')).toBe(0);
    }, 60000);
});

// Lane s13-elev (M41-15, the v0.13 merge review's open item 4): "wrong way" between gates. v0.13 judged flying back
// only further than LINE_UP_M (8 m, set for rings 14 m apart) in front of the gate that counts next, so in the 5 to
// 7 m legs of the v0.13 rooms a pilot who turned back toward the gate he had just passed was never told. The line-up
// distance now follows the leg (lineUpM) and flying back is flying against the leg; the 8 m rule is the control.
describe('turning back between two gates (lane s13-elev)', () => {
    const COURSES = ['rings-line', 'rings-small', 'rings-heights', 'rings-course', 'shapes-series'] as const;

    /**
     * Passes gate 1 forward, flies on to `turnAt` (1 m past gate 1, or the middle of the leg to gate 2), turns round and
     * flies back toward gate 1 at 2 m/s, through it to 2.5 m in front of it at its height (the climb cap would take the
     * craft over a ring's opening on the straight line back from a lower gate): how far it flew back when "wrong way"
     * was first told (Infinity: never), the leg, and the told cue.
     */
    function turnBack(id: (typeof COURSES)[number], turnAt: 'past-1m' | 'middle', hooks?: { lineUp: 'fixed' }): { metres: number; leg: number; dir: Vec3 | null } {
        const p = new ScriptedPilot(getLesson(id), hooks === undefined ? {} : { testHooks: hooks });
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1, r2] = p.objects().filter((o) => o.order !== null).sort((a, b) => (a.order as number) - (b.order as number)) as [SonicObject, SonicObject];
        const leg = Math.hypot(r2.pos[0] - r1.pos[0], r2.pos[1] - r1.pos[1], r2.pos[2] - r1.pos[2]);
        p.flyTo(atGate(r1, [0, 0, 3]));
        p.flyTo(atGate(r1, [0, 0, -1])); // gate 1, forward
        expect(p.of('gate').map((g) => g.gateId)).toEqual([r1.id]);
        const turn: Vec3 = turnAt === 'past-1m' ? p.pos : [(r1.pos[0] + r2.pos[0]) / 2, (r1.pos[1] + r2.pos[1]) / 2, (r1.pos[2] + r2.pos[2]) / 2];
        p.flyTo(turn);
        p.turnTo(p.yaw + 180);
        const flat = Math.hypot(r1.pos[0] - r2.pos[0], r1.pos[2] - r2.pos[2]);
        const u: Vec3 = [(r1.pos[0] - r2.pos[0]) / flat, 0, (r1.pos[2] - r2.pos[2]) / flat];
        let metres = Infinity;
        let dir: Vec3 | null = null;
        const tick = p.tick.bind(p);
        p.tick = () => {
            tick();
            const told = cueOf(p, 'wrong-way');
            if (metres === Infinity && told.length > 0) {
                metres = Math.hypot(p.pos[0] - turn[0], p.pos[1] - turn[1], p.pos[2] - turn[2]);
                dir = (told[0] as Extract<CueEvent, { kind: 'wrong-way' }>).dir ?? null;
            }
        };
        p.flyTo([r1.pos[0] + u[0] * 2.5, r1.pos[1], r1.pos[2] + u[2] * 2.5], 2, false);
        expect(p.of('touch'), 'a clean flight').toEqual([]);
        return { metres, leg, dir };
    }

    it.each(COURSES)('%s: turned back 1 m past a gate or halfway to the next, told within 3 m of flying back (2 m/s), the cue from where the next gate is', (id) => {
        for (const at of ['past-1m', 'middle'] as const) {
            const r = turnBack(id, at);
            expect(r.leg, id).toBeLessThan(LINE_UP_M); // every leg of these rooms lies inside v0.13's 8 m
            expect(r.metres, `${id} turned ${at}`).toBeLessThanOrEqual(3);
            // a pilot who faces back hears it from behind: the way to the gate that counts next
            expect((r.dir as Vec3 | null)?.[2] ?? 0, `${id} turned ${at}`).toBeGreaterThan(0.5);
        }
    }, 60000);

    it.each(COURSES)('control: %s with the 8 m rule of v0.13 is never told on the way back to gate 1', (id) => {
        for (const at of ['past-1m', 'middle'] as const) expect(turnBack(id, at, { lineUp: 'fixed' }).metres, `${id} turned ${at}`).toBe(Infinity);
    }, 60000);

    it('the line-up distance follows the leg: 8 m for 14 m and longer, in proportion below', () => {
        expect(lineUpM(14)).toBe(LINE_UP_M);
        expect(lineUpM(30)).toBe(LINE_UP_M);
        expect(lineUpM(7)).toBeCloseTo(4, 9);
        expect(lineUpM(5)).toBeCloseTo(40 / 14, 9);
        expect(lineUpM(0)).toBe(LINE_UP_M);
    });

    // the truth bot is the test above ('flown by the truth bot to its pass'); the imperfect pilot flies the same line at
    // 65 % of the cap, wobbling sideways by half its clearance in each gate and stopping 1.2 s every 3 m
    it.each(['rings-first', 'rings-line', 'rings-small', 'rings-heights', 'rings-course', 'shapes-square', 'shapes-series', 'shapes-cube'])('%s flown by the imperfect pilot: never told the wrong way or the wrong side', (id) => {
        const p = new ScriptedPilot(getLesson(id));
        playImperfect(p);
        expect(p.of('gate').length, `${id}: it flew the course`).toBeGreaterThan(0);
        expect(cueOf(p, 'wrong-way')).toEqual([]);
        expect(cueOf(p, 'wrong-side')).toEqual([]);
        expect(lines(p, 'fly.wrong-way') + lines(p, 'fly.wrong-side')).toBe(0);
    }, 120000);
});

// Review E1, E3 and E8 of lane s13-elev (docs/dev/review-v0.13-elev.md). The leg's rule above holds on a leg only once
// the craft has flown along it (faster than WRONG_WAY_MPS, since the gate before was passed or the attempt began);
// before that v0.13's rule holds (further than LINE_UP_M in front of the gate, flying away from it). So the momentum
// carried out of a course that turns back after a gate, and a pilot who backs away at the start, are told only where
// v0.13 told them; the leg begins at the gate passed last (a later lap's first gate: the course's last); a course in any
// order keeps v0.13's rule. The control of E1 and E3 is the lane's first rule (testHooks.lineUp 'no-progress').

/**
 * The simulator's Winter Garden ring track, the course free-garden flies, the last lesson of both paths (ShramkoGSFPV
 * apps/fly/public/sonic/tracks/7a475d38-rings-v1.json at a8e98a9): eight rings through the scene transform [5, 0, 0, 0],
 * four along +Z and four back along -Z. From ring 4 to ring 5 the course turns back 135 degrees, which the simulator's
 * track check allows ("after a gate the course may turn back").
 */
const GARDEN: TrackFile = (() => {
    const r = parseTrack(readFileSync(new URL('./fixtures/track-7a475d38-rings-v1.json', import.meta.url), 'utf8'));
    if (!r.ok) throw new Error(`the Winter Garden track does not parse: ${JSON.stringify(r.issues)}`);
    return r.value;
})();

/** A lesson over a course of gates given as the simulator gives a scan's track: the gates and the start through the transform. */
function onCourse(lesson: LessonDef, objects: readonly SonicObject[], start: Pose, hooks?: RunnerTestHooks): ScriptedPilot {
    const p = new ScriptedPilot(lesson, { objects, start, ...(hooks === undefined ? {} : { testHooks: hooks }) }, null);
    p.begin();
    p.until(() => p.run.phase === 'flying', 60);
    return p;
}

/** free-garden over the Winter Garden, as the simulator runs it */
const inGarden = (hooks?: RunnerTestHooks): ScriptedPilot => {
    const start = GARDEN.start as Pose;
    return onCourse(getLesson('free-garden'), trackToObjects(GARDEN), { pos: scanToFlown(GARDEN.transform, start.pos), yawDeg: start.yawDeg }, hooks);
};

const gatesOf = (p: ScriptedPilot): SonicObject[] => p.objects().filter((o) => o.order !== null).sort((a, b) => (a.order as number) - (b.order as number));

/** For every "wrong way" told, the gate passed last before it ('start' before the first). */
function toldAfter(p: ScriptedPilot): string[] {
    let last = 'start';
    const out: string[] = [];
    for (const x of p.log) {
        if ('event' in x && x.event.kind === 'gate') last = x.event.gateId;
        if ('action' in x && x.action.kind === 'say' && x.action.line.key === 'fly.wrong-way') out.push(last);
    }
    return out;
}

/** The review's pilot: from 3 m in front of each gate straight through it to `past` m beyond it at `v` m/s, then on to the next. */
function flyCourse(p: ScriptedPilot, v: number, past: number): void {
    for (const g of gatesOf(p)) {
        p.flyTo(atGate(g, [0, 0, 3]), v);
        p.flyTo(atGate(g, [0, 0, -past]), v);
    }
}

const flatDeg = (a: Vec3, b: Vec3): number => (Math.acos((a[0] * b[0] + a[2] * b[2]) / (Math.hypot(a[0], a[2]) * Math.hypot(b[0], b[2]))) * 180) / Math.PI;
const between = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

describe('a course that turns back after a gate: free-garden on the Winter Garden (review E1 of lane s13-elev)', () => {
    it("the track as the simulator hands it over: eight rings, the course turning back 135 degrees after ring 4, ring 4 further from ring 5 than the leg's line-up distance", () => {
        const g = trackToObjects(GARDEN);
        expect(g).toHaveLength(8);
        const [r4, r5] = [g[3] as SonicObject, g[4] as SonicObject];
        const leg = between(r4.pos, r5.pos);
        expect(flatDeg(quatRotate(r4.quat, [0, 0, -1]), [r5.pos[0] - r4.pos[0], 0, r5.pos[2] - r4.pos[2]])).toBeGreaterThan(130);
        expect(toLocal(r5, r4.pos)[2]).toBeGreaterThan(0); // at ring 4 the craft is in front of ring 5
        expect(leg).toBeGreaterThan(lineUpM(leg));
        expect(leg).toBeLessThan(LINE_UP_M);
    });

    it('flown through every ring and on 1.5 to 4 m past it at 1 to 3 m/s: told only where v0.13 told it too, never at 1.5 m/s or faster', () => {
        for (const v of [1, 1.5, 2, 3]) {
            for (const past of [1.5, 2, 2.5, 3, 4]) {
                const p = inGarden();
                flyCourse(p, v, past);
                expect(p.of('gate').map((e) => e.gateId), `${v} m/s, ${past} m past`).toEqual(gatesOf(p).map((g) => g.id));
                const v013 = inGarden({ lineUp: 'fixed' });
                flyCourse(v013, v, past);
                expect(toldAfter(p), `${v} m/s, ${past} m past`).toEqual(toldAfter(v013));
                if (v >= 1.5) expect(toldAfter(p), `${v} m/s, ${past} m past`).toEqual([]);
            }
        }
        // where v0.13 tells it: 4 m past ring 4 at 1 m/s, four seconds flying away from ring 5, further than 8 m from it
        const slow = inGarden();
        flyCourse(slow, 1, 4);
        expect(toldAfter(slow)).toEqual(['ring-4']);
    }, 120000);

    it("control: the lane's first rule tells \"wrong way\" right after ring 4 (1.5 m past at 1 m/s, 2 m at 1.5, 2.5 m at 2, 4 m at 3)", () => {
        for (const [v, past] of [
            [1, 1.5],
            [1.5, 2],
            [2, 2.5],
            [3, 4]
        ] as const) {
            const p = inGarden({ lineUp: 'no-progress' });
            flyCourse(p, v, past);
            expect(toldAfter(p), `${v} m/s, ${past} m past`).toContain('ring-4');
        }
    }, 60000);

    it('on that leg, once the craft has flown along it, a turn back is told within 3 m, as between any two gates (v0.13: not)', () => {
        for (const hooks of [undefined, { lineUp: 'fixed' } as const]) {
            const p = inGarden(hooks);
            const [, , , r4, r5] = gatesOf(p) as [SonicObject, SonicObject, SonicObject, SonicObject, SonicObject];
            for (const g of gatesOf(p).slice(0, 4)) {
                p.flyTo(atGate(g, [0, 0, 3]), 2);
                p.flyTo(atGate(g, [0, 0, -1]), 2);
            }
            // 2 m toward ring 5's front, then round and back toward ring 4 for 3 m at 2 m/s
            const aim = atGate(r5, [0, 0, 3]);
            const d = between(p.pos, aim);
            const at: Vec3 = [p.pos[0] + ((aim[0] - p.pos[0]) * 2) / d, p.pos[1] + ((aim[1] - p.pos[1]) * 2) / d, p.pos[2] + ((aim[2] - p.pos[2]) * 2) / d];
            p.flyTo(at, 2);
            p.turnTo(p.yaw + 180);
            const back: Vec3 = [at[0] - ((aim[0] - at[0]) * 3) / between(at, aim), at[1], at[2] - ((aim[2] - at[2]) * 3) / between(at, aim)];
            p.flyTo(back, 2, false);
            expect(between(back, r5.pos)).toBeLessThan(LINE_UP_M);
            expect(toldAfter(p), hooks === undefined ? 'shipped' : 'v0.13').toEqual(hooks === undefined ? [r4.id] : []);
        }
    }, 60000);
});

describe('the start of an attempt (review E3 of lane s13-elev)', () => {
    const GATE_LESSONS = ['rings-first', 'rings-line', 'rings-small', 'rings-heights', 'rings-course', 'shapes-square', 'shapes-series', 'shapes-cube'] as const;

    const atStart = (id: string, hooks?: RunnerTestHooks): ScriptedPilot => {
        const p = new ScriptedPilot(getLesson(id), hooks === undefined ? {} : { testHooks: hooks });
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        return p;
    };
    /**
     * moves straight away from gate 1 as far as the room lets him: 1.2 m at 1 m/s (every start of these rooms is 5 to 6 m
     * in front of gate 1 and 1.5 m from the wall behind it; the leg's line-up distance is 2.9 to 3.4 m); 'backing' still
     * faces gate 1, 'turned' turns round first and flies nose-first (train 2: only that can be the wrong way)
     */
    const backAway = (p: ScriptedPilot, nose: 'backing' | 'turned'): void => {
        const g = gatesOf(p)[0] as SonicObject;
        if (nose === 'turned') p.turnTo(p.yaw + 180);
        const d = Math.hypot(p.pos[0] - g.pos[0], p.pos[2] - g.pos[2]);
        expect((p.world as SonicWorld).castRay(p.pos, [(p.pos[0] - g.pos[0]) / d, 0, (p.pos[2] - g.pos[2]) / d], 50)?.distance).toBeCloseTo(1.5, 6);
        p.flyTo([p.pos[0] + ((p.pos[0] - g.pos[0]) * 1.2) / d, p.pos[1], p.pos[2] + ((p.pos[2] - g.pos[2]) * 1.2) / d], 1, false);
    };

    it.each(GATE_LESSONS)('%s: holding still 3 s, or backing away from gate 1 at 1 m/s to the wall behind (1.2 s), is never told (as in v0.13)', (id) => {
        const still = atStart(id);
        still.hold(3);
        expect(lines(still, 'fly.wrong-way')).toBe(0);
        for (const nose of ['backing', 'turned'] as const) {
            const backing = atStart(id);
            backAway(backing, nose);
            expect(backing.of('touch'), 'a clean flight').toEqual([]);
            expect(lines(backing, 'fly.wrong-way'), nose).toBe(0);
        }
    }, 60000);

    it.each(GATE_LESSONS)("control: %s with the lane's first rule tells the pilot who backs away", (id) => {
        const backing = atStart(id, { lineUp: 'no-progress' });
        backAway(backing, 'turned');
        expect(lines(backing, 'fly.wrong-way')).toBe(1);
    }, 60000);

    it('a pilot who turns round at the start and flies away from gate 1 is told once further than 8 m from it, as in v0.13 (free-garden)', () => {
        for (const hooks of [undefined, { lineUp: 'fixed' } as const]) {
            const p = inGarden(hooks);
            const g = gatesOf(p)[0] as SonicObject;
            expect(between(p.pos, g.pos)).toBeCloseTo(8, 6); // the track's start, 8 m in front of ring 1
            p.turnTo(p.yaw + 180);
            p.flyTo([p.pos[0], p.pos[1], p.pos[2] - 6], 2, false); // 3 s away from it
            expect(toldAfter(p), hooks === undefined ? 'shipped' : 'v0.13').toEqual(['start']);
        }
    }, 60000);
});

describe('the leg flown: a later lap, a course in any order (review E8 of lane s13-elev)', () => {
    const ring = (id: string, pos: Vec3, yawDeg: number, order: number): SonicObject => ({ id, shape: { kind: 'ring', diameter: 1.5, tube: 0.05 }, pos, quat: yawQuat(yawDeg), order, solid: false, material: 'obstacle' });

    it("the first gate of the second lap is reached from the course's last gate, not from the start: a turn back there is told", () => {
        // a square loop of four rings 7.1 m apart, the start 30 m in front of ring 1 (that leg's line-up distance 8 m;
        // the leg from ring 4, 4 m): free-garden's lesson with two laps
        const loop = [ring('g1', [0, 1.5, 0], 0, 0), ring('g2', [5, 1.5, -5], 90, 1), ring('g3', [10, 1.5, 0], 180, 2), ring('g4', [5, 1.5, 5], -90, 3)];
        const ways: readonly Vec3[] = [
            [0, 0, -1],
            [1, 0, 0],
            [0, 0, 1],
            [-1, 0, 0]
        ];
        loop.forEach((g, i) => {
            const axis = quatRotate(g.quat, [0, 0, -1]);
            const way = ways[i] as Vec3;
            expect(Math.hypot(axis[0] - way[0], axis[2] - way[2]), g.id).toBeLessThan(1e-9);
        });
        const twoLaps: LessonDef = { ...getLesson('free-garden'), goals: [{ kind: 'timed-course', laps: 2 }] };
        const p = onCourse(twoLaps, loop, { pos: [0, 1.5, 30], yawDeg: 0 });
        for (const g of loop) {
            p.flyTo(atGate(g, [0, 0, 3]), 3);
            p.flyTo(atGate(g, [0, 0, -2]), 3);
        }
        expect(p.of('gate').map((e) => e.gateId)).toEqual(['g1', 'g2', 'g3', 'g4']);
        expect(toldAfter(p)).toEqual([]);
        // on toward ring 1 (along the leg from ring 4), 5 m in front of it, then back toward ring 4 for 1.75 s
        p.flyTo([0, 1.5, 5], 2);
        expect(lineUpM(between((loop[3] as SonicObject).pos, (loop[0] as SonicObject).pos))).toBeLessThan(5);
        p.face([3.5, 1.5, 5]); // turned round: flown nose-first (train 2)
        p.flyTo([3.5, 1.5, 5], 2, false);
        expect(toldAfter(p)).toEqual(['g4']);
    }, 60000);

    it("a course in any order keeps v0.13's rule: through ring 2 first, round to ring 1's front and through it, never told", () => {
        const anyOrder: LessonDef = { ...getLesson('rings-line'), goals: [{ kind: 'pass-gates', gateIds: 'all', inOrder: false }] };
        const p = new ScriptedPilot(anyOrder);
        p.begin();
        p.until(() => p.run.phase === 'flying', 60);
        const [r1, r2] = gatesOf(p) as [SonicObject, SonicObject];
        const beside = (r1.shape as { diameter: number }).diameter / 2 + 2 * (r1.shape as { tube: number }).tube + 2.5;
        const room = (sign: number): number => (p.analytic as NonNullable<typeof p.analytic>).sdf(...atGate(r1, [sign * beside, 0, 0]));
        const side = room(1) >= room(-1) ? 1 : -1;
        p.flyTo(atGate(r1, [side * beside, 0, 3]));
        p.flyTo(atGate(r1, [side * beside, 0, -1])); // beside ring 1
        p.flyTo(atGate(r2, [0, 0, 3]));
        p.flyTo(atGate(r2, [0, 0, -1])); // through ring 2
        expect(p.of('gate').map((e) => e.gateId)).toEqual([r2.id]);
        // back beside the rings to 5 m in front of ring 1, round, and through it at 1 m/s
        p.flyTo(atGate(r1, [side * beside, 0, -1]), 2);
        p.flyTo(atGate(r1, [side * beside, 0, 5]), 2);
        p.flyTo(atGate(r1, [0, 0, 5]), 2);
        p.face(r1.pos);
        p.flyTo(atGate(r1, [0, 0, -1]), 1);
        expect(p.of('gate').map((e) => e.gateId)).toEqual([r2.id, r1.id]);
        expect(p.of('touch'), 'a clean flight').toEqual([]);
        expect(lines(p, 'fly.wrong-way') + lines(p, 'fly.wrong-side')).toBe(0);
    }, 60000);
});
