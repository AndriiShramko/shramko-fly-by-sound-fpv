// A kinematic craft for the ear pilot (sonic3 plan section 4): velocity control within caps, as the simulator's
// velocity assist flies. The acceleration and the turn cap are estimates; the speed cap is the ladder's rung.
import type { FlightSample, Pose, Vec3 } from '../contract';
import { yawQuat } from '../util/vec';
import type { StickCommand } from './ear-pilot';

export interface CraftCaps {
    readonly speedMps: number;
    readonly climbMps: number;
    readonly yawDps: number;
    /** m/s per second (estimate) */
    readonly accelMps2: number;
}

export const CRAFT_ACCEL_MPS2 = 8;
export const CRAFT_YAW_DPS = 180;
export const CRAFT_CLIMB_MPS = 3;

const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export class Craft {
    pos: Vec3;
    vel: Vec3 = [0, 0, 0];
    yaw: number;

    constructor(
        start: Pose,
        readonly caps: CraftCaps
    ) {
        this.pos = start.pos;
        this.yaw = start.yawDeg;
    }

    place(p: Pose): void {
        this.pos = p.pos;
        this.yaw = p.yawDeg;
        this.vel = [0, 0, 0];
    }

    step(c: StickCommand, dtS: number): void {
        const c0 = this.caps;
        const yawRate = Math.max(-c0.yawDps, Math.min(c0.yawDps, c.yawDps));
        this.yaw = wrap(this.yaw + yawRate * dtS);
        const a = (this.yaw * Math.PI) / 180;
        const fwd: Vec3 = [Math.sin(a), 0, -Math.cos(a)];
        const right: Vec3 = [Math.cos(a), 0, Math.sin(a)];
        let wx = fwd[0] * c.forwardMps + right[0] * c.lateralMps;
        let wz = fwd[2] * c.forwardMps + right[2] * c.lateralMps;
        const h = Math.hypot(wx, wz);
        if (h > c0.speedMps) {
            wx *= c0.speedMps / h;
            wz *= c0.speedMps / h;
        }
        const wy = Math.max(-c0.climbMps, Math.min(c0.climbMps, c.climbMps));
        const want: Vec3 = [wx, wy, wz];
        const d: Vec3 = [want[0] - this.vel[0], want[1] - this.vel[1], want[2] - this.vel[2]];
        const dl = Math.hypot(d[0], d[1], d[2]);
        const maxDv = c0.accelMps2 * dtS;
        const k = dl > maxDv ? maxDv / dl : 1;
        this.vel = [this.vel[0] + d[0] * k, this.vel[1] + d[1] * k, this.vel[2] + d[2] * k];
        this.pos = [this.pos[0] + this.vel[0] * dtS, this.pos[1] + this.vel[1] * dtS, this.pos[2] + this.vel[2] * dtS];
    }

    sample(t: number, touched: boolean): FlightSample {
        return { t, tick: t, pos: this.pos, vel: this.vel, quat: yawQuat(this.yaw), rate: [0, 0, 0], yawDeg: this.yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched, paused: false };
    }
}
