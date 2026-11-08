// Rooms at the scale of a micro drone (M41-18, lane s13-worlds step 5). The owner, message 41: in the
// first room "one, two, three, oops, a wall", up "one, two, oops, the ceiling"; v0.12 took eight and
// more. Held here, with the model of the simulator's lesson pilot in test/helpers/reach.ts (an
// estimate from its ramps): from the start at full stick, every side wall and every leg (the start to
// the first gate or pillar, gate to gate, the last one to the far wall) comes in 2 to 3 s at the
// lesson's speed cap, the ceiling in about 2 s (1.5 to 2.5) at its climb cap; the first room without
// obstacles is the smallest; the zones, the corridor and hover-turn's ring follow their own caps; the
// truth bot passes every changed lesson. Controls: the v0.12 sizes (test/fixtures/v012-lesson-geometry.json,
// the lesson files as v0.12 shipped them) fail the same checks.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Goal, LessonDef, SonicObject, SpeechLine } from '../src/contract';
import { createTranslator, DICTS } from '../src/i18n';
import { APPROACH_MIN_M, getLesson, lessonPaths, nearestWallM, SHIPPED_LESSON_IDS } from '../src/lesson';
import { createAnalyticWorld, type AnalyticWorldInfo } from '../src/world';
import { ScriptedPilot } from './helpers/pilot';
import { alongTrack } from './helpers/along';
import { fullStickSeconds, scaleRow, type Reach, type ScaleRow } from './helpers/reach';
import { playLesson } from './helpers/truth';

/** Every wall and every leg at full stick, seconds. */
export const WALL_S: readonly [number, number] = [2, 3];
/** The ceiling at full climb, seconds ("about 2 s"). */
export const CEILING_S: readonly [number, number] = [1.5, 2.5];

const V012 = (JSON.parse(readFileSync(new URL('./fixtures/v012-lesson-geometry.json', import.meta.url), 'utf8')) as { lessons: Record<string, Pick<LessonDef, 'world' | 'start' | 'assists' | 'goals'>> }).lessons;

const ROOMS = ['hall', 'pillars', 'rings', 'squares', 'cube-frames'];
const HOVER_GOALS: readonly Goal['kind'][] = ['hold-height', 'turn-to'];
const worldOf = (l: Pick<LessonDef, 'world'>): AnalyticWorldInfo | null => (l.world.kind === 'analytic' ? createAnalyticWorld(l.world.spec) : null);

/** A lesson that flies through a room (not a hover lesson, whose caps are 0.5 m/s: a wall 2 to 3 s away would stand inside its ring). */
const isRoomLesson = (l: Pick<LessonDef, 'world' | 'goals'>): boolean => l.world.kind === 'analytic' && ROOMS.includes(l.world.spec.generator) && !l.goals.every((g) => HOVER_GOALS.includes(g.kind));

/** The lesson as v0.12 shipped its world, start, assists and goals (the rest as now). */
const asV012 = (id: string): LessonDef => ({ ...getLesson(id), ...(V012[id] as Pick<LessonDef, 'world' | 'start' | 'assists' | 'goals'>) });

/** What of the seconds-to-wall row is outside the rule. */
export function scaleProblems(row: ScaleRow, gates: boolean): string[] {
    const out: string[] = [];
    const check = (name: string, r: Reach | null, [lo, hi]: readonly [number, number]): void => {
        if (r === null) out.push(`${name}: no wall`);
        else if (r.seconds < lo || r.seconds > hi) out.push(`${name}: ${r.seconds} s (${r.metres} m to ${r.what})`);
    };
    // a ray straight ahead passes through a gate's opening: for a course the legs say what comes ahead
    if (!gates) check('ahead', row.ahead, WALL_S);
    check('left', row.left, WALL_S);
    check('right', row.right, WALL_S);
    check('ceiling', row.ceiling, CEILING_S);
    for (const leg of row.legs) check(leg.what, leg, WALL_S);
    return out;
}

const hasGates = (w: AnalyticWorldInfo | null): boolean => (w?.objects() ?? []).some((o) => o.order !== null && o.shape.kind !== 'zone');
const volume = (w: AnalyticWorldInfo): number => (w.cavities ?? []).reduce((a, b) => a + 8 * b.hx * b.hy * b.hz, 0);

const ROOM_LESSONS = SHIPPED_LESSON_IDS.filter((id) => isRoomLesson(getLesson(id)));
/** The lessons whose world, start or distances this lane changed. */
const CHANGED = ['hover-turn', 'move-speed', 'move-stop', 'walls-hall', 'walls-pillar', 'walls-row', 'corridor', 'rings-first', 'rings-line', 'rings-small', 'rings-course', 'shapes-square', 'shapes-series', 'shapes-cube'];

describe('rooms at the scale of a micro drone (M41-18)', () => {
    it('the room lessons are the eleven that fly through a room', () => {
        expect(ROOM_LESSONS).toEqual(['walls-hall', 'walls-pillar', 'walls-row', 'rings-first', 'rings-line', 'rings-small', 'rings-heights', 'rings-course', 'shapes-square', 'shapes-series', 'shapes-cube']);
    });

    it.each(ROOM_LESSONS)('%s: the walls and every leg 2 to 3 s away at full stick, the ceiling about 2 s', (id) => {
        const l = getLesson(id);
        const row = scaleRow(l) as ScaleRow;
        expect(scaleProblems(row, hasGates(worldOf(l))), JSON.stringify(row)).toEqual([]);
        // the start is the world's own start: the room is laid out from it
        expect(l.start.pos).toEqual(worldOf(l)!.start.pos);
    });

    it.each(ROOM_LESSONS.filter((id) => id in V012))('control: %s at its v0.12 size fails the same check', (id) => {
        const old = asV012(id);
        const row = scaleRow(old) as ScaleRow;
        expect(scaleProblems(row, hasGates(worldOf(old))).length, JSON.stringify(row)).toBeGreaterThan(0);
    });

    it('the first room without obstacles (walls-hall) is the smallest room of the ladder', () => {
        const rooms = lessonPaths().full.map(getLesson).filter((l) => l.world.kind === 'analytic' && ROOMS.includes(l.world.spec.generator));
        const first = rooms.find((l) => worldOf(l)!.objects().length === 0) as LessonDef;
        expect(first.id).toBe('walls-hall');
        const own = volume(worldOf(first)!);
        for (const l of rooms) if (l.id !== first.id) expect(own, l.id).toBeLessThan(volume(worldOf(l)!));
        expect(own).toBeLessThan(500);
        // control: in v0.12 it was as large as the pillars' room (40 x 60 x 12 each)
        expect(volume(worldOf(asV012('walls-hall'))!)).toBeGreaterThanOrEqual(volume(worldOf(asV012('walls-pillar'))!));
    });

    it('walls-hall asks for a wall to be approached and calls its room small (review M5); control: its v0.12 stop distance', () => {
        const l = getLesson('walls-hall');
        const within = (g: Goal): number => (g as Extract<Goal, { kind: 'approach-stop' }>).stopWithinM;
        // the least approach the goal takes: APPROACH_MIN_M of flight from the start straight at the nearest wall. It must
        // stop too far from the wall to count ("fly to the wall, stop before it", not "move 2 m and stop")
        const left = (nearestWallM(worldOf(l), l.start.pos) as number) - APPROACH_MIN_M;
        expect(left, `${left.toFixed(2)} m from the nearest wall after the least approach`).toBeGreaterThan(within(l.goals[0] as Goal) + 1);
        // control: v0.12's 3 m, in this room, passes the least approach
        expect(left).toBeLessThanOrEqual(within(asV012('walls-hall').goals[0] as Goal));
        const en = createTranslator('en', DICTS);
        expect(en.text(l.title)).toBe('A small room');
        expect(en.text(l.intro[0] as SpeechLine)).toMatch(/^You are in a small, empty room\./);
    });

    it('the zones of move-speed and move-stop come in 2 to 3 s at their caps; control: v0.12 took 7.7 s to move-stop\'s', () => {
        const nearFace = (l: Pick<LessonDef, 'world' | 'start' | 'assists'>): number => {
            const zone = worldOf(l)!.objects().find((o) => o.shape.kind === 'zone') as SonicObject;
            const half = (zone.shape as { size: readonly number[] }).size[2] as number / 2;
            const metres = Math.abs(zone.pos[2] - l.start.pos[2]) - half - 0.12;
            return fullStickSeconds(metres, l.assists.maxSpeedMps as number, 'horizontal');
        };
        for (const id of ['move-speed', 'move-stop']) {
            const t = nearFace(getLesson(id));
            expect(t, id).toBeGreaterThanOrEqual(WALL_S[0]);
            expect(t, id).toBeLessThanOrEqual(WALL_S[1]);
        }
        expect(nearFace(asV012('move-stop'))).toBeGreaterThan(WALL_S[1]);
        // move-speed: the flight forward ends at the zone's near face
        const speed = getLesson('move-speed');
        const zone = worldOf(speed)!.objects()[0] as SonicObject;
        const fly = speed.goals.find((g) => g.kind === 'fly-distance') as Extract<Goal, { kind: 'fly-distance' }>;
        expect(fly.metres).toBeCloseTo(Math.abs(zone.pos[2]) - (zone.shape as { size: readonly number[] }).size[2]! / 2, 6);
    });

    it('hover-turn\'s ring is a sound to turn to, near and to the left as before; control: v0.12\'s was 25 m away', () => {
        const at = (l: LessonDef): { distance: number; bearing: number } => {
            const ring = worldOf(l)!.objects()[0] as SonicObject;
            const dx = ring.pos[0] - l.start.pos[0], dz = ring.pos[2] - l.start.pos[2];
            return { distance: Math.hypot(dx, dz), bearing: (Math.atan2(dx, -dz) * 180) / Math.PI };
        };
        const now = at(getLesson('hover-turn'));
        expect(now.distance).toBeLessThanOrEqual(5);
        const before = at(asV012('hover-turn'));
        expect(before.distance).toBeGreaterThan(5);
        // the same side and angle, so the attempts' turned starts put it in front and behind as before
        expect(Math.abs(now.bearing - before.bearing)).toBeLessThan(1);
    });

    it('the corridor: a corner, a step or a pillar every 2 to 3 s, the first straight under 6 s; control: v0.12 took 5.7 and 17.5 s', () => {
        const t = (l: Pick<LessonDef, 'world' | 'assists'>, key: string): number => {
            const p = worldOf(l)!.resolved;
            return fullStickSeconds(p[key] as number, l.assists.maxSpeedMps as number, 'horizontal');
        };
        const c = getLesson('corridor');
        expect(t(c, 'segmentM')).toBeGreaterThanOrEqual(WALL_S[0]);
        expect(t(c, 'segmentM')).toBeLessThanOrEqual(WALL_S[1]);
        expect(t(c, 'straightM')).toBeLessThan(6);
        expect(t(asV012('corridor'), 'segmentM')).toBeGreaterThan(WALL_S[1]);
        expect(t(asV012('corridor'), 'straightM')).toBeGreaterThan(6);
        // the goals follow the corridor: the straight, then the track to its last few metres. A goal 'fly-distance' counts
        // the attempt's whole path (review M1: the goals are met in turn, each against the path flown since the attempt
        // began, not added up), so the last one is the track's length less a margin for a pilot who cuts the corners
        const goals = c.goals.filter((g): g is Extract<Goal, { kind: 'fly-distance' }> => g.kind === 'fly-distance').map((g) => g.metres);
        const w = worldOf(c)!;
        const track = w.checkpoints ?? [];
        let length = 0;
        for (let i = 1; i < track.length; i++) length += Math.hypot(track[i]!.pos[0] - track[i - 1]!.pos[0], track[i]!.pos[1] - track[i - 1]!.pos[1], track[i]!.pos[2] - track[i - 1]!.pos[2]);
        expect(goals[0]).toBe(w.resolved['straightM']);
        const onLastStretch = (metres: number): boolean => metres < length - 4 + 1e-9 && metres > length - 6;
        expect(onLastStretch(goals.at(-1) as number), `${goals.at(-1)} of ${length.toFixed(2)} m`).toBe(true);
        // control: the goals as they were (15 and 100, read as 115 of the 126 m) pass at 100 m, 26 m before the end
        expect(onLastStretch(100)).toBe(false);
        // and the truth bot is counted there, on the last 6 m of the track, past every pillar but the last (the robust end
        // is lane s13-lessons' goal 'track-end' at the merge: test/world-track-end.test.ts)
        const p = new ScriptedPilot(c);
        const counted: { at: number | null } = { at: null };
        const step = p.tick.bind(p);
        p.tick = () => {
            step();
            if (counted.at === null && p.of('lesson').some((e) => e.what === 'attempt-pass')) counted.at = alongTrack(track, p.pos);
        };
        playLesson(p, () => 'truth', 1);
        const at = counted.at ?? -1;
        expect(at).toBeGreaterThan(length - 6);
        const pillars = w.objects().filter((o) => o.shape.kind === 'pillar').map((o) => alongTrack(track, o.pos)).sort((a, b) => a - b);
        expect(at).toBeGreaterThan((pillars.at(-2) as number) + 0.3);
    }, 120000);

    it.each(CHANGED)('the truth bot passes %s in at most 2 x r attempts, with no touch', (id) => {
        const l = getLesson(id);
        const p = new ScriptedPilot(l);
        playLesson(p, () => 'truth', 2 * l.pass.required);
        expect(p.run.phase, p.results()).toBe('passed');
        expect(p.run.attempt).toBeLessThanOrEqual(2 * l.pass.required);
        expect(p.of('touch')).toEqual([]);
    }, 120000);
});
