// What every generator version builds, and the small helpers they share. Frames: world, metres, +Y
// up, floor at y = 0, nose along -Z at yaw 0.
import type { Pose, SonicObject, Vec3 } from '../contract';
import { round6, round9, yawQuat } from '../util/vec';
import type { Box, Part } from './parts';
import { WorldSpecError, type ResolvedParams } from './params';
import type { TrackNode } from './track';

/** Thickness of the solid around a hollow that the collider is built over, metres. */
export const SHELL_THICKNESS_M = 1;

export interface Landmark {
    readonly id: string;
    readonly pos: Vec3;
}

export interface Built {
    /** everything solid that is not an object: floor, walls, ceiling, the corridor's hollow */
    readonly shell: Part;
    readonly objects: SonicObject[];
    readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
    readonly landmarks: Landmark[];
    readonly start: Pose;
    /** the track's nodes (src/world/track.ts), for a world with a track the builder lays out itself (a corridor) */
    readonly track?: readonly TrackNode[];
}

export const n = (p: ResolvedParams, name: string): number => p[name] as number;
export const s = (p: ResolvedParams, name: string): string => p[name] as string;

export function hollowBounds(boxes: readonly Box[]): { min: Vec3; max: Vec3 } {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of boxes) {
        minX = Math.min(minX, b.cx - b.hx); maxX = Math.max(maxX, b.cx + b.hx);
        minY = Math.min(minY, b.cy - b.hy); maxY = Math.max(maxY, b.cy + b.hy);
        minZ = Math.min(minZ, b.cz - b.hz); maxZ = Math.max(maxZ, b.cz + b.hz);
    }
    const t = SHELL_THICKNESS_M;
    return { min: [round6(minX - t), round6(minY - t), round6(minZ - t)], max: [round6(maxX + t), round6(maxY + t), round6(maxZ + t)] };
}

export function hallBox(w: number, d: number, h: number): Box {
    return { cx: 0, cy: h / 2, cz: 0, hx: w / 2, hy: h / 2, hz: d / 2 };
}

export function requireInside(what: string, startHeight: number, h: number): void {
    if (startHeight > h - 0.5) throw new WorldSpecError(`${what}: the start height ${startHeight} is too close to the ceiling at ${h}`);
}

export function object(id: string, shape: SonicObject['shape'], pos: Vec3, yawDeg: number, order: number | null, solid: boolean, material: SonicObject['material']): SonicObject {
    const q = yawQuat(yawDeg);
    return {
        id,
        shape,
        pos: [round6(pos[0]), round6(pos[1]), round6(pos[2])],
        quat: [round9(q[0]), round9(q[1]), round9(q[2]), round9(q[3])],
        order,
        solid,
        material
    };
}
