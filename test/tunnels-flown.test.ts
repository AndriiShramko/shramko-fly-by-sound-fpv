// Review m3 of the v0.13 merge: two promises of the tunnels that held when the review measured them, but that no test
// held. (1) A touch in the corridor or any of the six tunnels puts the craft back RESPAWN_BEFORE_M (1 m) before the last
// point of the world's track it passed, facing along the track, clear of the walls, so at most 6 m back along the
// track (the points are 5 m apart or less; M41-20: "do not throw the pilot back so far"); only the corridor's was
// tested. (2) Flying down the middle of the tunnel straight at a shipped obstacle of tunnel-gaps and tunnel-long, the
// open-way chime names the side the generator left free and no other (test/freeway.test.ts flies box tunnels of its
// own, not the lessons' obstacles).
import { describe, expect, it } from 'vitest';
import type { AnalyticWorldSpec, LessonDef, SonicObject, Vec3, WorldCheckpoint } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { BODY_RADIUS_M, getLesson, type RunnerAction } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { getBuiltinTheme } from '../src/theme';
import { yawQuat } from '../src/util/vec';
import { createAnalyticWorld, type AnalyticWorldInfo } from '../src/world';
import { alongTrack } from './helpers/along';
import { ScriptedPilot } from './helpers/pilot';

const TRACKS = ['corridor', 'tunnel-wide', 'tunnel-narrow', 'tunnel-narrower', 'tunnel-bends', 'tunnel-gaps', 'tunnel-long'];
const worldOf = (l: LessonDef): AnalyticWorldInfo => createAnalyticWorld((l.world as { spec: AnalyticWorldSpec }).spec);
type Place = Extract<RunnerAction, { kind: 'place' }>;
/** M41-20: how far before the last point passed a touch puts the craft, and the most a touch may throw it back along the track */
const BEFORE_M = 1;
const MOST_BACK_M = 6;

describe('a touch in the corridor or a tunnel: back 1 m before the last point passed (review m3 of the merge)', () => {
    for (const id of TRACKS) {
        it(`${id}: at every third point of its track, a touch just past it`, () => {
            const lesson = getLesson(id);
            const w = worldOf(lesson);
            const list = w.checkpoints as readonly WorldCheckpoint[];
            // the points are 5 m apart or less: 1 m before the last one passed is at most 6 m back
            for (let i = 1; i < list.length; i++) expect(Math.hypot(list[i]!.pos[0] - list[i - 1]!.pos[0], list[i]!.pos[1] - list[i - 1]!.pos[1], list[i]!.pos[2] - list[i - 1]!.pos[2]), `${id} w${i + 1}`).toBeLessThanOrEqual(MOST_BACK_M - BEFORE_M + 1e-9);
            const p = new ScriptedPilot(lesson);
            p.begin();
            p.until(() => p.run.phase === 'flying', 120);
            const touched = new Set<number>();
            for (let i = 0; i < list.length && p.run.phase === 'flying'; i++) {
                const pt = list[i] as WorldCheckpoint;
                p.flyTo(pt.pos);
                const next = list[i + 1];
                if (i % 3 !== 2 || next === undefined || touched.has(i)) continue;
                touched.add(i);
                // 0.3 m on toward the next point, then a contact in the next frame
                const d: Vec3 = [next.pos[0] - pt.pos[0], next.pos[1] - pt.pos[1], next.pos[2] - pt.pos[2]];
                const len = Math.hypot(d[0], d[1], d[2]);
                const touchAt: Vec3 = [pt.pos[0] + (d[0] / len) * 0.3, pt.pos[1] + (d[1] / len) * 0.3, pt.pos[2] + (d[2] / len) * 0.3];
                p.flyTo(touchAt);
                const placed = p.actions.length;
                p.touchNext = true;
                p.hold(0.02);
                const place = p.actions.slice(placed).find((a): a is Place => a.kind === 'place');
                const reset = p.of('reset').at(-1);
                // the reset names the last point passed, and the craft is 1 m before it, facing along the track
                expect(reset?.checkpointId, `${id} touch past w${i + 1}`).toBe(`w${i + 1}`);
                const before: Vec3 = [pt.pos[0] - pt.dir[0] * BEFORE_M, pt.pos[1], pt.pos[2] - pt.dir[2] * BEFORE_M];
                const roomy = w.sdf(...before) > BODY_RADIUS_M + 0.2;
                const at = place?.pose.pos as Vec3;
                expect(Math.hypot(at[0] - (roomy ? before : pt.pos)[0], at[1] - (roomy ? before : pt.pos)[1], at[2] - (roomy ? before : pt.pos)[2]), `${id} w${i + 1}`).toBeLessThan(1e-9);
                const yaw = (Math.atan2(pt.dir[0], -pt.dir[2]) * 180) / Math.PI;
                expect(Math.abs((((place?.pose.yawDeg ?? NaN) - yaw + 540) % 360) - 180), `${id} w${i + 1} facing`).toBeLessThan(1e-6);
                // clear of every surface, and at most 1 m plus one gap of the track (5 m) back from the touch
                expect(w.sdf(...at), `${id} w${i + 1} clear`).toBeGreaterThan(BODY_RADIUS_M + 0.1);
                const back = alongTrack(list, touchAt) - alongTrack(list, at);
                expect(back, `${id} w${i + 1} back`).toBeGreaterThan(0);
                expect(back, `${id} w${i + 1} back`).toBeLessThanOrEqual(MOST_BACK_M);
                i--; // fly on from the point it was put before
            }
            expect(touched.size, id).toBe(Math.floor((list.length - 1) / 3));
            // and the lesson is passed in that attempt, at the end of the track
            p.until(() => p.run.phase !== 'flying', 5);
            expect(p.run.phase, id).toBe('passed');
            expect(p.results(), id).toBe('P');
        }, 60000);
    }
});

/** The tunnel's middle across at an obstacle, at flying height, and the way along the tunnel there. */
function middleAt(w: AnalyticWorldInfo, block: SonicObject): { readonly mid: Vec3; readonly h: Vec3; readonly from: number } {
    const list = w.checkpoints as WorldCheckpoint[];
    const near = list.reduce((a, b) => (Math.hypot(b.pos[0] - block.pos[0], b.pos[2] - block.pos[2]) < Math.hypot(a.pos[0] - block.pos[0], a.pos[2] - block.pos[2]) ? b : a));
    const h = near.dir;
    const box = (w.cavities ?? []).find((b) => Math.abs(block.pos[0] - b.cx) <= b.hx && Math.abs(block.pos[1] - b.cy) <= b.hy && Math.abs(block.pos[2] - b.cz) <= b.hz)!;
    const alongX = Math.abs(h[0]) > 0.5;
    const y0 = w.start.pos[1];
    const mid: Vec3 = alongX ? [block.pos[0], y0, box.cz] : [box.cx, y0, block.pos[2]];
    // how far back along the run the cavity box the obstacle stands in reaches, less a margin: where an approach can start
    const fromCentre = alongX ? (block.pos[0] - (box.cx - Math.sign(h[0]) * box.hx)) * Math.sign(h[0]) : (block.pos[2] - (box.cz - Math.sign(h[2]) * box.hz)) * Math.sign(h[2]);
    return { mid, h, from: Math.max(0, fromCentre - 0.5) };
}

describe('the open-way chime at every obstacle of tunnel-gaps and tunnel-long names its free side (review m3 of the merge)', () => {
    it('flown straight at it down the middle of the tunnel at the cap: the free side and no other, all the way in', () => {
        let blocks = 0;
        for (const id of ['tunnel-gaps', 'tunnel-long']) {
            const lesson = getLesson(id);
            const w = worldOf(lesson);
            const sides = (w.resolved['gaps'] as string).split(',');
            const speed = lesson.assists.maxSpeedMps as number;
            w.objects()
                .filter((o) => o.id.startsWith('block-'))
                .forEach((block, i) => {
                    blocks++;
                    const want = sides[i % sides.length] as string;
                    const { mid, h, from } = middleAt(w, block);
                    const depth = Math.abs(h[0]) > 0.5 ? ((block.shape as { size: Vec3 }).size[0] as number) : ((block.shape as { size: Vec3 }).size[2] as number);
                    const stopAt = depth / 2 + BODY_RADIUS_M + 0.3; // short of its face
                    const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: lesson.layers });
                    const yaw = (Math.atan2(h[0], -h[2]) * 180) / Math.PI;
                    const named: string[] = [];
                    let frames = 0;
                    let chimed = 0;
                    let firstUnder3s: number | null = null;
                    for (let k = 0; ; k++) {
                        const dist = from - (speed * k) / 60;
                        if (dist < stopAt) break;
                        const pos: Vec3 = [mid[0] - h[0] * dist, mid[1], mid[2] - h[2] * dist];
                        const plan = planner.plan({ sample: { t: (k * 1000) / 60, tick: k, pos, vel: [h[0] * speed, 0, h[2] * speed], quat: yawQuat(yaw), rate: [0, 0, 0], yawDeg: yaw, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false }, world: w, target: null, floorY: 0 });
                        const ttc = (dist - depth / 2) / speed;
                        if (ttc > 2.9) continue; // under the 3 s of the trigger, with a frame's margin
                        frames++;
                        firstUnder3s ??= k;
                        const side = plan.freeWay?.side;
                        if (side !== undefined) named.push(side);
                        if (plan.cues.some((c) => c.id.startsWith('safety.free'))) chimed++;
                    }
                    expect(frames, `${id} ${block.id}: an approach under 3 s`).toBeGreaterThan(10);
                    expect([...new Set(named)], `${id} ${block.id}`).toEqual([want]);
                    // every frame of the approach under 3 s names it, and the chime sounds in each
                    expect(named.length, `${id} ${block.id}`).toBe(frames);
                    expect(chimed, `${id} ${block.id}`).toBe(frames);
                });
        }
        expect(blocks).toBe(9);
    });
});
