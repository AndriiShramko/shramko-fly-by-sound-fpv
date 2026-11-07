// A kinematic point mass for the stand-alone demo: no flight model, no rotors. It stands in for the
// simulator's craft so that modules 0 to 2 (and, in an analytic world, the walls) can be flown with a
// keyboard in a page of its own. Sticks ask a velocity in the heading frame (as the lessons' 'velocity'
// control does): centred sticks brake and hold the height, the speed follows the stick through a
// first-order lag, and the craft slides along what it touches with a soft bump. DOM-free, so Node tests
// cover it.
import type { FlightSample, LessonAssists, Pose, Vec3 } from '../src/contract';
import { yawQuat } from '../src/util/vec';

/** What the keys ask, each in [-1, 1]: right, forward, up, turn right. */
export interface Sticks {
    readonly roll: number;
    readonly pitch: number;
    readonly throttle: number;
    readonly yaw: number;
}

export const NO_STICKS: Sticks = { roll: 0, pitch: 0, throttle: 0, yaw: 0 };

/** What the point mass needs of a world: a signed distance (negative inside). */
export interface SolidWorld {
    sdf(x: number, y: number, z: number): number;
}

export interface PointMassOptions {
    readonly start: Pose;
    /** null: nothing to hit (the ears lessons, or a deliberate control) */
    readonly world: SolidWorld | null;
    readonly assists?: Pick<LessonAssists, 'maxSpeedMps' | 'maxClimbMps' | 'maxYawDps'>;
    /** radius of the hull, m (default 0.12, as the sampler's) */
    readonly radiusM?: number;
}

/** Speed when a lesson sets no cap, m/s; climb rate, m/s; turn rate, degrees per second. */
export const DEFAULT_SPEED_MPS = 8;
export const DEFAULT_CLIMB_MPS = 3;
export const DEFAULT_YAW_DPS = 90;
/** Time constants of the speed's lag, s: following a stick, and braking to a stop. */
export const FOLLOW_TAU_S = 0.25;
export const BRAKE_TAU_S = 0.15;
/**
 * A touch is reported when the craft meets a surface after at least this long out of contact, s (the
 * simulator debounces at 0.5 s of quiet too): pressing against a wall or sliding along it is one touch.
 */
export const TOUCH_DEBOUNCE_S = 0.5;
/** The largest step the integrator takes, s. */
export const MAX_STEP_S = 0.005;

export interface Contact {
    /** speed into the surface, m/s */
    readonly speedMps: number;
    readonly pos: Vec3;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class PointMass {
    pos: Vec3;
    vel: Vec3 = [0, 0, 0];
    yawDeg: number;
    private yawRateDps = 0;
    private readonly world: SolidWorld | null;
    private readonly radius: number;
    private readonly speedCap: number;
    private readonly climbCap: number;
    private readonly yawCap: number;
    private sticksValue: Sticks = NO_STICKS;
    private quietS = Infinity;
    private touchPending: Contact | null = null;
    private timeS = 0;

    constructor(options: PointMassOptions) {
        this.pos = options.start.pos;
        this.yawDeg = options.start.yawDeg;
        this.world = options.world;
        this.radius = options.radiusM ?? 0.12;
        this.speedCap = options.assists?.maxSpeedMps ?? DEFAULT_SPEED_MPS;
        this.climbCap = options.assists?.maxClimbMps ?? DEFAULT_CLIMB_MPS;
        this.yawCap = options.assists?.maxYawDps ?? DEFAULT_YAW_DPS;
    }

    /** Puts the craft at a pose with no speed (a respawn, a checkpoint). */
    place(pose: Pose): void {
        this.pos = pose.pos;
        this.yawDeg = pose.yawDeg;
        this.vel = [0, 0, 0];
        this.yawRateDps = 0;
        this.touchPending = null;
    }

    get speed(): number {
        return Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    }

    get sticks(): Sticks {
        return this.sticksValue;
    }

    /** Advances `dtS` seconds with the sticks held. The contact seen in this step, if one is new. */
    step(dtS: number, sticks: Sticks): void {
        this.sticksValue = sticks;
        let left = Math.max(0, dtS);
        while (left > 1e-9) {
            const h = Math.min(left, MAX_STEP_S);
            this.substep(h, sticks);
            left -= h;
        }
    }

    private substep(h: number, sticks: Sticks): void {
        const clamp = (x: number): number => Math.min(Math.max(x, -1), 1);
        this.yawRateDps = clamp(sticks.yaw) * this.yawCap;
        this.yawDeg = ((((this.yawDeg + this.yawRateDps * h) % 360) + 540) % 360) - 180;
        const a = (this.yawDeg * Math.PI) / 180;
        const fwd: Vec3 = [Math.sin(a), 0, -Math.cos(a)];
        const right: Vec3 = [Math.cos(a), 0, Math.sin(a)];
        const p = clamp(sticks.pitch);
        const r = clamp(sticks.roll);
        let cx = (fwd[0] * p + right[0] * r) * this.speedCap;
        const cy = clamp(sticks.throttle) * this.climbCap;
        let cz = (fwd[2] * p + right[2] * r) * this.speedCap;
        // diagonal keys do not go faster than the cap
        const flat = Math.hypot(cx, cz);
        if (flat > this.speedCap) {
            cx *= this.speedCap / flat;
            cz *= this.speedCap / flat;
        }
        const wanted = Math.hypot(cx, cy, cz);
        const tau = wanted < 1e-6 ? BRAKE_TAU_S : FOLLOW_TAU_S;
        const k = 1 - Math.exp(-h / tau);
        this.vel = [this.vel[0] + (cx - this.vel[0]) * k, this.vel[1] + (cy - this.vel[1]) * k, this.vel[2] + (cz - this.vel[2]) * k];
        this.pos = [this.pos[0] + this.vel[0] * h, this.pos[1] + this.vel[1] * h, this.pos[2] + this.vel[2] * h];
        this.timeS += h;
        this.quietS += h;
        this.collide();
    }

    private collide(): void {
        const w = this.world;
        if (w === null) return;
        const [x, y, z] = this.pos;
        const d = w.sdf(x, y, z);
        if (d >= this.radius) return;
        const quiet = this.quietS;
        this.quietS = 0;
        // the surface normal: the gradient of the distance field
        const e = 0.02;
        const g: Vec3 = [w.sdf(x + e, y, z) - w.sdf(x - e, y, z), w.sdf(x, y + e, z) - w.sdf(x, y - e, z), w.sdf(x, y, z + e) - w.sdf(x, y, z - e)];
        const len = Math.hypot(g[0], g[1], g[2]);
        if (len < 1e-9) return;
        const n: Vec3 = [g[0] / len, g[1] / len, g[2] / len];
        const push = this.radius - d;
        this.pos = [x + n[0] * push, y + n[1] * push, z + n[2] * push];
        const vn = dot(this.vel, n);
        if (vn < 0) {
            // a soft bump: the speed into the surface is lost, the rest slides along it
            this.vel = [this.vel[0] - n[0] * vn, this.vel[1] - n[1] * vn, this.vel[2] - n[2] * vn];
            if (quiet >= TOUCH_DEBOUNCE_S && -vn > 0.15) this.touchPending = { speedMps: -vn, pos: this.pos };
        }
    }

    /**
     * The sample of this moment for the lesson runner and the engine (contract FlightSample). A touch
     * is reported once, in the first sample after it began.
     */
    sample(tMs: number, tick: number): FlightSample {
        const touched = this.touchPending !== null;
        this.touchPending = null;
        return {
            t: tMs,
            tick,
            pos: this.pos,
            vel: this.vel,
            quat: yawQuat(this.yawDeg),
            rate: [0, (-this.yawRateDps * Math.PI) / 180, 0],
            yawDeg: this.yawDeg,
            pitchDeg: 0,
            rollDeg: 0,
            sticks: [this.sticksValue.roll, this.sticksValue.pitch, this.sticksValue.throttle, this.sticksValue.yaw],
            armed: true,
            touched,
            paused: false
        };
    }

    /** Seconds flown (the integrator's own clock). */
    get elapsedS(): number {
        return this.timeS;
    }
}
