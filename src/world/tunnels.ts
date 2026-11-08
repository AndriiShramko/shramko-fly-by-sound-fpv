// Version 2 of the corridor: the tunnels of v0.13 (owner's message 41, M41-21: "wide, narrow, narrower,
// with obstacles that leave one way free, and one very long tunnel in stages, each harder than the last").
// Version 1 (src/world/v1.ts) stays as v0.12 shipped it; the corridor lesson flies it.
//
// A tunnel is walked like version 1's corridor: straight runs, each a box `widthM` wide and `heightM` high
// that reaches half its width past both ends (two runs meet in a full corner square), 90 degree bends that
// turn right and left in turn, so the tunnel zigzags forward and never doubles back. Layouts:
//   tunnel  a straight of `straightM`, `bendCount` bends with legs of `segmentM`, a last straight of `endM`
//   gaps    a straight, then one obstacle per side of `gaps` (up, down, left, right: the side left free), each
//           in the middle of a run of `obstacleRunM`, then the last straight
//   long    stages: stage k is `stageWidths[k]` wide, has an entry straight of `segmentM`, `stageBends[k]`
//           bends and `stageGaps[k]` obstacles (their free sides from `gaps`, in turn); its last run ends
//           the stage (the checkpoint there carries `stage: k + 1`)
// An obstacle is a box (contract ObjectShape 'box', axis-aligned, which the simulator draws) that fills
// the tunnel's cross section but for a free way `gapM` across: above it (up), under it (down), or beside it
// (left, right of the tunnel's heading). It reaches 5 cm into the walls, floor or ceiling it stands on, so
// no face of it lies on a face of the room, and at least OBSTACLE_COVER_M past the middle of the tunnel at
// flying height, so a craft flying the middle meets it (a wider free way is refused). The track
// (src/world/track.ts) passes it through the free way.
import type { SonicObject, Vec3 } from '../contract';
import { round6 } from '../util/vec';
import { hollowBounds, n, object, requireInside, s, type Built, type Landmark } from './build';
import { list, names, num, oneOf, WorldSpecError, type ResolvedParams, type Schema } from './params';
import { cavityShell, type Box } from './parts';
import { APPROACH_M, corridorNodes, type Dodge, type Run } from './track';

/** The sides an obstacle can leave free: the vocabulary of the 'gaps' parameter (named for obstacles, so no other module's export in src/index.ts clashes with it). */
export const OBSTACLE_FREE_SIDES = ['up', 'down', 'left', 'right'] as const;
export type ObstacleFreeSide = (typeof OBSTACLE_FREE_SIDES)[number];
/** How far an obstacle reaches into the surfaces it stands on, metres. */
export const OBSTACLE_EMBED_M = 0.05;
/** An obstacle is at least this thick across the tunnel, metres (a thinner one is no obstacle). */
export const OBSTACLE_MIN_M = 0.5;
/**
 * An obstacle reaches at least this far past the tunnel's centre line at flying height, metres (review M9):
 * a craft flying the middle of the tunnel meets it and must move to its free way, so the open-way chime
 * (which listens straight ahead of the nose) hears it. A free way wider than half the tunnel less this
 * would leave the middle open.
 */
export const OBSTACLE_COVER_M = 0.2;

/**
 * How far an obstacle that leaves `side` free reaches past the tunnel's centre line at flying height `y0`,
 * metres (negative: it stops short of the line). Beside: half the width less the free way; above: the
 * block's top less the flying height; below: the flying height less the block's underside.
 */
export function obstacleCoverM(side: ObstacleFreeSide, gapM: number, widthM: number, heightM: number, y0: number): number {
    switch (side) {
        case 'up':
            return heightM - gapM - y0;
        case 'down':
            return y0 - gapM;
        case 'left':
        case 'right':
            return widthM / 2 - gapM;
    }
}

export const TUNNEL_SCHEMA: Schema = {
    voxelM: num(0.1, 0.02, 0.5),
    widthM: num(2, 0.8, 30),
    heightM: num(2.4, 1, 30),
    startHeightM: num(1.2, 0.2, 29),
    layout: oneOf('tunnel', 'tunnel', 'gaps', 'long'),
    straightM: num(6, 1, 400),
    segmentM: num(5, 2, 80),
    bendCount: num(2, 0, 40, true),
    endM: num(5, 1, 400),
    gaps: names('up,right,down,left', OBSTACLE_FREE_SIDES, 24),
    gapM: num(0.7, 0.5, 10),
    obstacleDepthM: num(1, 0.2, 10),
    obstacleRunM: num(5.5, 3, 80),
    stageWidths: list(0.8, 30, 12, [3, 2.6, 2.2, 2, 1.8]),
    stageBends: list(0, 40, 12, [2, 3, 4, 4, 6]),
    stageGaps: list(0, 20, 12, [0, 0, 1, 2, 2])
};

/** One stage of a long tunnel, as built: what makes it harder than the one before. */
export interface TunnelStage {
    readonly stage: number;
    readonly widthM: number;
    readonly bends: number;
    readonly obstacles: number;
}

export function buildTunnel(p: ResolvedParams): Built {
    const h = n(p, 'heightM');
    const y0 = n(p, 'startHeightM');
    requireInside('corridor', y0, h);
    const layout = s(p, 'layout');
    const gapM = n(p, 'gapM');
    const depth = n(p, 'obstacleDepthM');
    const sides = (p['gaps'] as string).split(',') as ObstacleFreeSide[];

    const boxes: Box[] = [];
    const objects: SonicObject[] = [];
    const landmarks: Landmark[] = [{ id: 'start', pos: [0, y0, 0] }];
    const runs: Run[] = [];
    let x = 0, z = 0;
    let hx = 0, hz = -1; // heading on the floor plane: -Z first
    let w = n(p, 'widthM');
    let turns = 0;
    let obstacleNo = 0;
    let sideNo = 0;

    const mark = (id: string, pos: Vec3): void => {
        landmarks.push({ id, pos: [round6(pos[0]), round6(pos[1]), round6(pos[2])] });
    };
    const forward = (len: number, dodges: Dodge[] = []): void => {
        const nx = x + hx * len, nz = z + hz * len;
        const alongX = hx !== 0;
        const half = len / 2 + w / 2;
        boxes.push({ cx: (x + nx) / 2, cy: h / 2, cz: (z + nz) / 2, hx: alongX ? half : w / 2, hy: h / 2, hz: alongX ? w / 2 : half });
        runs.push({ from: [x, y0, z], to: [nx, y0, nz], heading: [hx, 0, hz], half: w / 2, dodges });
        x = nx;
        z = nz;
    };
    const bend = (leg: number): void => {
        const right = turns % 2 === 0;
        const [a, b] = right ? [-hz, hx] : [hz, -hx];
        hx = a + 0;
        hz = b + 0;
        turns++;
        forward(leg);
        const last = runs[runs.length - 1] as Run;
        // the first point of the leg the track joins after the corner
        mark(`bend-${turns}`, [last.from[0] + hx * Math.min(w / 2, leg / 2), y0, last.from[2] + hz * Math.min(w / 2, leg / 2)]);
    };
    /** a run of obstacleRunM with an obstacle in its middle that leaves `side` free */
    const obstacle = (side: ObstacleFreeSide): void => {
        const run = n(p, 'obstacleRunM');
        if (depth + 2 * APPROACH_M > run) throw new WorldSpecError(`corridor: an obstacle ${depth} m deep needs a run of at least ${depth + 2 * APPROACH_M} m, got ${run}`);
        const across = side === 'left' || side === 'right' ? w - gapM : h - gapM;
        if (across < OBSTACLE_MIN_M) throw new WorldSpecError(`corridor: a free way of ${gapM} m ${side === 'up' || side === 'down' ? 'in a tunnel' : 'beside an obstacle in a tunnel'} ${side === 'up' || side === 'down' ? `${h} m high` : `${w} m wide`} leaves an obstacle thinner than ${OBSTACLE_MIN_M} m`);
        const cover = obstacleCoverM(side, gapM, w, h, y0);
        if (cover < OBSTACLE_COVER_M - 1e-9) {
            const most = side === 'left' || side === 'right' ? w / 2 - OBSTACLE_COVER_M : side === 'up' ? h - y0 - OBSTACLE_COVER_M : y0 - OBSTACLE_COVER_M;
            const reach = cover >= 0 ? `only ${round6(cover)} m past` : `${round6(-cover)} m short of`;
            throw new WorldSpecError(
                `corridor: obstacle ${obstacleNo + 1} (free ${side}, a way of ${gapM} m) reaches ${reach} the middle of the tunnel, so a craft flying the middle passes it unheard; it must reach ${OBSTACLE_COVER_M} m past it: in a tunnel ${w} m wide and ${h} m high, flown at ${y0} m, a way of at most ${round6(most)} m`
            );
        }
        const e = OBSTACLE_EMBED_M;
        // the block in the run's own frame: across (to the right of the heading), up, along
        let acrossSize = w + 2 * e, upSize = h + 2 * e, right = 0, cy = h / 2;
        let free: { right: number; up: number };
        switch (side) {
            case 'up':
                upSize = h - gapM + e;
                cy = (h - gapM - e) / 2;
                free = { right: 0, up: h - gapM / 2 - y0 };
                break;
            case 'down':
                upSize = h - gapM + e;
                cy = (gapM + h + e) / 2;
                free = { right: 0, up: gapM / 2 - y0 };
                break;
            case 'left':
                acrossSize = w - gapM + e;
                right = (gapM + e) / 2;
                free = { right: -(w / 2 - gapM / 2), up: 0 };
                break;
            case 'right':
                acrossSize = w - gapM + e;
                right = -(gapM + e) / 2;
                free = { right: w / 2 - gapM / 2, up: 0 };
                break;
        }
        const along = run / 2;
        const rx = -hz + 0, rz = hx + 0; // to the right of the heading
        const pos: Vec3 = [x + hx * along + rx * right, cy, z + hz * along + rz * right];
        const size: Vec3 = hx !== 0 ? [depth, upSize, acrossSize] : [acrossSize, upSize, depth];
        obstacleNo++;
        objects.push(object(`block-${obstacleNo}`, { kind: 'box', size: [round6(size[0]), round6(size[1]), round6(size[2])] }, pos, 0, null, true, 'obstacle'));
        const before = along - depth / 2 - APPROACH_M;
        mark(`gap-${obstacleNo}`, [x + hx * before + rx * free.right, y0 + free.up, z + hz * before + rz * free.right]);
        forward(run, [{ along, reach: depth / 2, right: free.right, up: free.up }]);
    };
    const nextSide = (): ObstacleFreeSide => sides[sideNo++ % sides.length] as ObstacleFreeSide;

    switch (layout) {
        case 'gaps':
            forward(n(p, 'straightM'));
            for (let i = 0; i < sides.length; i++) obstacle(nextSide());
            forward(n(p, 'endM'));
            break;
        case 'long': {
            const widths = p['stageWidths'] as readonly number[];
            const bendsOf = p['stageBends'] as readonly number[];
            const gapsOf = p['stageGaps'] as readonly number[];
            if (widths.length === 0 || bendsOf.length !== widths.length || gapsOf.length !== widths.length) {
                throw new WorldSpecError(`corridor: a long tunnel needs as many stageBends and stageGaps as stageWidths (${widths.length}, ${bendsOf.length}, ${gapsOf.length})`);
            }
            if (!bendsOf.every(Number.isInteger) || !gapsOf.every(Number.isInteger)) throw new WorldSpecError('corridor: stageBends and stageGaps must be whole numbers');
            w = widths[0] as number;
            forward(n(p, 'straightM'));
            widths.forEach((width, k) => {
                w = width;
                mark(`stage-${k + 1}`, [x, y0, z]);
                forward(n(p, 'segmentM'));
                for (let b = 0; b < (bendsOf[k] as number); b++) bend(n(p, 'segmentM'));
                for (let g = 0; g < (gapsOf[k] as number); g++) obstacle(nextSide());
                const last = runs[runs.length - 1] as Run;
                runs[runs.length - 1] = { ...last, stageEnd: k + 1 };
            });
            forward(n(p, 'endM'));
            break;
        }
        default:
            forward(n(p, 'straightM'));
            for (let b = 0; b < n(p, 'bendCount'); b++) bend(n(p, 'segmentM'));
            forward(n(p, 'endM'));
    }
    mark('end', [x, y0, z]);

    return {
        shell: cavityShell(boxes),
        objects,
        bounds: hollowBounds(boxes),
        landmarks,
        start: { pos: [0, y0, 0], yawDeg: 0 },
        track: corridorNodes(runs)
    };
}

/** The stages of a long tunnel as its parameters build them (an empty list for the other layouts). */
export function tunnelStages(p: ResolvedParams): TunnelStage[] {
    if (s(p, 'layout') !== 'long') return [];
    const widths = p['stageWidths'] as readonly number[];
    return widths.map((widthM, k) => ({ stage: k + 1, widthM, bends: (p['stageBends'] as readonly number[])[k] as number, obstacles: (p['stageGaps'] as readonly number[])[k] as number }));
}
