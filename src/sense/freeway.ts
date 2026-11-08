// The free way around an obstacle ahead (v0.13, M41-14; the owner, message 41: "in the tunnel, when an
// obstacle comes up, how do we hear that there is free space above it and not below, or to the right,
// or to the left?"). When the craft closes on something straight ahead of its nose in under FREE_TTC_S
// (one ray along the nose: a side wall the craft drifts toward is the safety layer's, not an obstacle
// ahead), the world is probed for a passage beside it: a point just past the obstacle's front, offset to the left,
// the right, up or down, must be reachable in a straight line and free for FREE_DEPTH_M beyond, wide
// enough for the hull. The planner sounds an "open way" chime from the free side (src/cues/planner.ts).
//
// Pure and deterministic: rays only (SonicWorld.castRay), so analytic and scan worlds both work, and a
// replay re-derives the same answer. At most 4 rays per probe and 12 probes a frame, and only while an
// obstacle is that close ahead.
import type { FlightSample, SonicWorld, Vec3 } from '../contract';
import { add, length, normalize, scale, sub } from '../util/vec';
import { listenerBasis, listenerToWorld, worldToListener } from './frame';
import type { ListenerFrame } from './types';

export const FREE_SIDES = ['left', 'right', 'up', 'down'] as const;
export type FreeSide = (typeof FREE_SIDES)[number];

/** An obstacle ahead counts when the front sector's time to contact is under this, s (the owner: "about 3 s"). */
export const FREE_TTC_S = 3;
/** How far beside the craft's line a passage is looked for, m: the nearest first. */
export const FREE_OFFSETS_M: readonly number[] = [0.7, 1.2, 1.8];
/** How far past the obstacle's front the passage must stay free, m. */
export const FREE_DEPTH_M = 1.5;
/** The probe point lies this far past the obstacle's front, m, so it is beside the obstacle, not before it. */
export const FREE_PAST_M = 0.25;
/** Half the width a passage must have across the side direction, m (the hull 0.12 and a margin). */
export const FREE_HALF_WIDTH_M = 0.2;

/** The listener-frame unit vector of each side (heading frame: x right, y up, z back). */
export const FREE_SIDE_AXES: Readonly<Record<FreeSide, Vec3>> = {
    left: [-1, 0, 0],
    right: [1, 0, 0],
    up: [0, 1, 0],
    down: [0, -1, 0]
};

export interface FreeWay {
    readonly side: FreeSide;
    /** how far beside the craft's line the passage was found, m */
    readonly offsetM: number;
    /** hull distance to the obstacle ahead, m */
    readonly obstacleM: number;
    /** time to contact with it along the nose, s */
    readonly ttcS: number;
}

export interface FreeWayOptions {
    readonly bodyRadiusM: number;
    /** look for this side first when it is free (the side sounding already: no flipping between two equal gaps) */
    readonly prefer?: FreeSide | null;
    /** the trigger: the time to contact with what is straight ahead under this, s (FREE_TTC_S) */
    readonly ttcS?: number;
}

/** The order the sides are tried in: the preferred one, then the side the craft drifts toward, then left, right, up, down. */
export function sideOrder(velListener: Vec3, prefer: FreeSide | null | undefined): FreeSide[] {
    const order: FreeSide[] = [];
    const push = (s: FreeSide): void => {
        if (!order.includes(s)) order.push(s);
    };
    if (prefer !== null && prefer !== undefined) push(prefer);
    if (velListener[0] < -0.2) push('left');
    else if (velListener[0] > 0.2) push('right');
    if (velListener[1] > 0.2) push('up');
    else if (velListener[1] < -0.2) push('down');
    for (const s of FREE_SIDES) push(s);
    return order;
}

/** Closing slower than this along the nose is not closing, m/s (as the scene sampler). */
const MIN_CLOSING_MPS = 0.2;

/**
 * The free way around the obstacle ahead, or null: nothing straight ahead closing in under the trigger
 * time, or no side free (a closed tunnel, a dead end, a wall with no way past it).
 */
export function findFreeWay(flight: FlightSample, world: SonicWorld | null, frame: ListenerFrame, options: FreeWayOptions): FreeWay | null {
    if (world === null) return null;
    const trigger = options.ttcS ?? FREE_TTC_S;
    const basis = listenerBasis(flight, frame);
    const fwd = listenerToWorld(basis, [0, 0, -1]);
    const velL = worldToListener(basis, flight.vel);
    const closing = -velL[2];
    if (!(closing >= MIN_CLOSING_MPS)) return null;
    const ahead = world.castRay(flight.pos, fwd, trigger * closing + options.bodyRadiusM);
    if (ahead === null) return null;
    const obstacleM = Math.max(0, ahead.distance - options.bodyRadiusM);
    const ttcS = obstacleM / closing;
    if (!(ttcS < trigger)) return null;
    const depth = ahead.distance + FREE_PAST_M;
    const order = sideOrder(velL, options.prefer);
    const blocked = (from: Vec3, dir: Vec3, dist: number): boolean => world.castRay(from, dir, dist) !== null;
    for (const offset of FREE_OFFSETS_M) {
        for (const side of order) {
            const across = listenerToWorld(basis, FREE_SIDE_AXES[side]);
            const point = add(add(flight.pos, scale(fwd, depth)), scale(across, offset));
            const to = sub(point, flight.pos);
            const reach = length(to);
            // the straight line there must be clear, the hull's radius included
            if (blocked(flight.pos, normalize(to), reach + options.bodyRadiusM)) continue;
            // and the passage past the obstacle's front free for FREE_DEPTH_M, at its middle and at both edges
            if (blocked(point, fwd, FREE_DEPTH_M)) continue;
            if (blocked(add(point, scale(across, FREE_HALF_WIDTH_M)), fwd, FREE_DEPTH_M)) continue;
            if (blocked(add(point, scale(across, -FREE_HALF_WIDTH_M)), fwd, FREE_DEPTH_M)) continue;
            return { side, offsetM: offset, obstacleM, ttcS };
        }
    }
    return null;
}
