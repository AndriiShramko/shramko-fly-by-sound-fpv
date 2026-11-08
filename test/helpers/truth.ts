// The truth bot: a scripted pilot who knows the lesson's world (where every gate, zone, pillar and
// wall is) and flies each goal of an attempt as a good pilot would, within the lesson's assists
// (speed, climb and turn caps), without touching anything. It is the "can this lesson be passed at
// all" pilot of the pass-rule tests: a lesson it cannot pass in at most 2 x r attempts is broken.
import type { Goal, ObjectShape, SonicObject, SonicWorld, Vec3 } from '../../src/contract';
import { courseGates } from '../../src/lesson';
import { quatRotate } from '../../src/util/vec';
import type { DemoScene, Question } from '../../src/lesson';
import { ScriptedPilot } from './pilot';

/** A checkpoint list a world may carry (lane s13-worlds adds it to the analytic worlds): feature-detected. */
export interface TrackPoint {
    readonly pos: Vec3;
    readonly dir: Vec3;
    readonly stage?: number;
}

export function worldTrack(world: SonicWorld | null): readonly TrackPoint[] | null {
    const list = (world as { readonly checkpoints?: unknown } | null)?.checkpoints;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list as TrackPoint[];
}

const n = (p: Readonly<Record<string, unknown>>, k: string): number => p[k] as number;

/**
 * The corridor's centre line at the start height, as generator 'corridor' v1 lays it out (layout 'full':
 * straight, obstacle, left-right bends, up-down jogs, bends with obstacles), passing the obstacle on the side.
 */
export function corridorLine(params: Readonly<Record<string, unknown>>): Vec3[] {
    const y0 = n(params, 'startHeightM');
    const seg = n(params, 'segmentM');
    const rise = n(params, 'riseM');
    const w = n(params, 'widthM');
    const even = (k: number): number => (k % 2 === 0 ? k : k + 1);
    const bends = even(n(params, 'bendCount'));
    const jogs = even(n(params, 'jogCount'));
    let x = 0, y = 0, z = 0, hx = 0, hz = -1;
    const out: Vec3[] = [[0, y0, 0]];
    const at = (): Vec3 => [x, y + y0, z];
    const forward = (len: number): void => {
        x += hx * len;
        z += hz * len;
        out.push(at());
    };
    const turn = (dir: 'left' | 'right'): void => {
        const [a, b] = dir === 'right' ? [-hz, hx] : [hz, -hx];
        hx = a + 0;
        hz = b + 0;
    };
    forward(n(params, 'straightM'));
    // the obstacle stands in the middle at `seg`: pass it a third of the width to the side
    const side = w / 3;
    out.push([x + -hz * side, y + y0, z + hz * (seg - 4)], [x + -hz * side, y + y0, z + hz * (seg + 4)]);
    forward(2 * seg);
    for (let i = 0; i < bends; i++) {
        turn(i % 2 === 0 ? 'right' : 'left');
        forward(seg);
    }
    forward(seg);
    for (let i = 0; i < jogs; i++) {
        y += i % 2 === 0 ? rise : -rise;
        out.push(at());
        forward(seg);
    }
    return out;
}

const SHAPES: readonly ObjectShape['kind'][] = ['ring', 'square', 'cube-frame', 'pillar'];

/** The right answers of a flying lesson's question (name-shape). */
export function truthAnswerer(p: ScriptedPilot): (q: Question, scene: DemoScene | null) => number {
    return (q) => {
        if (!q.id.endsWith(':shape')) return 0;
        const goal = p.lesson.goals.find((g): g is Extract<Goal, { kind: 'name-shape' }> => g.kind === 'name-shape');
        const o = goal === undefined ? null : p.objects().find((x) => x.id === goal.objectId);
        return o === null || o === undefined ? 0 : SHAPES.indexOf(o.shape.kind) + 1;
    };
}

/** Whether the attempt that was running when `attempt` was read is still running. */
const still = (p: ScriptedPilot, attempt: number): boolean => p.run.attempt === attempt && p.run.phase === 'flying';

function flyGoal(p: ScriptedPilot, goal: Goal, attempt: number): void {
    const objects = (): readonly SonicObject[] => p.objects();
    const obj = (id: string): SonicObject => {
        const o = objects().find((x) => x.id === id);
        if (o === undefined) throw new Error(`no object ${id}`);
        return o;
    };
    switch (goal.kind) {
        case 'hold-height': {
            const floor = p.analytic?.floorY ?? 0;
            p.flyTo([p.pos[0], floor + (goal.bandM[0] + goal.bandM[1]) / 2, p.pos[2]]);
            p.until(() => !still(p, attempt), goal.seconds + 2);
            return;
        }
        case 'turn-to':
            p.face(obj(goal.objectId).pos);
            p.until(() => !still(p, attempt), 2);
            return;
        case 'reach-zone':
            p.flyTo(obj(goal.zoneId).pos);
            p.until(() => !still(p, attempt), 2);
            return;
        case 'approach-stop': {
            // toward the farthest wall, to half the allowed distance from it
            const w = p.world;
            if (w === null) return;
            let best: { yaw: number; d: number } = { yaw: p.yaw, d: 0 };
            for (let k = 0; k < 8; k++) {
                const yaw = k * 45;
                const a = (yaw * Math.PI) / 180;
                const hit = w.castRay(p.pos, [Math.sin(a), 0, -Math.cos(a)], 200);
                if (hit !== null && hit.distance > best.d) best = { yaw, d: hit.distance };
            }
            const a = (best.yaw * Math.PI) / 180;
            const go = best.d - goal.stopWithinM / 2;
            p.turnTo(best.yaw);
            p.flyTo([p.pos[0] + Math.sin(a) * go, p.pos[1], p.pos[2] - Math.cos(a) * go]);
            p.until(() => !still(p, attempt), 2);
            return;
        }
        case 'around': {
            const o = obj(goal.objectId);
            const r = (o.shape.kind === 'pillar' ? o.shape.radius : 1) + 2.5;
            let a = Math.atan2(p.pos[2] - o.pos[2], p.pos[0] - o.pos[0]);
            const y = p.pos[1];
            p.flyTo([o.pos[0] + r * Math.cos(a), y, o.pos[2] + r * Math.sin(a)]);
            for (let k = 0; k < 74 && still(p, attempt); k++) {
                a += (5 * Math.PI) / 180;
                p.flyTo([o.pos[0] + r * Math.cos(a), y, o.pos[2] + r * Math.sin(a)], Infinity, false);
            }
            return;
        }
        case 'fly-distance': {
            const track = worldTrack(p.world);
            if (track !== null) {
                for (const cp of track) if (still(p, attempt)) p.flyTo(cp.pos);
                return;
            }
            const built = p.analytic;
            if (built !== null && built.spec.generator === 'corridor') {
                for (const q of corridorLine(built.resolved)) if (still(p, attempt)) p.flyTo(q);
                return;
            }
            // a row of pillars across the way: through the gap nearest to the nose's line
            const pillars = objects().filter((o) => o.shape.kind === 'pillar').map((o) => o.pos[0]).sort((u, v) => u - v);
            let x = p.pos[0];
            if (pillars.length > 1) {
                let bestGap = Infinity;
                for (let i = 0; i + 1 < pillars.length; i++) {
                    const mid = ((pillars[i] as number) + (pillars[i + 1] as number)) / 2;
                    if (Math.abs(mid - p.pos[0]) < Math.abs(bestGap - p.pos[0])) bestGap = mid;
                }
                x = bestGap;
            }
            p.flyTo([x, p.pos[1], p.pos[2]], Infinity, false);
            p.flyTo([x, p.pos[1], p.pos[2] - (goal.metres + 2)]);
            return;
        }
        case 'pass-gates':
        case 'timed-course': {
            const gates = courseGates(objects(), goal.kind === 'pass-gates' ? goal.gateIds : 'all');
            const laps = goal.kind === 'timed-course' ? goal.laps : 1;
            for (let lap = 0; lap < laps; lap++) {
                for (const g of gates) {
                    if (!still(p, attempt)) return;
                    const f = quatRotate(g.quat, [0, 0, 1]);
                    p.flyTo([g.pos[0] + f[0] * 4, g.pos[1] + f[1] * 4, g.pos[2] + f[2] * 4]);
                    p.flyTo([g.pos[0] - f[0] * 4, g.pos[1] - f[1] * 4, g.pos[2] - f[2] * 4]);
                }
            }
            return;
        }
        default:
            // name-shape: answered by truthAnswerer
            p.until(() => !still(p, attempt), 3);
    }
}

/** Flies the attempt now running, goal by goal, until it ends. */
export function flyTruth(p: ScriptedPilot): void {
    const attempt = p.run.attempt;
    for (const goal of p.lesson.goals) {
        if (!still(p, attempt)) return;
        flyGoal(p, goal, attempt);
    }
    p.until(() => !still(p, attempt), 10);
}

/**
 * An attempt failed on purpose: the pilot does nothing, which fails every goal (review D5) except a height band the
 * craft already sits in, so there he climbs above the band and stays.
 */
function failAttempt(p: ScriptedPilot): void {
    const hold = p.lesson.goals.find((g): g is Extract<Goal, { kind: 'hold-height' }> => g.kind === 'hold-height');
    if (hold !== undefined) p.flyTo([p.pos[0], (p.analytic?.floorY ?? 0) + hold.bandM[1] + 1, p.pos[2]]);
}

/** Runs a flying lesson to its end: each attempt flown by `plan(attempt)`, 'truth' or 'fail' (the attempt fails). */
export function playLesson(p: ScriptedPilot, plan: (attempt: number) => 'truth' | 'fail', maxAttempts = 20): void {
    p.answerer = truthAnswerer(p);
    p.begin();
    p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 600);
    const limit = (p.lesson.attemptLimitS ?? 600) + 30;
    for (let k = 0; k < maxAttempts && p.run.phase !== 'passed'; k++) {
        const attempt = p.run.attempt;
        if (plan(attempt) === 'truth') flyTruth(p);
        else failAttempt(p);
        p.until(() => p.run.attempt > attempt || p.run.phase === 'passed', limit);
        p.until(() => p.run.phase === 'flying' || p.run.phase === 'passed', 120);
    }
}
