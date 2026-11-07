// Signed distance functions of the lesson-world primitives, each in its own local frame, in
// metres. Negative inside the solid, positive outside, and never larger in magnitude than the
// true distance, so sphere tracing can step by the value without passing through a surface.
// Plain scalars in and out: these run thousands of times per frame.

/** A box centred on the origin with half extents (hx, hy, hz). Exact. */
export function sdBox(px: number, py: number, pz: number, hx: number, hy: number, hz: number): number {
    const qx = Math.abs(px) - hx;
    const qy = Math.abs(py) - hy;
    const qz = Math.abs(pz) - hz;
    const ox = qx > 0 ? qx : 0;
    const oy = qy > 0 ? qy : 0;
    const oz = qz > 0 ? qz : 0;
    const inside = Math.min(Math.max(qx, qy, qz), 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + inside;
}

/** A vertical cylinder (axis +Y) centred on the origin, radius r, half height hh. Exact. */
export function sdCylinderY(px: number, py: number, pz: number, r: number, hh: number): number {
    const dx = Math.hypot(px, pz) - r;
    const dy = Math.abs(py) - hh;
    const ox = dx > 0 ? dx : 0;
    const oy = dy > 0 ? dy : 0;
    return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy);
}

/** A torus whose axis is local Z (the opening faces Z): ring radius R, tube radius r. Exact. */
export function sdTorusZ(px: number, py: number, pz: number, R: number, r: number): number {
    const q = Math.hypot(px, py) - R;
    return Math.hypot(q, pz) - r;
}

/**
 * A square frame in the local XY plane: a clear opening of half side `a`, four bars of cross
 * section b x b around it (outer half side a + b), centred on the origin. The two bars on the
 * +Y side and the +X side stand for all four (the other two are their mirror images); each box
 * is centred on the axis it spans, so no artificial boundary is left inside the material. Exact.
 */
export function sdSquareFrame(px: number, py: number, pz: number, a: number, b: number): number {
    const h = b / 2;
    const top = sdBox(px, Math.abs(py) - (a + h), pz, a + b, h, h); // bars along X, at y = +-(a + h)
    const side = sdBox(Math.abs(px) - (a + h), py, pz, h, a, h); // bars along Y, at x = +-(a + h)
    return Math.min(top, side);
}

/**
 * A cube frame: the twelve edges of a cube whose faces are open. Clear opening of half side `a`
 * on every face, bars b x b, outer half side a + b. Three bars stand for the twelve (mirror
 * images in the other octants); each box is centred on its own axis. Exact.
 */
export function sdCubeFrame(px: number, py: number, pz: number, a: number, b: number): number {
    const h = b / 2;
    const c = a + h;
    const l = a + b;
    const alongX = sdBox(px, Math.abs(py) - c, Math.abs(pz) - c, l, h, h);
    const alongY = sdBox(Math.abs(px) - c, py, Math.abs(pz) - c, h, l, h);
    const alongZ = sdBox(Math.abs(px) - c, Math.abs(py) - c, pz, h, h, l);
    return Math.min(alongX, alongY, alongZ);
}
