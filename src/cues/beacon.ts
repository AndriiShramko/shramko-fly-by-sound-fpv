// The beacon (lane sonic-beacon, owner's complaint of 2026-11-10: "in the tunnels we do not understand where to fly; we
// only hear the walls"): the target hum tells the way to the next target. In headphones only left and right are told
// apart reliably, front and behind are not (Chrome's HRTF, docs/design/virtual-listener.md), so the hum's direction is
// folded into the front half circle: up to 90 degrees to a side it comes from its true side, beyond 90 it stays at the
// ear of its side. Nothing the pilot needs depends on hearing "behind". On course the hum is an octave higher.
//
// Pure and DOM-free: the planner and the runner use it, the Node tests check it. Directions are in the listener frame
// (x right, y up, z back: the nose along -Z), unit vectors.
import type { Vec3 } from '../contract';

/**
 * Within this many degrees of the nose, left or right, the target is "on course" and the hum sounds an octave higher.
 * An estimate (the lead's design decision of stage 1, docs/wip/sonic-beacon.md), not measured.
 */
export const ON_COURSE_DEG = 8;
/**
 * A point of a track is a corner when the way turns there by more than this, degrees. An estimate (the lead's design
 * decision of stage 1), not measured.
 */
export const CORNER_DEG = 20;
/**
 * Where the goal has no gate, the beacon points at the next corner of the track or at the first point at least this far
 * ahead, m, whichever comes first. An estimate (the lead's design decision of stage 1), not measured.
 */
export const BEACON_AHEAD_M = 6;

const DEG = 180 / Math.PI;

export interface BeaconBearing {
    /** degrees from the nose, -180 to 180, positive right; 0 when the target is straight above or below */
    readonly azimuthDeg: number;
    /** degrees above the horizon (-90 to 90) */
    readonly elevationDeg: number;
    /** more than 90 degrees from the nose, left or right */
    readonly behind: boolean;
    /** within ON_COURSE_DEG of the nose, left or right (never when the target is straight above or below) */
    readonly onCourse: boolean;
}

/** Where a direction of the listener frame lies from the nose. */
export function beaconBearing(dirL: Vec3): BeaconBearing {
    const [x, y, z] = dirL;
    const h = Math.hypot(x, z);
    const level = h > 1e-9;
    const azimuthDeg = level ? Math.atan2(x, -z) * DEG : 0;
    const elevationDeg = Math.atan2(y, h) * DEG;
    return { azimuthDeg, elevationDeg, behind: Math.abs(azimuthDeg) > 90, onCourse: level && Math.abs(azimuthDeg) <= ON_COURSE_DEG };
}

/**
 * The direction folded into the front half circle: up to 90 degrees from the nose it is returned as it is; beyond, it
 * is turned to 90 degrees on its own side (straight at that ear), its elevation kept. Unit in, unit out.
 */
export function foldToFront(dirL: Vec3): Vec3 {
    const [x, y, z] = dirL;
    if (z <= 0) return dirL;
    const h = Math.hypot(x, z);
    // exactly behind (x = 0): the right ear, so the fold never leaves a direction undecided (the right side is an
    // arbitrary choice; a target exactly behind is held there for no more than a frame in flight)
    const side = x < 0 ? -1 : 1;
    return [side * h, y, 0];
}

/** The angle the way turns at the middle of three points, degrees (0: straight on); 0 when two points coincide. */
export function turnDeg(a: Vec3, b: Vec3, c: Vec3): number {
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const lu = Math.hypot(u[0], u[1], u[2]);
    const lv = Math.hypot(v[0], v[1], v[2]);
    if (lu < 1e-9 || lv < 1e-9) return 0;
    const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv);
    return Math.acos(Math.min(1, Math.max(-1, cos))) * DEG;
}

/** The indices of a track's corners: the inner points where the way turns by more than CORNER_DEG. */
export function trackCorners(points: readonly Vec3[]): number[] {
    const out: number[] = [];
    for (let i = 1; i + 1 < points.length; i++) if (turnDeg(points[i - 1] as Vec3, points[i] as Vec3, points[i + 1] as Vec3) > CORNER_DEG) out.push(i);
    return out;
}

/**
 * The track point the beacon points at, from the next point not yet passed (`next`) and the craft's place: the first
 * point from `next` on that is a corner or at least BEACON_AHEAD_M from the craft, else the last point; null when every
 * point is passed. The track's points are joined by free straight lines (WorldCheckpoint), so up to the next corner the
 * way is straight and the beacon does not call through a wall.
 */
export function beaconPointIndex(points: readonly Vec3[], next: number, pos: Vec3): number | null {
    if (next < 0 || next >= points.length) return null;
    const corners = new Set(trackCorners(points));
    for (let i = next; i < points.length; i++) {
        const p = points[i] as Vec3;
        if (corners.has(i) || Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) >= BEACON_AHEAD_M) return i;
    }
    return points.length - 1;
}
