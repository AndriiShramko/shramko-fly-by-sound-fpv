// The brake cue (simulator lane sonic4, Design 4; built in lane sonic5): at speed the failing manoeuvre is a turn begun too
// fast, so when the hum is far aside of the travel and nearer than the turn radius plus a lead in seconds, the speed layer
// says "slow" with a falling tone. It asks for a slower approach, not a later turn. A sound only: no spoken line.
import type { Vec3 } from '../contract';
import { TIER_EDGES_MPS } from './budget';

/** the hum is aside when it is more than this far off the travel, degrees (estimate) */
export const BRAKE_ASIDE_DEG = 45;
/** the lead added to the turn radius, seconds of travel (estimate) */
export const BRAKE_LEAD_S = 1;
/** the turn rate the radius is reckoned with, deg/s (estimate; the ear pilot's TURN_DPS in pilot/ear-pilot.ts) */
export const BRAKE_TURN_DPS = 120;
/** under this speed no brake cue: the speed budget's first tier edge (cues/budget.ts, measured in lane sonic4) */
export const BRAKE_MIN_MPS = TIER_EDGES_MPS[0];

const DEG = Math.PI / 180;
const COS_ASIDE = Math.cos(BRAKE_ASIDE_DEG * DEG);

/** The distance under which a hum aside asks to brake, m: the turn radius at `speedMps` plus BRAKE_LEAD_S of travel. */
export function brakeRangeM(speedMps: number): number {
    return speedMps / (BRAKE_TURN_DPS * DEG) + BRAKE_LEAD_S * speedMps;
}

/**
 * True when the craft should slow down: it flies at BRAKE_MIN_MPS or faster, the hum (`toTarget`, world, from the craft)
 * is more than BRAKE_ASIDE_DEG off the travel in the horizontal plane, and nearer than brakeRangeM.
 */
export function brakeNeeded(toTarget: Vec3, vel: Vec3): boolean {
    const vx = vel[0];
    const vz = vel[2];
    const v = Math.sqrt(vx * vx + vz * vz);
    if (v < BRAKE_MIN_MPS) return false;
    const tx = toTarget[0];
    const tz = toTarget[2];
    const d = Math.sqrt(tx * tx + tz * tz);
    if (d < 1e-6 || d > brakeRangeM(v)) return false;
    return (vx * tx + vz * tz) / (v * d) < COS_ASIDE;
}
