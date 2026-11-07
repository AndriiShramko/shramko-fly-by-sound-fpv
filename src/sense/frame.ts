// The listener frame and the ten sectors of the scene sample (spec section 2; contract SECTORS).
//
// The listener frame has Web Audio's default axes: x right, y up, z back, so the front is -Z. In
// the 'heading' frame (the default) it is the world turned to face the way the craft's nose points
// with the tilt ignored: yaw 0 faces -Z, positive yaw turns right, so the front is
// (sin yaw, 0, -cos yaw) in the world. In the 'body' frame it is the craft's own attitude.
import type { FlightSample, Quat, SectorId, Vec3 } from '../contract';
import { SECTORS } from '../contract';
import { DEG, dot, normalize, quatRotate } from '../util/vec';
import type { ListenerFrame } from './types';

/** The listener's axes written in world coordinates. */
export interface Basis {
    readonly right: Vec3;
    readonly up: Vec3;
    readonly back: Vec3;
}

export function headingBasis(yawDeg: number): Basis {
    const a = yawDeg * DEG;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { right: [c, 0, s], up: [0, 1, 0], back: [-s, 0, c] };
}

export function bodyBasis(quat: Quat): Basis {
    return { right: quatRotate(quat, [1, 0, 0]), up: quatRotate(quat, [0, 1, 0]), back: quatRotate(quat, [0, 0, 1]) };
}

export function listenerBasis(sample: Pick<FlightSample, 'yawDeg' | 'quat'>, frame: ListenerFrame): Basis {
    return frame === 'body' ? bodyBasis(sample.quat) : headingBasis(sample.yawDeg);
}

/** A vector in the listener frame, in world coordinates. */
export function listenerToWorld(b: Basis, v: Vec3): Vec3 {
    return [
        b.right[0] * v[0] + b.up[0] * v[1] + b.back[0] * v[2],
        b.right[1] * v[0] + b.up[1] * v[1] + b.back[1] * v[2],
        b.right[2] * v[0] + b.up[2] * v[1] + b.back[2] * v[2]
    ];
}

/** A world vector in the listener frame. */
export function worldToListener(b: Basis, w: Vec3): Vec3 {
    return [dot(w, b.right), dot(w, b.up), dot(w, b.back)];
}

const S = Math.SQRT1_2;

/** The direction each sector looks along, in the listener frame (unit vectors). */
export const SECTOR_AXES: Readonly<Record<SectorId, Vec3>> = {
    front: [0, 0, -1],
    back: [0, 0, 1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    up: [0, 1, 0],
    down: [0, -1, 0],
    'front-left': [-S, 0, -S],
    'front-right': [S, 0, -S],
    'front-up': [0, S, -S],
    'front-down': [0, -S, -S]
};

/** The unit vector, perpendicular to a sector's axis, along which its two side rays are spread. */
export const SECTOR_LATERAL: Readonly<Record<SectorId, Vec3>> = {
    front: [1, 0, 0],
    back: [1, 0, 0],
    left: [0, 0, -1],
    right: [0, 0, -1],
    up: [0, 0, -1],
    down: [0, 0, -1],
    'front-left': [S, 0, -S],
    'front-right': [S, 0, S],
    'front-up': [1, 0, 0],
    'front-down': [1, 0, 0]
};

export type SectorRays = readonly [Vec3, Vec3, Vec3];

/** The three rays of every sector in the listener frame: the axis, and two turned `spreadDeg` to either side of it. */
export function sectorRays(spreadDeg: number): Readonly<Record<SectorId, SectorRays>> {
    const c = Math.cos(spreadDeg * DEG);
    const s = Math.sin(spreadDeg * DEG);
    const out = {} as Record<SectorId, SectorRays>;
    for (const id of SECTORS) {
        const a = SECTOR_AXES[id];
        const l = SECTOR_LATERAL[id];
        out[id] = [
            a,
            normalize([a[0] * c + l[0] * s, a[1] * c + l[1] * s, a[2] * c + l[2] * s]),
            normalize([a[0] * c - l[0] * s, a[1] * c - l[1] * s, a[2] * c - l[2] * s])
        ];
    }
    return out;
}
