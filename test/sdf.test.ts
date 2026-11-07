import { describe, expect, it } from 'vitest';
import { createRng } from '../src';
import { sdBox, sdCubeFrame, sdCylinderY, sdSquareFrame, sdTorusZ } from '../src/world/sdf';

const close = (a: number, b: number, tol = 1e-9): void => {
    expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol);
};

describe('closed forms', () => {
    it('box', () => {
        close(sdBox(0, 0, 0, 1, 2, 3), -1); // centre: the nearest face is 1 away
        close(sdBox(3, 0, 0, 1, 2, 3), 2); // 2 outside the +X face
        close(sdBox(0, 5, 0, 1, 2, 3), 3);
        close(sdBox(2, 4, 0, 1, 2, 3), Math.hypot(1, 2)); // beyond an edge
        close(sdBox(2, 4, 6, 1, 2, 3), Math.hypot(1, 2, 3)); // beyond a corner
        close(sdBox(1, 0, 0, 1, 2, 3), 0); // on a face
    });

    it('vertical cylinder', () => {
        close(sdCylinderY(0, 0, 0, 0.5, 2), -0.5);
        close(sdCylinderY(2.5, 0, 0, 0.5, 2), 2);
        close(sdCylinderY(0, 5, 0, 0.5, 2), 3);
        close(sdCylinderY(1.5, 4, 0, 0.5, 2), Math.hypot(1, 2)); // beyond the rim
        close(sdCylinderY(0.3, 0, 0.4, 0.5, 2), 0); // on the side: hypot(0.3, 0.4) = 0.5
    });

    it('torus with its axis along Z', () => {
        close(sdTorusZ(1.6, 0, 0, 1.6, 0.1), -0.1); // on the centre line of the tube
        close(sdTorusZ(0, 0, 0, 1.6, 0.1), 1.5); // the middle of the opening is R - r from the tube
        close(sdTorusZ(1.6, 0, 1, 1.6, 0.1), 0.9); // 1 m in front of the tube
        close(sdTorusZ(0, 1.6, 0.1, 1.6, 0.1), 0); // on the surface, at the front
    });

    it('square frame: opening half side 1.5, bar 0.15', () => {
        close(sdSquareFrame(0, 0, 0, 1.5, 0.15), 1.5); // the middle of the opening: the bars are 1.5 away
        close(sdSquareFrame(0, 1.575, 0, 1.5, 0.15), -0.075); // inside the top bar, mid thickness
        close(sdSquareFrame(0, 1.575, 1, 1.5, 0.15), 1 - 0.075); // in front of it
        close(sdSquareFrame(1.575, 0, 0, 1.5, 0.15), -0.075); // inside a side bar
        close(sdSquareFrame(0, 1.5, 0.075, 1.5, 0.15), 0); // on the inner edge of the top bar, on its front face
        close(sdSquareFrame(0, 3, 0, 1.5, 0.15), 3 - 1.65); // above the frame
    });

    it('cube frame: opening half side 1.5, bar 0.15', () => {
        close(sdCubeFrame(0, 0, 0, 1.5, 0.15), Math.hypot(1.5, 1.5)); // the centre is as far as the inner corner of an edge bar
        close(sdCubeFrame(1.575, 1.575, 0, 1.5, 0.15), -0.075); // inside an edge bar along Z, mid thickness
        close(sdCubeFrame(1.575, 1.575, 1.65, 1.5, 0.15), 0); // the end face of that bar
        close(sdCubeFrame(0, 0, 2.65, 1.5, 0.15), Math.hypot(1.5, 1)); // 1 m in front of the front plane, in the middle of the opening
        close(sdCubeFrame(0, 0, -2.65, 1.5, 0.15), Math.hypot(1.5, 1)); // and behind it
        close(sdCubeFrame(0, 1.575, 1.575, 1.5, 0.15), -0.075); // inside an edge bar along X, on the plane x = 0
    });
});

describe('frames equal the union of their bars without folding', () => {
    // the explicit bars, as (centre, half extents), with no symmetry used
    function squareBars(a: number, b: number): [number, number, number, number, number, number][] {
        const h = b / 2;
        return [
            [0, a + h, 0, a + b, h, h],
            [0, -(a + h), 0, a + b, h, h],
            [a + h, 0, 0, h, a, h],
            [-(a + h), 0, 0, h, a, h]
        ];
    }
    function cubeBars(a: number, b: number): [number, number, number, number, number, number][] {
        const h = b / 2, c = a + h, half = a + b;
        const bars: [number, number, number, number, number, number][] = [];
        for (const sy of [-1, 1]) for (const sz of [-1, 1]) bars.push([0, sy * c, sz * c, half, h, h]);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) bars.push([sx * c, 0, sz * c, h, half, h]);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) bars.push([sx * c, sy * c, 0, h, h, half]);
        return bars;
    }
    const unionOf = (bars: [number, number, number, number, number, number][], x: number, y: number, z: number): number =>
        Math.min(...bars.map(([cx, cy, cz, hx, hy, hz]) => sdBox(x - cx, y - cy, z - cz, hx, hy, hz)));

    // points near and inside the material, where a folding mistake would show, and far points
    it('square frame, 10000 random points, half of them in the frame', () => {
        const rng = createRng(11);
        const a = 1.5, b = 0.15;
        const bars = squareBars(a, b);
        for (let i = 0; i < 10000; i++) {
            const near = i % 2 === 0;
            const x = near ? rng.range(-1.7, 1.7) : rng.range(-3, 3);
            const y = near ? rng.range(-1.7, 1.7) : rng.range(-3, 3);
            const z = near ? rng.range(-0.2, 0.2) : rng.range(-2, 2);
            close(sdSquareFrame(x, y, z, a, b), unionOf(bars, x, y, z), 1e-12);
        }
    });

    it('cube frame, 20000 random points, half of them near the edges', () => {
        const rng = createRng(12);
        const a = 1.5, b = 0.15;
        const bars = cubeBars(a, b);
        for (let i = 0; i < 20000; i++) {
            const near = i % 2 === 0;
            const pick = (): number => {
                if (!near) return rng.range(-3, 3);
                // within a bar's cross section or along its length
                return rng.next() < 0.5 ? rng.sign() * rng.range(1.5, 1.65) : rng.range(-1.7, 1.7);
            };
            const x = pick(), y = pick(), z = pick();
            close(sdCubeFrame(x, y, z, a, b), unionOf(bars, x, y, z), 1e-12);
        }
    });

    it('the comparison can fail (negative control: a wrong bar length is caught)', () => {
        const rng = createRng(13);
        const a = 1.5, b = 0.15;
        const wrong = squareBars(a, b).map(([cx, cy, cz, hx, hy, hz]): [number, number, number, number, number, number] => [cx, cy, cz, hx * 0.9, hy, hz]);
        let worst = 0;
        for (let i = 0; i < 2000; i++) {
            const x = rng.range(-3, 3), y = rng.range(-3, 3), z = rng.range(-2, 2);
            worst = Math.max(worst, Math.abs(sdSquareFrame(x, y, z, a, b) - unionOf(wrong, x, y, z)));
        }
        expect(worst).toBeGreaterThan(1e-3);
    });
});

describe('every primitive is a safe distance bound (1-Lipschitz), which sphere tracing relies on', () => {
    type Fn = (x: number, y: number, z: number) => number;
    const prims: [string, Fn][] = [
        ['box', (x, y, z) => sdBox(x, y, z, 1, 2, 3)],
        ['cylinder', (x, y, z) => sdCylinderY(x, y, z, 0.5, 2)],
        ['torus', (x, y, z) => sdTorusZ(x, y, z, 1.6, 0.1)],
        ['square frame', (x, y, z) => sdSquareFrame(x, y, z, 1.5, 0.15)],
        ['cube frame', (x, y, z) => sdCubeFrame(x, y, z, 1.5, 0.15)]
    ];

    /** the largest |f(p) - f(q)| / |p - q| over random pairs */
    function lipschitz(f: Fn, seed: number): number {
        const rng = createRng(seed);
        let worst = 0;
        for (let i = 0; i < 20000; i++) {
            const p: [number, number, number] = [rng.range(-4, 4), rng.range(-4, 4), rng.range(-4, 4)];
            const q: [number, number, number] = [p[0] + rng.range(-0.3, 0.3), p[1] + rng.range(-0.3, 0.3), p[2] + rng.range(-0.3, 0.3)];
            const dist = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
            if (dist > 1e-6) worst = Math.max(worst, Math.abs(f(...p) - f(...q)) / dist);
        }
        return worst;
    }

    it.each(prims)('%s', (_name, f) => {
        expect(lipschitz(f, 21)).toBeLessThanOrEqual(1 + 1e-9);
    });

    it('a field that overstates distance is caught (negative control)', () => {
        expect(lipschitz((x, y, z) => 2 * sdBox(x, y, z, 1, 2, 3), 22)).toBeGreaterThan(1.5);
    });
});
