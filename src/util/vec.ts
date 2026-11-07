// Small vector and quaternion helpers on the contract's tuple types (src/contract.ts conventions:
// +Y up, right-handed, metres; quaternions [w, x, y, z] from body or object to world; yaw 0 is
// the nose along -Z and positive yaw turns right). Allocation per call is fine here: the hot
// loops (sphere tracing, the sampler's rays) use scalar code of their own.
import type { Quat, Vec3 } from '../contract';

export const DEG = Math.PI / 180;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The unit vector, or [0, 0, 0] for a zero vector. */
export function normalize(a: Vec3): Vec3 {
    const l = length(a);
    return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Rounds to micrometres and turns -0 into 0: keeps generated geometry and its JSON stable. */
export function round6(n: number): number {
    const r = Math.round(n * 1e6) / 1e6;
    return r === 0 ? 0 : r;
}

export const IDENTITY_QUAT: Quat = [1, 0, 0, 0];

export function quatConjugate(q: Quat): Quat {
    return [q[0], -q[1], -q[2], -q[3]];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
    return [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
    ];
}

export function quatNormalize(q: Quat): Quat {
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    return l === 0 ? IDENTITY_QUAT : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** The rotation of v by the unit quaternion q (body to world). */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
    const [w, x, y, z] = q;
    // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The rotation by `rad` about the unit `axis`. */
export function quatAxisAngle(axis: Vec3, rad: number): Quat {
    const s = Math.sin(rad / 2);
    return quatNormalize([Math.cos(rad / 2), axis[0] * s, axis[1] * s, axis[2] * s]);
}

/**
 * The orientation of a level craft or gate heading `yawDeg`: its nose, local -Z, points along
 * (sin yaw, 0, -cos yaw), so yaw 90 points along +X (turned right). A gate made with this
 * quaternion is passed 'forward' by flying the way the yaw says.
 */
export function yawQuat(yawDeg: number): Quat {
    return quatAxisAngle([0, 1, 0], -yawDeg * DEG);
}

/** Row-major 3x3 rotation matrix of a unit quaternion (body to world); its transpose is the inverse. */
export function quatMatrix(q: Quat): Float64Array {
    const [w, x, y, z] = q;
    return Float64Array.of(
        1 - 2 * (y * y + z * z),
        2 * (x * y - z * w),
        2 * (x * z + y * w),
        2 * (x * y + z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z - x * w),
        2 * (x * z - y * w),
        2 * (y * z + x * w),
        1 - 2 * (x * x + y * y)
    );
}

/** Rounds to nanounits and turns -0 into 0: for quaternion components. */
export function round9(n: number): number {
    const r = Math.round(n * 1e9) / 1e9;
    return r === 0 ? 0 : r;
}
