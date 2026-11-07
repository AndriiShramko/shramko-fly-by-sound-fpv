// From the scan frame to the flown world. A scan is flown through its scene transform
// T(p) = s * p + t (uniform scale s > 0, no rotation); track files are written in the scan frame,
// so a course stays on the walls however the scene is scaled afterwards.
import type { ObjectShape, SceneTransform, SonicObject, TrackFile, Vec3 } from '../contract';

/** A point of the scan frame in the flown world. */
export function scanToFlown(transform: SceneTransform, p: Vec3): Vec3 {
    const [s, tx, ty, tz] = transform;
    return [s * p[0] + tx, s * p[1] + ty, s * p[2] + tz];
}

/** A point of the flown world in the scan frame. */
export function flownToScan(transform: SceneTransform, p: Vec3): Vec3 {
    const [s, tx, ty, tz] = transform;
    return [(p[0] - tx) / s, (p[1] - ty) / s, (p[2] - tz) / s];
}

/** A length of the scan frame in the flown world. */
export function scanLengthToFlown(transform: SceneTransform, metres: number): number {
    return transform[0] * metres;
}

/** The shape with every size of the scan frame turned into flown metres. */
export function shapeToFlown(shape: ObjectShape, transform: SceneTransform): ObjectShape {
    const s = transform[0];
    switch (shape.kind) {
        case 'ring':
            return { kind: 'ring', diameter: shape.diameter * s, tube: shape.tube * s };
        case 'square':
            return { kind: 'square', side: shape.side * s, bar: shape.bar * s };
        case 'cube-frame':
            return { kind: 'cube-frame', side: shape.side * s, bar: shape.bar * s };
        case 'pillar':
            return { kind: 'pillar', radius: shape.radius * s, height: shape.height * s };
        case 'box':
            return { kind: 'box', size: [shape.size[0] * s, shape.size[1] * s, shape.size[2] * s] };
        case 'zone':
            return { kind: 'zone', size: [shape.size[0] * s, shape.size[1] * s, shape.size[2] * s] };
    }
}

export interface FlownOptions {
    /** the transform the scan is flown through now; default: the one the track was laid out for */
    readonly transform?: SceneTransform;
    /**
     * the craft collides with the gates. False by default: in a scan the collider is the scan's own
     * walls, and a track gate is a thing to fly through, not a wall.
     */
    readonly solid?: boolean;
}

/** The gates of a track as SonicObjects of the flown world, in course order (order 0, 1, 2, ...). */
export function trackToObjects(track: TrackFile, options: FlownOptions = {}): SonicObject[] {
    const transform = options.transform ?? track.transform;
    return track.gates.map((g, i) => ({
        id: g.id,
        shape: shapeToFlown(g.shape, transform),
        pos: scanToFlown(transform, g.pos),
        quat: g.quat,
        order: i,
        solid: options.solid ?? false,
        material: 'obstacle'
    }));
}
