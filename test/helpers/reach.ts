// How long the walls of a lesson world are from its start at full stick (M41-18: "one, two, three,
// oops, a wall"). A MODEL of the simulator's lesson pilot, not a flight: its numbers are estimates
// from the assist's constants (ShramkoGSFPV apps/fly/src/play/game.ts and play/assist.ts):
//   horizontal  the target speed ramps up at ACCEL_MPS2 = 6 m/s^2 (game.ts:43) to the lesson's cap;
//               the craft follows it through the velocity loop, a time constant of 1 / KV_H = 0.4 s
//               (game.ts:47) over the attitude loop's 0.2 s (two first-order lags in series)
//   vertical    the climb command ramps to full in 0.25 s (COMMAND_RAMP_PER_S = 4, game.ts:66); the
//               craft follows it with 1 / KV = 0.25 s (assist.ts:28)
// Distances are from the craft's hull (BODY_RADIUS_M, the sampler's and the goals' radius) to the
// first surface a ray from the start meets.
import type { LessonDef, SonicObject, Vec3 } from '../../src/contract';
import { BODY_RADIUS_M } from '../../src/lesson';
import { quatRotate } from '../../src/util/vec';
import { createAnalyticWorld, type AnalyticWorldInfo } from '../../src/world';

export const ACCEL_MPS2 = 6;
export const TAU_VELOCITY_S = 0.4;
export const TAU_ATTITUDE_S = 0.2;
export const CLIMB_RAMP_S = 0.25;
export const TAU_CLIMB_S = 0.25;

/** Seconds from a hover at full stick until the craft has covered `distanceM` (horizontal: the speed cap; vertical: the climb cap). */
export function fullStickSeconds(distanceM: number, capMps: number, axis: 'horizontal' | 'vertical'): number {
    if (!(distanceM > 0)) return 0;
    if (!(capMps > 0)) return Infinity;
    const dt = 0.001;
    let t = 0, x = 0, v1 = 0, v = 0;
    for (let i = 0; i < 600000; i++) {
        t += dt;
        if (axis === 'horizontal') {
            const target = Math.min(capMps, ACCEL_MPS2 * t);
            v1 += ((target - v1) * dt) / TAU_VELOCITY_S;
            v += ((v1 - v) * dt) / TAU_ATTITUDE_S;
        } else {
            const target = capMps * Math.min(1, t / CLIMB_RAMP_S);
            v += ((target - v) * dt) / TAU_CLIMB_S;
        }
        x += v * dt;
        if (x >= distanceM) return t;
    }
    return Infinity;
}

/** One distance of the table: what lies there, how far (hull), and the seconds at full stick. */
export interface Reach {
    readonly what: string;
    readonly metres: number;
    readonly seconds: number;
}

/** The seconds-to-wall row of a lesson with an analytic world. */
export interface ScaleRow {
    readonly lesson: string;
    readonly generator: string;
    readonly version: number;
    readonly params: Readonly<Record<string, unknown>>;
    readonly start: LessonDef['start'];
    readonly maxSpeedMps: number;
    readonly maxClimbMps: number;
    readonly ahead: Reach | null;
    readonly left: Reach | null;
    readonly right: Reach | null;
    readonly ceiling: Reach | null;
    /** the course or the row, thing to thing: the start to the first gate, gate to gate, the last one to the far wall */
    readonly legs: readonly Reach[];
}

const DEG = Math.PI / 180;

function rayReach(w: AnalyticWorldInfo, from: Vec3, dir: Vec3, cap: number, axis: 'horizontal' | 'vertical'): Reach | null {
    const hit = w.castRay(from, dir, 1000);
    if (hit === null) return null;
    const metres = Math.max(0, hit.distance - BODY_RADIUS_M);
    return { what: hit.objectId ?? hit.material, metres: round2(metres), seconds: round2(fullStickSeconds(metres, cap, axis)) };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The gates of a world in course order. */
const gatesOf = (w: AnalyticWorldInfo): SonicObject[] => w.objects().filter((o) => o.order !== null && o.shape.kind !== 'zone').sort((a, b) => (a.order as number) - (b.order as number));

/** The seconds-to-wall row of a lesson (null without an analytic world). */
export function scaleRow(lesson: LessonDef): ScaleRow | null {
    if (lesson.world.kind !== 'analytic') return null;
    const w = createAnalyticWorld(lesson.world.spec);
    const a = lesson.assists;
    const speed = a.maxSpeedMps ?? 6;
    const climb = a.maxClimbMps ?? 3;
    const s = lesson.start.pos;
    const yaw = lesson.start.yawDeg * DEG;
    const nose: Vec3 = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const leftDir: Vec3 = [-Math.cos(yaw), 0, -Math.sin(yaw)];
    const rightDir: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
    const legs: Reach[] = [];
    const gates = gatesOf(w);
    if (gates.length > 0) {
        let from: Vec3 = s;
        let name = 'start';
        for (const g of gates) {
            const metres = Math.max(0, Math.hypot(g.pos[0] - from[0], g.pos[2] - from[2]));
            legs.push({ what: `${name} to ${g.id}`, metres: round2(metres), seconds: round2(fullStickSeconds(metres, speed, 'horizontal')) });
            from = g.pos;
            name = g.id;
        }
        const last = gates[gates.length - 1] as SonicObject;
        const pass = quatRotate(last.quat, [0, 0, -1]);
        const beyond = rayReach(w, last.pos, [pass[0], 0, pass[2]], speed, 'horizontal');
        if (beyond !== null) legs.push({ ...beyond, what: `${last.id} to ${beyond.what}` });
    }
    const pillars = w.objects().filter((o) => o.shape.kind === 'pillar');
    if (pillars.length > 0 && lesson.world.spec.generator === 'pillars') {
        // the pillar or the row ahead, then the far wall from the row's line
        const near = Math.min(...pillars.map((p) => Math.hypot(p.pos[0] - s[0], p.pos[2] - s[2]) - (p.shape.kind === 'pillar' ? p.shape.radius : 0)));
        const toRow = Math.max(0, near - BODY_RADIUS_M);
        legs.push({ what: 'start to the pillars', metres: round2(toRow), seconds: round2(fullStickSeconds(toRow, speed, 'horizontal')) });
        const rowZ = pillars[0]!.pos[2];
        const gap = pillars.length > 1 ? (pillars[0]!.pos[0] + pillars[1]!.pos[0]) / 2 : pillars[0]!.pos[0] + ((pillars[0]!.shape as { radius: number }).radius + 1.5);
        const beyond = rayReach(w, [gap, s[1], rowZ], nose, speed, 'horizontal');
        if (beyond !== null) legs.push({ ...beyond, what: `the pillars to ${beyond.what}` });
    }
    return {
        lesson: lesson.id,
        generator: lesson.world.spec.generator,
        version: lesson.world.spec.version,
        params: lesson.world.spec.params,
        start: lesson.start,
        maxSpeedMps: speed,
        maxClimbMps: climb,
        ahead: rayReach(w, s, nose, speed, 'horizontal'),
        left: rayReach(w, s, leftDir, speed, 'horizontal'),
        right: rayReach(w, s, rightDir, speed, 'horizontal'),
        ceiling: rayReach(w, s, [0, 1, 0], climb, 'vertical'),
        legs
    };
}
