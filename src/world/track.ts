// The track of a lesson world (M41-20, respawn near the crash): the line a craft flies along a corridor
// or through a course of gates, handed out as checkpoints at most a few metres apart
// (AnalyticWorld.checkpoints, contract WorldCheckpoint). A builder gives the NODES (the corners of the
// line, where it must bend to stay clear of the walls, obstacles and gate frames); `densify` adds points
// between them, so consecutive checkpoints are at most CHECKPOINT_SPACING_M apart and the straight line
// between any two of them is free (the nodes are chosen for that).
//
// pos: on the track's centre line at flying height (through the free way past an obstacle).
// dir: horizontal unit vector (y = 0), the heading of the track there: the corridor's heading, a gate's
//      pass direction, a leg's direction between gates. A respawn faces it; a craft that flies against it
//      flies back along the track.
// stage: k only on the checkpoint that ends stage k (1-based), when the world has stages.
import type { SonicObject, Vec3, WorldCheckpoint } from '../contract';
import { quatRotate, round6 } from '../util/vec';

/** Checkpoints are at most this far apart along the track (the contract promises at most 6 m). */
export const CHECKPOINT_SPACING_M = 5;
/** The checkpoint before a gate (or an obstacle) is this far before its front, on its axis, facing it. */
export const APPROACH_M = 1.5;
/** ... and the track goes on this far past a gate on its axis before it turns to the next one. */
export const GATE_EXIT_M = 1;
/** Past an obstacle's back the track keeps to the free way this far before it returns to the middle. */
export const OBSTACLE_EXIT_M = 1;
/** A move to the side, up or down takes at least this many metres of track per metre of offset. */
export const DODGE_SLOPE = 3;
/**
 * A corridor's track ends this far before the wall that closes it, metres (review M2): the end of the course is
 * where a pilot counts as through it (lane s13-lessons' goal 'track-end'), and a pilot who brakes at the sound of
 * that wall and stops a metre or two before it must have passed it. At the tunnels' caps (2 to 3 m/s) it is about
 * a second before contact.
 */
export const END_CLEAR_M = 2.5;

export interface TrackNode {
    readonly pos: Vec3;
    /** horizontal unit vector: the track's heading at this node */
    readonly dir: Vec3;
    /** this node ends stage k */
    readonly stage?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const r6 = (a: Vec3): Vec3 => [round6(a[0]), round6(a[1]), round6(a[2])];

/** The horizontal unit vector of `v`, or null when it has no horizontal part. */
export function heading(v: Vec3): Vec3 | null {
    const l = Math.hypot(v[0], v[2]);
    return l < 1e-9 ? null : [v[0] / l + 0, 0, v[2] / l + 0];
}

/**
 * The checkpoints of a track: every node, and between two nodes more than `spacing` apart evenly spaced
 * points on the straight line between them, each facing that line's heading (the start node's when the
 * line is vertical). Nodes closer than 1 cm to the previous one are dropped.
 */
export function densify(nodes: readonly TrackNode[], spacing = CHECKPOINT_SPACING_M): WorldCheckpoint[] {
    const out: WorldCheckpoint[] = [];
    let prev: TrackNode | null = null;
    for (const node of nodes) {
        if (prev !== null) {
            const d = sub(node.pos, prev.pos);
            const l = len(d);
            if (l < 0.01) {
                if (node.stage !== undefined) out[out.length - 1] = { ...(out[out.length - 1] as WorldCheckpoint), stage: node.stage };
                continue;
            }
            const steps = Math.ceil(l / spacing - 1e-9);
            const dir = heading(d) ?? prev.dir;
            for (let k = 1; k < steps; k++) out.push({ pos: r6(add(prev.pos, scale(d, k / steps))), dir: r6(dir) });
        }
        out.push(node.stage === undefined ? { pos: r6(node.pos), dir: r6(node.dir) } : { pos: r6(node.pos), dir: r6(node.dir), stage: node.stage });
        prev = node;
    }
    return out;
}

// ------------------------------------------------------------------ gates

/** The track through a course of gates: from the start to 1.5 m before each gate on its axis, through it, 1 m past it. */
export function gateNodes(start: Vec3, gates: readonly SonicObject[]): TrackNode[] {
    const ordered = gates.filter((g) => g.order !== null).sort((a, b) => (a.order as number) - (b.order as number));
    if (ordered.length === 0) return [];
    const nodes: TrackNode[] = [];
    let from = start;
    ordered.forEach((g) => {
        // a craft passes along the gate's local -Z: it comes from the +Z side
        const pass = heading(quatRotate(g.quat, [0, 0, -1])) as Vec3;
        const before = add(g.pos, scale(pass, -APPROACH_M));
        const lead = heading(sub(before, from)) ?? pass;
        if (nodes.length === 0) nodes.push({ pos: from, dir: lead });
        nodes.push({ pos: before, dir: pass });
        const after = add(g.pos, scale(pass, GATE_EXIT_M));
        nodes.push({ pos: after, dir: pass });
        from = after;
    });
    return nodes;
}

// ------------------------------------------------------------------ corridors

/** Something in a corridor's run that the track goes past through its free way. */
export interface Dodge {
    /** distance from the run's start to the obstacle's centre, along the run */
    readonly along: number;
    /** the obstacle's half extent along the run (a pillar's radius, a box's half depth) */
    readonly reach: number;
    /** the free way's centre relative to the run's centre line: to the right of the heading, and up */
    readonly right: number;
    readonly up: number;
}

/** One straight piece of a corridor: its centre line at flying height, from `from` to `to`. */
export interface Run {
    readonly from: Vec3;
    readonly to: Vec3;
    /** horizontal unit vector along the run */
    readonly heading: Vec3;
    /** half the corridor's width here: a corner is cut this far from it on either side */
    readonly half: number;
    readonly dodges: readonly Dodge[];
    /** the run ends stage k */
    readonly stageEnd?: number;
}

/**
 * The track along a corridor's runs. Where two runs meet at a corner (a turn) or a step (a jog: the
 * next run starts higher or lower), the track leaves the first run `half` before the joint and joins
 * the next one `half` after it, so the straight line between the two stays inside the corner square or
 * the shaft, clear of the inner corner by half * sqrt(2) / 2. Past an obstacle it moves to the free way's
 * centre over DODGE_SLOPE metres per metre of offset, reaches it APPROACH_M before the obstacle's front,
 * keeps it OBSTACLE_EXIT_M past its back, and comes back the same way. The last run's box reaches `half`
 * past its end, where the closing wall stands: the track ends END_CLEAR_M before that wall (no later
 * than the run's end, no earlier than where it joined the run).
 */
export function corridorNodes(runs: readonly Run[]): TrackNode[] {
    const nodes: TrackNode[] = [];
    const push = (pos: Vec3, dir: Vec3, stage?: number): void => {
        nodes.push(stage === undefined ? { pos, dir } : { pos, dir, stage });
    };
    runs.forEach((run, i) => {
        const prev = runs[i - 1];
        const next = runs[i + 1];
        const joint = (a: Run | undefined, b: Run | undefined): boolean =>
            a !== undefined && b !== undefined && (Math.abs(a.heading[0] - b.heading[0]) > 1e-9 || Math.abs(a.heading[2] - b.heading[2]) > 1e-9 || Math.abs(a.to[1] - b.from[1]) > 1e-9);
        const total = len(sub(run.to, run.from));
        const a0 = joint(prev, run) ? Math.min(run.half, total / 2) : 0;
        const a1 = joint(run, next) ? Math.max(total - run.half, total / 2) : next === undefined ? Math.max(a0, Math.min(total, total + run.half - END_CLEAR_M)) : total;
        const right: Vec3 = [-run.heading[2] + 0, 0, run.heading[0] + 0];
        const at = (along: number, r = 0, u = 0): Vec3 => add(add(run.from, scale(run.heading, along)), add(scale(right, r), [0, u, 0]));
        if (i === 0 || a0 > 0) push(at(a0), run.heading);
        for (const d of [...run.dodges].sort((x, y) => x.along - y.along)) {
            const off = Math.hypot(d.right, d.up);
            const slope = Math.max(1, DODGE_SLOPE * off);
            const front = d.along - d.reach - APPROACH_M;
            const back = d.along + d.reach + OBSTACLE_EXIT_M;
            const begin = Math.max(a0, front - slope);
            const end = Math.min(a1, back + slope);
            if (begin < front - 1e-9) push(at(begin), run.heading);
            push(at(Math.max(front, a0), d.right, d.up), run.heading);
            push(at(Math.min(back, a1), d.right, d.up), run.heading);
            if (end > back + 1e-9) push(at(end), run.heading);
        }
        push(at(a1), run.heading, run.stageEnd);
    });
    return nodes;
}
