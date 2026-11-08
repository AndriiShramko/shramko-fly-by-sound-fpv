// The track of a lesson: the way it is meant to be flown, as points in order with the direction of the
// track at each. It says which way is forward (M41-15: flying back along a corridor or a course is told)
// and where a craft that touched goes back to (M41-20: 1 m before the last point passed, facing along the
// track). Three sources, the first one that exists:
//   1. the world's own checkpoint list, `checkpoints: { pos, dir, stage? }[]` on an analytic world (lane
//      s13-worlds adds it: points every few metres); feature-detected, so a world without it still works;
//   2. the lesson's checkpoints (at least two), in their order, each pointing at the next;
//   3. the gates of a course (a pass-gates or timed-course goal): the start, then each gate along its axis.
// A lesson with none of them (a hall, a turn, a zone) has no track: nothing is told about direction.
import type { Checkpoint, Goal, LessonDef, Pose, SonicObject, SonicWorld, Vec3 } from '../contract';
import { add, dot, length, normalize, quatRotate, scale, sub } from '../util/vec';
import { courseGates } from './goals';

/** One point of a track: where it is, the way the track goes there, the stage it ends (if any). */
export interface TrackPoint {
    readonly id: string;
    readonly pos: Vec3;
    /** unit, world frame */
    readonly dir: Vec3;
    readonly stage?: number;
    /** a lesson checkpoint's own pose (where it puts the craft back), or null for a point of a world list or a gate */
    readonly pose: Pose | null;
}

export interface LessonTrack {
    readonly source: 'world' | 'checkpoints' | 'gates';
    readonly points: readonly TrackPoint[];
    /** the direction of the track near `p` (unit), or null when `p` is further than OFF_TRACK_M from it */
    dirAt(p: Vec3): Vec3 | null;
}

/** Further than this from every segment of the track, the craft is not on it (an open hall around a course), m. */
export const OFF_TRACK_M = 15;

/** A world's checkpoint list, when it has one: `checkpoints: { pos, dir, stage? }[]` (lane s13-worlds). */
export function worldCheckpoints(world: SonicWorld | null): TrackPoint[] | null {
    const list = (world as { readonly checkpoints?: unknown } | null)?.checkpoints;
    if (!Array.isArray(list) || list.length < 2) return null;
    const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    const out: TrackPoint[] = [];
    for (const [i, x] of list.entries()) {
        const r = x as { readonly pos?: unknown; readonly dir?: unknown; readonly stage?: unknown };
        if (!vec(r.pos) || !vec(r.dir) || length(r.dir) < 1e-6) return null;
        const stage = typeof r.stage === 'number' && Number.isInteger(r.stage) && r.stage > 0 ? r.stage : undefined;
        out.push({ id: `w${i + 1}`, pos: r.pos, dir: normalize(r.dir), pose: null, ...(stage === undefined ? {} : { stage }) });
    }
    return out;
}

/** The yaw of a horizontal direction: 0 along -Z, positive to the right, degrees. */
export function yawOf(dir: Vec3): number {
    return (Math.atan2(dir[0], -dir[2]) * 180) / Math.PI;
}

const forwardOf = (yawDeg: number): Vec3 => [Math.sin((yawDeg * Math.PI) / 180), 0, -Math.cos((yawDeg * Math.PI) / 180)];

function fromCheckpoints(cps: readonly Checkpoint[]): TrackPoint[] {
    return cps.map((cp, i) => {
        const next = cps[i + 1];
        const prev = cps[i - 1];
        const along = next !== undefined ? sub(next.at, cp.at) : prev !== undefined ? sub(cp.at, prev.at) : forwardOf(cp.pose.yawDeg);
        const dir = length(along) < 1e-6 ? forwardOf(cp.pose.yawDeg) : normalize(along);
        return { id: cp.id, pos: cp.at, dir, pose: cp.pose, ...(cp.stage === undefined ? {} : { stage: cp.stage }) };
    });
}

function fromGates(gates: readonly SonicObject[], start: Pose): TrackPoint[] {
    const first = gates[0];
    if (first === undefined) return [];
    const toFirst = sub(first.pos, start.pos);
    const startDir = length(toFirst) < 1e-6 ? forwardOf(start.yawDeg) : normalize(toFirst);
    return [{ id: 'start', pos: start.pos, dir: startDir, pose: start }, ...gates.map((g) => ({ id: g.id, pos: g.pos, dir: normalize(quatRotate(g.quat, [0, 0, -1])), pose: null }))];
}

/** The closest point of the segment a..b to p, as the share along it (0..1) and the distance. */
function onSegment(a: Vec3, b: Vec3, p: Vec3): { readonly u: number; readonly d: number } {
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const u = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
    return { u, d: length(sub(p, add(a, scale(ab, u)))) };
}

function makeTrack(source: LessonTrack['source'], points: readonly TrackPoint[]): LessonTrack {
    return {
        source,
        points,
        dirAt(p) {
            let best: { d: number; dir: Vec3 } | null = null;
            for (let i = 0; i + 1 < points.length; i++) {
                const a = points[i] as TrackPoint;
                const b = points[i + 1] as TrackPoint;
                const { u, d } = onSegment(a.pos, b.pos, p);
                if (best !== null && d >= best.d) continue;
                // a world list's points carry the way the track goes there; elsewhere the segment's own way
                const dir = source === 'world' ? normalize(add(scale(a.dir, 1 - u), scale(b.dir, u))) : normalize(sub(b.pos, a.pos));
                best = { d, dir };
            }
            if (best === null) {
                const only = points[0];
                return only === undefined || length(sub(p, only.pos)) > OFF_TRACK_M ? null : only.dir;
            }
            return best.d > OFF_TRACK_M ? null : best.dir;
        }
    };
}

/** The track of `lesson` in `world` (its objects and start as the runner flies them), or null when it has none. */
export function lessonTrack(lesson: Pick<LessonDef, 'goals' | 'checkpoints'>, world: SonicWorld | null, objects: readonly SonicObject[], start: Pose): LessonTrack | null {
    const fromWorld = worldCheckpoints(world);
    if (fromWorld !== null) return makeTrack('world', fromWorld);
    if (lesson.checkpoints.length >= 2) return makeTrack('checkpoints', fromCheckpoints(lesson.checkpoints));
    const course = lesson.goals.find((g): g is Extract<Goal, { kind: 'pass-gates' | 'timed-course' }> => g.kind === 'pass-gates' || g.kind === 'timed-course');
    if (course !== undefined) {
        const gates = courseGates(objects, course.kind === 'pass-gates' ? course.gateIds : 'all');
        if (gates.length > 0) return makeTrack('gates', fromGates(gates, start));
    }
    return null;
}
