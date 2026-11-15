// Gate aim (sonic3 stage S1, layers.gateAim): where the hum of a gate points so that its direction always leads through
// the opening from the entry side (+Z of the gate's frame; a gate is passed from +Z to -Z, goals.ts gateCrossing).
// The browser miss records of S1 (Tunis g1 and g24) showed the two faults of a hum at the gate centre: a craft behind the
// plane is led into the gate from the wrong side, and at the centre the direction turns steep and says nothing of "go
// through". So:
// - behind the plane (local z <= 0): a point beside the frame on the entry side (around the gate, not through it);
// - in front but off the gate's axis (outside the approach cone): the approach point on the axis, GATE_AIM_APPROACH_M out;
// - in the cone: the centre; within GATE_AIM_THROUGH_M of the plane: a point GATE_AIM_PAST_M beyond it, so the hum stays
//   ahead and level while the craft passes.
// All distances are estimates (not measured yet by tools/ear-pilot.ts); the S1 browser runs measure them on the scans.
import type { SonicObject, Vec3 } from '../contract';
import { quatRotate } from '../util/vec';
import { opening, toLocal } from './goals';

/** the approach point's distance out from the gate on its entry side, m (estimate) */
export const GATE_AIM_APPROACH_M = 3;
/** within this distance in front of the plane (and in the cone) the hum points beyond the gate, m (estimate) */
export const GATE_AIM_THROUGH_M = 2;
/** how far beyond the plane the hum points while the craft passes, m (estimate) */
export const GATE_AIM_PAST_M = 3;
/** the approach cone: off the axis by at most this share of the distance to the plane (about 31 degrees), or the opening (estimate) */
export const GATE_AIM_CONE = 0.6;
/** behind the plane the aim lies this far outside the frame's edge, m (estimate) */
export const GATE_AIM_AROUND_M = 1.5;
/** close to the plane: the nearest aim point on the axis, in front (slide) or beyond (through), m (estimate) */
export const GATE_AIM_MIN_M = 1;
/** the straight way to the point beyond must cross the plane this much inside the opening (1.25: 20 % margin; estimate) */
export const GATE_AIM_MARGIN = 1.25;

/** Shapes a craft flies through (the others are passed by entering them, as before). */
function isOpening(o: SonicObject): boolean {
    const k = o.shape.kind;
    return k === 'ring' || k === 'square' || k === 'cube-frame';
}

/** The local point (gate frame) the hum aims at for a craft at `pos`; null for an object that is no gate to fly through. */
export function gateAimLocal(gate: SonicObject, pos: Vec3): Vec3 | null {
    if (!isOpening(gate)) return null;
    const [x, y, z] = toLocal(gate, pos);
    const o = opening(gate.shape);
    if (z <= 0) {
        // behind: go around the frame on the side the craft is on, out to the approach distance
        const side = x < 0 ? -1 : 1;
        return [side * (o.edge + GATE_AIM_AROUND_M), 0, GATE_AIM_APPROACH_M];
    }
    // close to the plane and in front of the opening: beyond the gate, so the hum stays ahead while the craft passes
    if (z <= GATE_AIM_THROUGH_M && o.inside(x, y)) return [0, 0, -GATE_AIM_PAST_M];
    if (z <= GATE_AIM_THROUGH_M) {
        // close to the plane beside the opening (S2, Tunis g11 and g14: the approach point lay behind the craft, the hum
        // turned 85 to 106 degrees, the craft crossed the plane 0.8 m off the centre: a miss). A point beyond the gate on the
        // axis when the straight way to it crosses the plane well inside the opening; else a point on the axis that keeps
        // the craft off the plane (slide to the axis, or back off a little when very close). Never toward the plane outside.
        const deep = Math.max(z, GATE_AIM_MIN_M);
        const k = (deep / (z + deep)) * GATE_AIM_MARGIN;
        if (o.inside(x * k, y * k)) return [0, 0, -deep];
        return [0, 0, Math.max(z * 0.5, GATE_AIM_MIN_M)];
    }
    const inCone = Math.hypot(x, y) <= Math.max(o.edge * 0.5, GATE_AIM_CONE * z);
    // the approach point is never behind the craft (it was 3 m out for a craft 2 to 3 m out)
    return inCone ? [0, 0, 0] : [0, 0, Math.min(GATE_AIM_APPROACH_M, Math.max(z * 0.5, GATE_AIM_MIN_M))];
}

/** The gate as the hum's target, moved to its aim point (same id, so the planner's on-course state follows the gate). */
export function gateAim(gate: SonicObject, pos: Vec3): SonicObject {
    const local = gateAimLocal(gate, pos);
    if (local === null) return gate;
    const w = quatRotate(gate.quat, local);
    return { ...gate, pos: [gate.pos[0] + w[0], gate.pos[1] + w[1], gate.pos[2] + w[2]] };
}
