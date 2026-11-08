// Tunnels (M41-21, lane s13-worlds step 6): corridor version 2 and the six tunnel lessons. Held here:
// every tunnel can be flown from the start to the end by a craft of the simulator's sizes (a flood fill
// of the free space, the truth bot at the lesson's own caps, and the widest sphere that follows the
// track); every obstacle leaves exactly the side it says free (control: the same tunnel with that way
// closed cannot be flown); the long tunnel's stages are each harder than the one before by a measure
// (control: a stage made wider fails it); the tunnels are on the ladder after the corridor.
import { describe, expect, it } from 'vitest';
import type { AnalyticWorldSpec, LessonDef, SonicObject, Vec3, WorldCheckpoint } from '../src/contract';
import { createTranslator, DICTS } from '../src/i18n';
import { BODY_RADIUS_M, getLesson, lessonPaths } from '../src/lesson';
import { createAnalyticWorld, makeSpec, sdBox, tunnelStages, WorldSpecError, type AnalyticWorldInfo } from '../src/world';
import { alongTrack } from './helpers/along';
import { NEW_LESSONS } from './helpers/new-lessons';
import { ScriptedPilot } from './helpers/pilot';
import { DEFAULT_CRAFT_M, fullStickSeconds, LARGEST_CRAFT_M } from './helpers/reach';
import { playLesson } from './helpers/truth';
const TUNNELS = ['tunnel-wide', 'tunnel-narrow', 'tunnel-narrower', 'tunnel-bends', 'tunnel-gaps', 'tunnel-long'];
const worldOf = (l: LessonDef): AnalyticWorldInfo => createAnalyticWorld((l.world as { spec: AnalyticWorldSpec }).spec);

/** A world's geometry with more solid in it: the boxes `extra` (centre, half extents) added to its solids. */
function withBlocks(w: AnalyticWorldInfo, extra: readonly { c: Vec3; h: Vec3 }[]): Pick<AnalyticWorldInfo, 'sdf' | 'solidAt' | 'bounds' | 'start' | 'landmarks'> {
    const sdf = (x: number, y: number, z: number): number => Math.min(w.sdf(x, y, z), ...extra.map((b) => sdBox(x - b.c[0], y - b.c[1], z - b.c[2], b.h[0], b.h[1], b.h[2])));
    return { sdf, solidAt: (x, y, z) => sdf(x, y, z) <= 0, bounds: w.bounds, start: w.start, landmarks: w.landmarks };
}

/**
 * Whether a craft of radius r can get from the start to the end: a flood fill over a grid of `cell` metres of the
 * points whose distance to every surface is more than r (the distance is a lower bound inside the hollow, so this
 * never finds a way that is not there).
 */
function passable(w: Pick<AnalyticWorldInfo, 'sdf' | 'bounds' | 'start' | 'landmarks'>, r: number, cell = 0.2): boolean {
    const { min, max } = w.bounds;
    const nx = Math.ceil((max[0] - min[0]) / cell), ny = Math.ceil((max[1] - min[1]) / cell), nz = Math.ceil((max[2] - min[2]) / cell);
    const idx = (i: number, j: number, k: number): number => (i * ny + j) * nz + k;
    const free = new Int8Array(nx * ny * nz).fill(-1);
    const isFree = (i: number, j: number, k: number): boolean => {
        const n = idx(i, j, k);
        if (free[n] === -1) free[n] = w.sdf(min[0] + (i + 0.5) * cell, min[1] + (j + 0.5) * cell, min[2] + (k + 0.5) * cell) > r ? 1 : 0;
        return free[n] === 1;
    };
    const cellOf = (p: Vec3): [number, number, number] => [Math.floor((p[0] - min[0]) / cell), Math.floor((p[1] - min[1]) / cell), Math.floor((p[2] - min[2]) / cell)];
    const nearestFree = (p: Vec3): [number, number, number] | null => {
        const [ci, cj, ck] = cellOf(p);
        for (let d = 0; d <= 2; d++) for (let i = ci - d; i <= ci + d; i++) for (let j = cj - d; j <= cj + d; j++) for (let k = ck - d; k <= ck + d; k++) if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && isFree(i, j, k)) return [i, j, k];
        return null;
    };
    const start = nearestFree(w.start.pos);
    const end = nearestFree(w.landmarks.find((l) => l.id === 'end')!.pos);
    if (start === null || end === null) return false;
    const seen = new Uint8Array(nx * ny * nz);
    const stack: [number, number, number][] = [start];
    seen[idx(...start)] = 1;
    while (stack.length > 0) {
        const [i, j, k] = stack.pop()!;
        if (i === end[0] && j === end[1] && k === end[2]) return true;
        for (const [a, b, c] of [[i + 1, j, k], [i - 1, j, k], [i, j + 1, k], [i, j - 1, k], [i, j, k + 1], [i, j, k - 1]] as const) {
            if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
            const n = idx(a, b, c);
            if (seen[n] === 0 && isFree(a, b, c)) {
                seen[n] = 1;
                stack.push([a, b, c]);
            }
        }
    }
    return false;
}

/** A sphere of radius r at p touches nothing solid (the exact solid, sampled on the sphere and inside it). */
function sphereFree(w: Pick<AnalyticWorldInfo, 'solidAt'>, p: Vec3, r: number): boolean {
    if (w.solidAt(...p)) return false;
    for (const f of [1, 0.5]) {
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
            if (a === 0 && b === 0 && c === 0) continue;
            const l = Math.hypot(a, b, c);
            if (w.solidAt(p[0] + (a / l) * r * f, p[1] + (b / l) * r * f, p[2] + (c / l) * r * f)) return false;
        }
    }
    return true;
}

/** The widest sphere that flies the whole track (every 5 cm of the lines between its checkpoints), to 1 cm. */
function widestCraft(w: AnalyticWorldInfo): number {
    const list = w.checkpoints as WorldCheckpoint[];
    const points: Vec3[] = [];
    for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i]!.pos, b = list[i + 1]!.pos;
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.05));
        for (let k = 0; k < n; k++) points.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
    }
    let lo = 0, hi = 2;
    while (hi - lo > 0.01) {
        const mid = (lo + hi) / 2;
        if (points.every((p) => sphereFree(w, p, mid))) lo = mid;
        else hi = mid;
    }
    return lo;
}

/**
 * Where the open-way chime of an obstacle sounds: from 10 m before its front to its back, along the track (lane s13-sound
 * starts it when the time to contact drops under 3 s; the review measured 7.7 to 9.7 m before a block at 2.5 m/s). The
 * points (but the first, the start, which gives no checkpoint chime) that lie in such a stretch: a checkpoint there would
 * chime over the open way (review M8).
 */
function chimeClashes(w: AnalyticWorldInfo, points: readonly Vec3[]): string[] {
    const list = w.checkpoints as WorldCheckpoint[];
    const out: string[] = [];
    for (const b of w.objects().filter((o) => o.id.startsWith('block-'))) {
        const centre = alongTrack(list, b.pos);
        const half = Math.max(...(b.shape as { size: Vec3 }).size.filter((_, i) => i !== 1)) / 2;
        const reach = Math.min(half, 0.5);
        points.forEach((p, i) => {
            const at = alongTrack(list, p);
            if (i > 0 && at >= centre - reach - 10 && at <= centre + reach) out.push(`point ${i + 1} at ${at.toFixed(1)} m, ${b.id} at ${centre.toFixed(1)} m`);
        });
    }
    return out;
}

/** Turns of the track: checkpoints whose heading differs from the one before. */
const turnsOf = (list: readonly WorldCheckpoint[]): number => list.filter((c, i) => i > 0 && (Math.abs(c.dir[0] - list[i - 1]!.dir[0]) > 1e-6 || Math.abs(c.dir[2] - list[i - 1]!.dir[2]) > 1e-6)).length;

/**
 * Which of the four sides of an obstacle a craft can get past: for each side, a line along the tunnel through the
 * middle of a strip gapM wide on that side of the tunnel's cross section (the cavity box the obstacle stands in), from
 * 1.5 m before the obstacle's centre to 1.5 m past it, swept by a sphere of the craft's radius.
 */
function sidesOpen(w: AnalyticWorldInfo, block: SonicObject, gapM: number): Record<'up' | 'down' | 'left' | 'right', boolean> {
    const list = w.checkpoints as WorldCheckpoint[];
    const near = list.reduce((a, b) => (Math.hypot(b.pos[0] - block.pos[0], b.pos[2] - block.pos[2]) < Math.hypot(a.pos[0] - block.pos[0], a.pos[2] - block.pos[2]) ? b : a));
    const h = near.dir;
    const right: Vec3 = [-h[2], 0, h[0]];
    const box = (w.cavities ?? []).find((b) => Math.abs(block.pos[0] - b.cx) <= b.hx && Math.abs(block.pos[1] - b.cy) <= b.hy && Math.abs(block.pos[2] - b.cz) <= b.hz)!;
    const floor = box.cy - box.hy, ceiling = box.cy + box.hy, midY = box.cy;
    // the tunnel's middle across, and its half width, from the box (its long side runs along the tunnel)
    const alongX = Math.abs(h[0]) > 0.5;
    const half = alongX ? box.hz : box.hx;
    const mid: Vec3 = alongX ? [block.pos[0], midY, box.cz] : [box.cx, midY, block.pos[2]];
    const line = (lateral: number, y: number): boolean => {
        for (let t = -1.5; t <= 1.5; t += 0.05) {
            const p: Vec3 = [mid[0] + right[0] * lateral + h[0] * t, y, mid[2] + right[2] * lateral + h[2] * t];
            if (!sphereFree(w, p, BODY_RADIUS_M)) return false;
        }
        return true;
    };
    return {
        up: line(0, ceiling - gapM / 2),
        down: line(0, floor + gapM / 2),
        left: line(-(half - gapM / 2), midY),
        right: line(half - gapM / 2, midY)
    };
}

describe('tunnels (M41-21)', () => {
    it('come after the corridor on the full ladder, in this order; one of them (tunnel-gaps) is on the fast path', () => {
        const full = lessonPaths().full;
        const at = full.indexOf('corridor');
        expect(full.slice(at + 1, at + 7)).toEqual(TUNNELS);
        expect(lessonPaths().fast.filter((id) => TUNNELS.includes(id))).toEqual(['tunnel-gaps']);
        for (const id of TUNNELS) {
            const l = getLesson(id);
            expect(l.module, id).toBe(4);
            expect(l.format).toBe('shramko-sonic-lesson/2');
            expect(l.world.kind === 'analytic' && l.world.spec.generator === 'corridor' && l.world.spec.version === 2, id).toBe(true);
            expect(l.assists.onTouch, id).toBe('bump-recentre');
            expect(NEW_LESSONS).toContain(id);
        }
        // the start screen sorts by order: every lesson's order is its place on the full ladder
        full.forEach((id, i) => expect(getLesson(id).order, id).toBe(i));
    });

    it('have the layers every flying lesson has: the height tone and the room bed (lane s13-sound, M41-10; review M7); control: the layers they had', () => {
        const flyingLayers = (on: readonly string[]): boolean => ['safety', 'height', 'room', 'voice'].every((x) => on.includes(x));
        for (const id of TUNNELS) expect(flyingLayers(getLesson(id).layers.on), id).toBe(true);
        expect(flyingLayers(['safety', 'voice'])).toBe(false);
    });

    it('get narrower in the series wide, narrow, narrower', () => {
        const width = (id: string): number => worldOf(getLesson(id)).resolved['widthM'] as number;
        expect(width('tunnel-wide')).toBeGreaterThan(width('tunnel-narrow'));
        expect(width('tunnel-narrow')).toBeGreaterThan(width('tunnel-narrower'));
    });

    it.each(TUNNELS)('%s: a turn or an obstacle every 2 to 3.2 s at the lesson\'s cap, and the goal is the track', (id) => {
        const l = getLesson(id);
        const w = worldOf(l);
        const p = w.resolved;
        const v = l.assists.maxSpeedMps as number;
        const piece = p['layout'] === 'gaps' ? (p['obstacleRunM'] as number) : (p['segmentM'] as number);
        expect(fullStickSeconds(piece, v, 'horizontal'), 'piece').toBeGreaterThanOrEqual(2);
        expect(fullStickSeconds(piece, v, 'horizontal'), 'piece').toBeLessThanOrEqual(3.2);
        const list = w.checkpoints as WorldCheckpoint[];
        let length = 0;
        for (let i = 1; i < list.length; i++) length += Math.hypot(list[i]!.pos[0] - list[i - 1]!.pos[0], list[i]!.pos[1] - list[i - 1]!.pos[1], list[i]!.pos[2] - list[i - 1]!.pos[2]);
        // the goal ends with the track: merged with lane s13-lessons, their goal 'track-end' (test/world-track-end.test.ts);
        // until then 'fly-distance' of the track's length less under 4 m
        const goal = l.goals.at(-1) as { kind: string; metres?: number };
        if (goal.kind === 'fly-distance') {
            expect(goal.metres).toBeLessThan(length);
            expect(goal.metres).toBeGreaterThan(length - 4);
        } else expect(goal.kind).toBe('track-end');
        // the lesson's own checkpoints stand on the track
        for (const cp of l.checkpoints) expect(Math.min(...list.map((c) => Math.hypot(c.pos[0] - cp.at[0], c.pos[1] - cp.at[1], c.pos[2] - cp.at[2]))), cp.id).toBeLessThan(0.01);
    });

    it.each(TUNNELS)('%s: its own checkpoints are the start and the end of the track, none where the open-way chime of an obstacle sounds (review M8)', (id) => {
        const l = getLesson(id);
        const w = worldOf(l);
        const list = w.checkpoints as WorldCheckpoint[];
        const first = list[0] as WorldCheckpoint, last = list[list.length - 1] as WorldCheckpoint;
        expect(l.checkpoints.map((c) => c.at), id).toEqual([first.pos, last.pos]);
        expect(l.checkpoints[0]!.pose).toEqual(l.start);
        // the end faces along the track (a respawn there would face the way on)
        const a = (l.checkpoints[1]!.pose.yawDeg * Math.PI) / 180;
        expect(Math.sin(a) * last.dir[0] - Math.cos(a) * last.dir[2], id).toBeCloseTo(1, 9);
        expect(chimeClashes(w, l.checkpoints.map((c) => c.at)), id).toEqual([]);
    });

    it('control: checkpoints 1.5 m before each obstacle, as the tunnels had them, stand where the open-way chime sounds', () => {
        for (const id of ['tunnel-gaps', 'tunnel-long']) {
            const w = worldOf(getLesson(id));
            const before = w.landmarks.filter((m) => m.id.startsWith('gap-')).map((m) => m.pos);
            const clashes = chimeClashes(w, [w.start.pos, ...before]);
            // every one of them (points 2 to n + 1), each in the stretch of its own obstacle at least
            expect(new Set(clashes.map((c) => c.split(' ')[1])).size, id).toBe(before.length);
        }
    });

    it.each(TUNNELS)('%s: a craft can fly it from the start to the end (flood fill at 0.12 m), and the largest drone fits the track', (id) => {
        const w = worldOf(getLesson(id));
        expect(passable(w, BODY_RADIUS_M)).toBe(true);
        const widest = widestCraft(w);
        // the margin stated in the lane doc: the widest sphere along the track, against the simulator's drones
        expect(widest, id).toBeGreaterThan(LARGEST_CRAFT_M);
        expect(widest - DEFAULT_CRAFT_M, id).toBeGreaterThan(0.25);
    }, 60000);

    it.each(TUNNELS)('the truth bot flies %s at its caps and passes in at most 2 x r attempts, with no touch', (id) => {
        const l = getLesson(id);
        const p = new ScriptedPilot(l);
        playLesson(p, () => 'truth', 2 * l.pass.required);
        expect(p.run.phase, p.results()).toBe('passed');
        expect(p.of('touch')).toEqual([]);
    }, 120000);

    it('every obstacle leaves the side it says free, and only that side', () => {
        for (const id of ['tunnel-gaps', 'tunnel-long']) {
            const w = worldOf(getLesson(id));
            const sides = (w.resolved['gaps'] as string).split(',');
            const blocks = w.objects().filter((o) => o.id.startsWith('block-'));
            expect(blocks.length, id).toBe(id === 'tunnel-gaps' ? 4 : 5);
            blocks.forEach((b, i) => {
                const want = sides[i % sides.length] as 'up' | 'down' | 'left' | 'right';
                const open = sidesOpen(w, b, w.resolved['gapM'] as number);
                expect(Object.entries(open).filter(([, v]) => v).map(([k]) => k), `${id} ${b.id}`).toEqual([want]);
            });
        }
        expect(getLesson('tunnel-gaps').world.kind === 'analytic' && (getLesson('tunnel-gaps').world as { spec: AnalyticWorldSpec }).spec.params['gaps']).toBe('up,right,down,left');
    });

    it('every obstacle stands in the middle of the tunnel: it reaches 0.2 m past the line a craft flies down the middle (review M9); control: the first obstacle of the long tunnel as it was', () => {
        /**
         * How far the solid of `block` reaches past the tunnel's middle at flying height: minus the least distance the
         * world gives on the line along the run through the middle of its cavity box at the start's height, over the
         * obstacle's depth (inside a box the distance is exact). Negative: the line passes beside the obstacle.
         */
        const cover = (w: Pick<AnalyticWorldInfo, 'sdf' | 'cavities' | 'checkpoints' | 'start'>, block: Pick<SonicObject, 'pos' | 'shape'>): number => {
            const list = w.checkpoints as WorldCheckpoint[];
            const near = list.reduce((a, b) => (Math.hypot(b.pos[0] - block.pos[0], b.pos[2] - block.pos[2]) < Math.hypot(a.pos[0] - block.pos[0], a.pos[2] - block.pos[2]) ? b : a));
            const h = near.dir;
            const box = (w.cavities ?? []).find((b) => Math.abs(block.pos[0] - b.cx) <= b.hx && Math.abs(block.pos[2] - b.cz) <= b.hz)!;
            const alongX = Math.abs(h[0]) > 0.5;
            const size = (block.shape as { size: Vec3 }).size;
            const depth = alongX ? size[0] : size[2];
            const y0 = w.start.pos[1];
            let least = Infinity;
            for (let t = -depth / 2; t <= depth / 2 + 1e-9; t += depth / 40) {
                const p: Vec3 = alongX ? [block.pos[0] + t, y0, box.cz] : [box.cx, y0, block.pos[2] + t];
                least = Math.min(least, w.sdf(...p));
            }
            return -least;
        };
        let blocks = 0;
        for (const id of TUNNELS) {
            const w = worldOf(getLesson(id));
            for (const b of w.objects().filter((o) => o.id.startsWith('block-'))) {
                blocks++;
                expect(cover(w, b), `${id} ${b.id}`).toBeGreaterThanOrEqual(0.2 - 1e-6);
            }
        }
        expect(blocks).toBe(9);
        // control: block-1 of the long tunnel as the review found it (fef8869), rebuilt by hand in a straight tunnel of its
        // stage (1.8 m wide, 2.4 m high, flown at 1.2 m): its way of 1 m on the right leaves the block 0.8 m of the width,
        // 0.1 m short of the middle, so a craft flying the middle passes it
        const straight = createAnalyticWorld(makeSpec('corridor', { layout: 'tunnel', widthM: 1.8, heightM: 2.4, startHeightM: 1.2, straightM: 10, bendCount: 0, endM: 1 }, 0, 2));
        const e = 0.05;
        const old = { c: [(-0.9 - e + (-0.9 + 0.8)) / 2, 1.2, -5] as Vec3, h: [(0.8 + e) / 2, 1.2 + e, 0.5] as Vec3 };
        const asItWas = { ...withBlocks(straight, [old]), cavities: straight.cavities, checkpoints: straight.checkpoints };
        expect(cover(asItWas, { pos: old.c, shape: { kind: 'box', size: [2 * old.h[0], 2 * old.h[1], 2 * old.h[2]] } })).toBeCloseTo(-0.1, 6);
    });

    it('control: the same tunnel with a free way closed cannot be flown', () => {
        const w = worldOf(getLesson('tunnel-gaps'));
        expect(passable(w, BODY_RADIUS_M)).toBe(true);
        for (const block of w.objects().filter((o) => o.id.startsWith('block-'))) {
            // the obstacle grown over its free way: the whole cross section of the tunnel, as deep as the obstacle
            const box = (w.cavities ?? []).find((b) => Math.abs(block.pos[0] - b.cx) <= b.hx && Math.abs(block.pos[1] - b.cy) <= b.hy && Math.abs(block.pos[2] - b.cz) <= b.hz)!;
            const depth = ((block.shape as { size: Vec3 }).size[2] as number) / 2;
            const closed = withBlocks(w, [{ c: [box.cx, box.cy, block.pos[2]], h: [box.hx, box.hy, depth] }]);
            expect(passable(closed, BODY_RADIUS_M), block.id).toBe(false);
        }
    }, 60000);

    it('the long tunnel: stages each harder than the one before, the end of each marked; control: a wider stage 3 fails', () => {
        /**
         * The measure of a stage, from the world: its width (the least sum of the distances to the left and the right
         * wall across the track at its checkpoints, where no obstacle is in the way), its turns and its obstacles, and
         * d = (1 + turns + 2 x obstacles) / (width / 2 - the craft's radius): more to do in less room is harder.
         */
        const measure = (w: AnalyticWorldInfo): { width: number; turns: number; obstacles: number; d: number }[] => {
            const list = w.checkpoints as WorldCheckpoint[];
            const ends = list.map((c, i) => (c.stage === undefined ? -1 : i)).filter((i) => i >= 0);
            const blocks = w.objects().filter((o) => o.id.startsWith('block-'));
            return ends.map((end, k) => {
                const from = k === 0 ? 0 : (ends[k - 1] as number);
                const part = list.slice(from + 1, end + 1);
                const across = part.flatMap((c) => {
                    const r: Vec3 = [-c.dir[2], 0, c.dir[0]];
                    const a = w.castRay(c.pos, r, 50), b = w.castRay(c.pos, [-r[0], 0, -r[2]], 50);
                    return a === null || b === null || a.objectId !== null || b.objectId !== null ? [] : [a.distance + b.distance];
                });
                const width = Math.min(...across);
                const inStage = blocks.filter((b) => part.some((c) => Math.hypot(c.pos[0] - b.pos[0], c.pos[2] - b.pos[2]) < 3)).length;
                const turns = turnsOf(list.slice(from, end + 1));
                return { width, turns, obstacles: inStage, d: (1 + turns + 2 * inStage) / (width / 2 - BODY_RADIUS_M) };
            });
        };
        const strictlyHarder = (m: ReturnType<typeof measure>): boolean => m.every((s, k) => k === 0 || (s.d > (m[k - 1] as typeof s).d && s.width <= (m[k - 1] as typeof s).width + 1e-9 && s.turns >= (m[k - 1] as typeof s).turns && s.obstacles >= (m[k - 1] as typeof s).obstacles));
        const lesson = getLesson('tunnel-long');
        const w = worldOf(lesson);
        const stages = (w.checkpoints as WorldCheckpoint[]).filter((c) => c.stage !== undefined).map((c) => c.stage);
        expect(stages).toEqual([1, 2, 3, 4, 5]);
        const m = measure(w);
        expect(m).toHaveLength(5);
        expect(strictlyHarder(m), JSON.stringify(m)).toBe(true);
        expect(m.map((x) => Math.round(x.width * 100) / 100)).toEqual([3, 2.4, 1.8, 1.4, 1.2]);
        expect(m.map((x) => x.obstacles)).toEqual([0, 0, 1, 2, 2]);
        expect(tunnelStages(w.resolved).map((s) => s.widthM)).toEqual([3, 2.4, 1.8, 1.4, 1.2]);
        // the very long one: over 100 m of track, about a minute at its cap and more
        const list = w.checkpoints as WorldCheckpoint[];
        let length = 0;
        for (let i = 1; i < list.length; i++) length += Math.hypot(list[i]!.pos[0] - list[i - 1]!.pos[0], list[i]!.pos[1] - list[i - 1]!.pos[1], list[i]!.pos[2] - list[i - 1]!.pos[2]);
        expect(length).toBeGreaterThan(100);
        // control
        const spec = (lesson.world as { spec: AnalyticWorldSpec }).spec;
        const wider = createAnalyticWorld({ ...spec, params: { ...spec.params, stageWidths: [3, 2.4, 2.8, 1.4, 1.2] } });
        expect(strictlyHarder(measure(wider))).toBe(false);
    });

    it('tunnel-gaps tells the pilot that the open-way chime comes from the free side and how a way above sounds', () => {
        const l = getLesson('tunnel-gaps');
        const en = createTranslator('en', DICTS);
        const text = l.intro.map((x) => en.text(x)).join(' ');
        expect(text).toMatch(/chime comes from the free side/);
        // by its contour, as the glossary says (lane s13-sound, review m2): a way above moves like the height tone in a
        // climb, which is lower notes for a pilot whose height polarity is up-lower; "high" would be wrong for him
        expect(text).toMatch(/moves like your height tone in a climb, the way is above/);
        expect(text).not.toMatch(/high chime/i);
    });

    it.each([
        ['an obstacle thinner than 0.5 m beside a wide free way', { layout: 'gaps', widthM: 1.5, gapM: 1.1, gaps: 'left' }, /thinner than 0.5 m/],
        ['a free way that leaves the middle of the tunnel open (review M9: the first obstacle of the long tunnel as it was)', { layout: 'long', stageWidths: [3, 2.4, 1.8, 1.4, 1.2], stageBends: [2, 3, 4, 4, 6], stageGaps: [0, 0, 1, 2, 2], gaps: 'right,up,down,up,down', gapM: 1, heightM: 2.4, startHeightM: 1.2 }, /obstacle 1 \(free right, a way of 1 m\) reaches 0\.1 m short of the middle of the tunnel/],
        ['a free way below that comes within 0.2 m of the flying height', { layout: 'gaps', widthM: 3, heightM: 3, startHeightM: 1.5, gapM: 1.4, gaps: 'down' }, /reaches only 0\.1 m past the middle/],
        ['an obstacle in a run too short to come up to it', { layout: 'gaps', obstacleRunM: 3, obstacleDepthM: 1 }, /needs a run of at least 4 m/],
        ['stage lists of different lengths', { layout: 'long', stageWidths: [3, 2], stageBends: [1], stageGaps: [0, 0] }, /as many stageBends and stageGaps as stageWidths/],
        ['an unknown free side', { layout: 'gaps', gaps: 'up,sideways' }, /up, down, left, right joined by commas/],
        ['a fraction of a bend', { layout: 'long', stageWidths: [3], stageBends: [1.5], stageGaps: [0] }, /whole numbers/]
    ] as [string, AnalyticWorldSpec['params'], RegExp][])('refuses %s', (_name, params, reason) => {
        const build = (): unknown => createAnalyticWorld(makeSpec('corridor', params, 0, 2));
        expect(build).toThrow(WorldSpecError);
        expect(build).toThrow(reason);
    });
});
