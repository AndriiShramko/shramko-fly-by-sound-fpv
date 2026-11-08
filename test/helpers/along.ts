// Where a point lies along a world's track (lane s13-worlds, review M1, M2): the arc length, from the
// track's first checkpoint, of the point of the track's polyline nearest to it. A count, an obstacle or a
// corner is "before" or "past" another by this measure.
import type { Vec3, WorldCheckpoint } from '../../src/contract';

/** The length of the track's polyline, m. */
export function trackLength(list: readonly WorldCheckpoint[]): number {
    let length = 0;
    for (let i = 1; i < list.length; i++) length += Math.hypot(list[i]!.pos[0] - list[i - 1]!.pos[0], list[i]!.pos[1] - list[i - 1]!.pos[1], list[i]!.pos[2] - list[i - 1]!.pos[2]);
    return length;
}

/** How far along the track the point of it nearest to `p` lies, m. */
export function alongTrack(list: readonly WorldCheckpoint[], p: Vec3): number {
    let best = Infinity;
    let at = 0;
    let acc = 0;
    for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!.pos, b = list[i]!.pos;
        const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        const l = Math.sqrt(l2);
        const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
        const dist = Math.hypot(p[0] - (a[0] + d[0] * t), p[1] - (a[1] + d[1] * t), p[2] - (a[2] + d[2] * t));
        if (dist < best - 1e-12) {
            best = dist;
            at = acc + t * l;
        }
        acc += l;
    }
    return at;
}
