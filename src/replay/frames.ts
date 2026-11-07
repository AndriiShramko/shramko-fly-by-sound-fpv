// From a recorded frame back to what the engine and the lesson runner were fed: a FlightSample.
// A frame (flight.jsonl.gz, 30 Hz) keeps time, position, velocity, attitude and sticks; the angles
// are worked out again from the quaternion with the simulator's own formulas (sim-core attitude()),
// the body rate from the change of attitude between two frames.
import type { FlightFrame, FlightSample, Quat } from '../contract';

const RAD2DEG = 180 / Math.PI;

/** yaw, pitch and roll in degrees of a body-to-world quaternion [w, x, y, z], as the simulator reports them. */
export function attitudeFromQuat(q: Quat): { readonly yawDeg: number; readonly pitchDeg: number; readonly rollDeg: number } {
    const [qw, qx, qy, qz] = q;
    // body axes in the world: right (r00, r10, r20), up (r01, r11, r21), back (r02, r12, r22)
    const r10 = 2 * (qx * qy + qw * qz);
    const r11 = 1 - 2 * (qx * qx + qz * qz);
    const r02 = 2 * (qx * qz + qw * qy);
    const r12 = 2 * (qy * qz - qw * qx);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    return {
        // heading of the nose on the ground, right turn positive, 0 along -Z
        yawDeg: Math.atan2(-r02, r22) * RAD2DEG,
        // nose below the horizon is positive
        pitchDeg: Math.atan2(r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD2DEG,
        // right side below the horizon is positive
        rollDeg: Math.atan2(-r10, r11) * RAD2DEG
    };
}

const normalized = (q: Quat): Quat => {
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    return l === 0 ? [1, 0, 0, 0] : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

/** Body angular rate, rad/s, from the attitude at two frames (small-angle form; zero without a previous frame). */
function bodyRate(prev: FlightFrame | null, q: Quat, t: number): readonly [number, number, number] {
    if (prev === null) return [0, 0, 0];
    const dt = (t - prev.t) / 1000;
    if (!(dt > 0)) return [0, 0, 0];
    const p = normalized(prev.q);
    // relative rotation conj(prev) * q: body at the previous frame to body now
    const w = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3];
    const x = p[0] * q[1] - p[1] * q[0] - p[2] * q[3] + p[3] * q[2];
    const y = p[0] * q[2] + p[1] * q[3] - p[2] * q[0] - p[3] * q[1];
    const z = p[0] * q[3] - p[1] * q[2] + p[2] * q[1] - p[3] * q[0];
    const s = w < 0 ? -2 / dt : 2 / dt;
    return [x * s, y * s, z * s];
}

export interface SampleOptions {
    /** a contact began since the previous sample (the replay takes it from the recorded touch events) */
    readonly touched?: boolean;
    /** default true: a session is only recorded while armed lessons fly */
    readonly armed?: boolean;
}

/**
 * The FlightSample a recorded frame stands for. `prev` is the frame before it (or null for the
 * first); when the model's tick stood still while the clock ran on, the flight was paused.
 */
export function frameToSample(frame: FlightFrame, prev: FlightFrame | null, options: SampleOptions = {}): FlightSample {
    const quat = normalized(frame.q);
    const a = attitudeFromQuat(quat);
    return {
        t: frame.t,
        tick: frame.tick,
        pos: frame.p,
        vel: frame.v,
        quat,
        rate: bodyRate(prev, quat, frame.t),
        yawDeg: a.yawDeg,
        pitchDeg: a.pitchDeg,
        rollDeg: a.rollDeg,
        sticks: frame.s,
        armed: options.armed ?? true,
        touched: options.touched ?? false,
        paused: prev !== null && frame.tick === prev.tick && frame.t > prev.t
    };
}
