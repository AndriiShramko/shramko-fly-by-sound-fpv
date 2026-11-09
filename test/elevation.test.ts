// Up and down by direction too (lane s13-elev, owner's message 42: "keep the direction of the sound for up and down;
// someone with very good headphones or very good hearing may tell it"). Pitch stays the carrier; with
// SonicPrefs.heightDirection on (absent or true) the cues of up and down also come from above or below: the open-way
// chime from the middle of the way past the obstacle, the target note from the target (a gate's centre, a band's middle
// TARGET_AHEAD_M ahead), the floor and the ceiling from below and above, each with a breath of air (`airDb`). With the
// setting off every plan is v0.13's exactly: the flights of test/helpers/placement.ts against the hashes the v0.13
// planner (16c01a1) made of them. What this cannot show: whether a person hears the direction (the virtual listener's
// rig renders it through Chrome's HRTF, pnpm listen, check VL-1-elevation).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CueEvent, SonicObject, SonicPrefs, Vec3 } from '../src/contract';
import { CuePlanner, ELEVATION_AIR_DB, ELEVATION_LOWPASS_HZ, FREE_DIRS, FREE_PREVIEW_DIRS, TARGET_AHEAD_M, type FramePlan, type VoicePlan } from '../src/cues';
import { defaultPrefs } from '../src/prefs';
import { FREE_SPAN_MAX_M, type FreeSide } from '../src/sense';
import { getBuiltinTheme } from '../src/theme';
import { canonicalJson } from '../src/util';
import { yawQuat } from '../src/util/vec';
import { block, boxTunnel } from './helpers/boxes';
import { flyPlacement, placementHashes, PLACEMENT_BLOCK_FRAMES, PLACEMENT_FLIGHT_IDS, v013Prefs, type FrameRecord, type PlacementFlightId } from './helpers/placement';

interface Fixture {
    readonly made: string;
    readonly flights: Readonly<Record<string, { readonly frames: number; readonly hash: string; readonly blocks: readonly string[] }>>;
}
const V013 = JSON.parse(readFileSync(new URL('./fixtures/placement-v013.json', import.meta.url), 'utf8')) as Fixture;

const withDirection = (id: PlacementFlightId, on: boolean): SonicPrefs => ({ ...v013Prefs(id), heightDirection: on }) as SonicPrefs;
const cache = new Map<string, FrameRecord[]>();
/**
 * A placement flight. `v013Ties`: with the scene sampler's rule of v0.13 for two mirror sectors (no dead band; lane s13-int
 * K1 made two mirror sectors within MIRROR_DEAD_BAND one tie, which orders two tied voices by the sectors instead)
 */
const flown = (id: PlacementFlightId, on: boolean, v013Ties = false): FrameRecord[] => {
    const key = `${id}:${on}:${v013Ties}`;
    if (!cache.has(key)) cache.set(key, flyPlacement(id, withDirection(id, on), v013Ties ? { mirrorDeadBand: 0 } : undefined));
    return cache.get(key) as FrameRecord[];
};
const voices = (rs: readonly FrameRecord[], cue: string): VoicePlan[] => rs.flatMap((r) => r.plan.voices.filter((v) => v.cue === cue));

describe('the setting off gives back v0.13 exactly', () => {
    it('the fixture is the v0.13 planner\'s', () => {
        expect(V013.made).toBe('16c01a1');
        expect(Object.keys(V013.flights).sort()).toEqual([...PLACEMENT_FLIGHT_IDS].sort());
    });

    it.each(PLACEMENT_FLIGHT_IDS)('%s: every frame\'s plan is v0.13\'s, voice for voice, note for note (with v0.13\'s rule for two mirror sectors)', (id) => {
        const h = placementHashes(flown(id, false, true));
        const want = V013.flights[id] as Fixture['flights'][string];
        expect(h.frames).toBe(want.frames);
        const first = h.blocks.findIndex((b, i) => b !== want.blocks[i]);
        expect(first, `first block that differs: frames ${first * PLACEMENT_BLOCK_FRAMES} to ${(first + 1) * PLACEMENT_BLOCK_FRAMES - 1}`).toBe(-1);
        expect(h.hash).toBe(want.hash);
    });

    it.each(PLACEMENT_FLIGHT_IDS)('control: %s with the setting on differs from v0.13', (id) => {
        expect(placementHashes(flown(id, true)).hash).not.toBe((V013.flights[id] as Fixture['flights'][string]).hash);
    });

    it.each(PLACEMENT_FLIGHT_IDS)('%s: the mirror tie of s13-int (K1) sounds the same voices in every frame, voice for voice; it only orders two tied voices by the sectors', (id) => {
        const before = flown(id, false, true);
        const now = flown(id, false);
        const sorted = (r: FrameRecord): string[] => r.plan.voices.map((v) => canonicalJson({ ...v, slot: 0, priority: 0 })).sort();
        // the rest of the plan with its lists in a fixed order: the active cues, and the sampler's hazards without their ranks (the order is the tie's)
        const rest = (r: FrameRecord): string => {
            const scene = r.plan.scene;
            return canonicalJson({ ...r.plan, voices: [], cues: r.plan.cues.map((c) => canonicalJson(c)).sort(), scene: scene === null ? null : { ...scene, hazards: scene.hazards.map((h) => canonicalJson({ ...h, rank: 0 })).sort() } });
        };
        let reordered = 0;
        now.forEach((r, i) => {
            const was = before[i] as FrameRecord;
            expect(sorted(r), `${id} at ${r.t} ms`).toEqual(sorted(was));
            expect(rest(r), `${id} at ${r.t} ms`).toBe(rest(was));
            if (r.plan.voices.map((v) => v.key).join() !== was.plan.voices.map((v) => v.key).join()) reordered++;
        });
        // measured on the placement flights: tunnel-gaps 90 frames of 1044 in each theme (the ceiling ahead and above it), rings-heights 10 of 1545
        // (the floor and the ceiling), none in the others
        expect(reordered, id).toBe(({ 'tunnel-gaps-soft': 90, 'tunnel-gaps-race': 90, 'rings-heights': 10 } as Record<string, number>)[id] ?? 0);
    });

    it('a document without the setting is on (absent: on), and only false turns it off', () => {
        const { heightDirection: _drop, ...rest } = { ...defaultPrefs(), heightDirection: true };
        const absent = placementHashes(flyPlacement('walls-hall-floor-ceiling', rest as SonicPrefs)).hash;
        expect(absent).toBe(placementHashes(flown('walls-hall-floor-ceiling', true)).hash);
        expect(absent).not.toBe(placementHashes(flown('walls-hall-floor-ceiling', false)).hash);
    });
});

describe('pitch, intervals and timing stay v0.13\'s: only the direction, the low-pass and the breath change', () => {
    /** a frame with the placement taken out: what must not change */
    const sound = (r: FrameRecord): unknown => ({
        voices: r.plan.voices.map(({ dir: _d, lowpassHz: _l, airDb: _a, ...v }) => v),
        dropped: r.plan.dropped,
        height: r.plan.height === null ? null : { ...r.plan.height, target: r.plan.height.target === null ? null : (({ dir: _d, airDb: _a, ...t }) => t)(r.plan.height.target) },
        speed: r.plan.speed,
        room: r.plan.room,
        urgent: r.plan.urgent,
        cues: r.plan.cues.map(({ dir: _d, ...c }) => c),
        side: r.plan.freeWay?.side ?? null,
        notes: r.notes.map(({ dir: _d, ...n }) => n)
    });
    it.each(PLACEMENT_FLIGHT_IDS)('%s: every note, period, level and rhythm the same with the setting on and off', (id) => {
        const a = flown(id, true);
        const b = flown(id, false);
        expect(a.length).toBe(b.length);
        for (let i = 0; i < a.length; i++) expect(sound(a[i] as FrameRecord), `${id} frame ${i}`).toEqual(sound(b[i] as FrameRecord));
    });

    it('with the setting on the breath goes with the cues of up and down and nothing else; off, with none', () => {
        for (const id of PLACEMENT_FLIGHT_IDS) {
            for (const r of flown(id, true)) {
                for (const v of r.plan.voices) {
                    const elevated = (v.cue === 'safety.free' && /:(up|down)$/.test(v.key)) || v.cue === 'safety.floor' || v.cue === 'safety.ceiling';
                    expect(v.airDb, `${id} ${v.key}`).toBe(elevated ? ELEVATION_AIR_DB : undefined);
                }
                const t = r.plan.height?.target ?? null;
                if (t !== null) expect(t.airDb).toBe(ELEVATION_AIR_DB);
            }
            for (const r of flown(id, false)) {
                for (const v of r.plan.voices) expect(v.airDb, `${id} ${v.key}`).toBeUndefined();
                expect(r.plan.height?.target?.dir).toBeUndefined();
                expect(r.plan.height?.target?.airDb).toBeUndefined();
            }
        }
    });
});

// a 3 x 3 m tunnel flown at 1.5 m; an obstacle 6 to 8 m ahead leaving a way 1.2 m wide on one side: its middle 0.9 m
// beside the craft's line (test/freeway.test.ts's worlds)
const BOXES: Readonly<Record<FreeSide, ReturnType<typeof boxTunnel>>> = {
    up: boxTunnel([block(-1.5, 1.5, 0, 1.8)]),
    down: boxTunnel([block(-1.5, 1.5, 1.2, 3)]),
    left: boxTunnel([block(-0.3, 1.5, 0, 3)]),
    right: boxTunnel([block(-1.5, 0.3, 0, 3)])
};

function flyBox(side: FreeSide, prefs: SonicPrefs = defaultPrefs()): FramePlan[] {
    const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs, layers: { on: ['safety'], heightBandM: null, hazardVoices: 3 } });
    const out: FramePlan[] = [];
    for (let k = 0; k < 96; k++) {
        const z = -3 * (k / 60);
        out.push(planner.plan({ sample: { t: (k * 1000) / 60, tick: k, pos: [0, 1.5, z], vel: [0, 0, -3], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false }, world: BOXES[side], target: null, floorY: 0 }));
    }
    return out;
}

describe('the open-way chime comes from the way', () => {
    it.each(['up', 'down'] as const)('a way %s: from the middle of the way past the obstacle, above or below ahead, rising as the craft closes in', (side) => {
        const plans = flyBox(side).filter((p) => p.freeWay !== null);
        expect(plans.length).toBeGreaterThan(20);
        let last = 0;
        for (const p of plans) {
            const w = p.freeWay as NonNullable<FramePlan['freeWay']>;
            expect(w.side).toBe(side);
            // the way is 1.2 m wide from the obstacle's edge 0.3 m beside the line: its middle 0.9 m out
            expect(w.middleM).toBeCloseTo(0.9, 6);
            const v = p.voices.find((x) => x.cue === 'safety.free') as VoicePlan;
            expect(v.dir).toEqual(w.dir);
            const sign = side === 'up' ? 1 : -1;
            const depth = w.obstacleM + 0.12 + 0.25; // hull and FREE_PAST_M: the probe's depth
            const want = [0, sign * 0.9, -depth].map((x) => x / Math.hypot(0.9, depth));
            for (let a = 0; a < 3; a++) expect(v.dir[a] as number).toBeCloseTo(want[a] as number, 6);
            // the elevation grows as the obstacle comes closer
            const elev = Math.asin(Math.abs(v.dir[1]));
            expect(elev).toBeGreaterThanOrEqual(last - 1e-9);
            last = elev;
            expect(v.lowpassHz).toBe(ELEVATION_LOWPASS_HZ);
            expect(v.airDb).toBe(ELEVATION_AIR_DB);
        }
        // 8 degrees off ahead with the block 5.9 m away, 31 at the last frame (1.1 m)
        expect(last * (180 / Math.PI)).toBeGreaterThan(30);
    });

    it.each(['left', 'right'] as const)('a way %s: from 60 degrees to that side as in v0.13, its middle measured all the same', (side) => {
        for (const p of flyBox(side).filter((x) => x.freeWay !== null)) {
            expect((p.freeWay as NonNullable<FramePlan['freeWay']>).middleM).toBeCloseTo(0.9, 6);
            const v = p.voices.find((x) => x.cue === 'safety.free') as VoicePlan;
            expect(v.dir).toEqual(FREE_DIRS[side]);
            expect(v.airDb).toBeUndefined();
            expect(v.lowpassHz).toBe(12000);
        }
    });

    it('an open side counts as free FREE_SPAN_MAX_M out: a box in a tall room puts the way\'s middle at most 0.9 m past the probe', () => {
        const tall = boxTunnel([block(-1.5, 1.5, 0, 1.8)], { min: [-1.5, 0, -200], max: [1.5, 30, 20] });
        const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), layers: { on: ['safety'], heightBandM: null, hazardVoices: 3 } });
        const p = planner.plan({ sample: { t: 0, tick: 0, pos: [0, 1.5, -3], vel: [0, 0, -3], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false }, world: tall, target: null, floorY: 0 });
        const w = p.freeWay as NonNullable<FramePlan['freeWay']>;
        expect(w.side).toBe('up');
        // the probe found the way 0.55 m up (its edge 0.25 m under the probe), nothing above within the cap
        expect(w.offsetM).toBeCloseTo(0.55, 9);
        expect(w.middleM).toBeCloseTo(0.55 + (FREE_SPAN_MAX_M - 0.25) / 2, 6);
    });

    it('in tunnel-gaps: above for the way above and below for the way below, ahead, at every frame; left and right as in v0.13', () => {
        const rs = flown('tunnel-gaps-soft', true);
        let up = 0, down = 0;
        for (const r of rs) {
            for (const v of r.plan.voices.filter((x) => x.cue === 'safety.free')) {
                const side = v.key.split(':')[1] as FreeSide;
                if (side === 'up') {
                    up++;
                    expect(v.dir[1]).toBeGreaterThan(0.1);
                } else if (side === 'down') {
                    down++;
                    expect(v.dir[1]).toBeLessThan(-0.1);
                } else expect(v.dir).toEqual(FREE_DIRS[side]);
                expect(v.dir[2]).toBeLessThan(0);
            }
        }
        expect(up).toBeGreaterThan(30);
        expect(down).toBeGreaterThan(30);
    });

    it('the named chime (an intro\'s cue from up or down, the glossary\'s preview) comes from 30 degrees above or below ahead', () => {
        const planner = new CuePlanner({ theme: getBuiltinTheme('soft') });
        const dirOf = (e: CueEvent, at: number): Vec3 => {
            planner.reset();
            planner.cue(e, 0);
            const p = planner.plan({ sample: { t: at, tick: at, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false }, world: null, target: null, floorY: 0 });
            return (p.voices.find((v) => v.cue === 'safety.free') as VoicePlan).dir;
        };
        expect(dirOf({ kind: 'repeat-cue', cue: 'safety.free', dir: [0, 1, 0], durS: 2.5 }, 100)).toEqual(FREE_PREVIEW_DIRS.up);
        expect(dirOf({ kind: 'repeat-cue', cue: 'safety.free', dir: [0, -1, 0], durS: 2.5 }, 100)).toEqual(FREE_PREVIEW_DIRS.down);
        expect(FREE_PREVIEW_DIRS.up[1]).toBeCloseTo(0.5, 9);
        // the glossary's preview with no direction: the four sides in turn, above and below from above and below
        expect(dirOf({ kind: 'preview', cue: 'safety.free', dir: null }, 1600)).toEqual(FREE_PREVIEW_DIRS.up);
        expect(dirOf({ kind: 'preview', cue: 'safety.free', dir: null }, 2400)).toEqual(FREE_PREVIEW_DIRS.down);
        expect(dirOf({ kind: 'preview', cue: 'safety.free', dir: null }, 100)).toEqual(FREE_DIRS.left);
    });
});

describe('the target note comes from the target', () => {
    it('rings-heights: from the next ring\'s centre, above it when the ring is higher and below when it is lower', () => {
        const rs = flown('rings-heights', true);
        let above = 0, below = 0;
        for (const r of rs) {
            const t = r.plan.height?.target ?? null;
            if (t === null) continue;
            const dir = t.dir as Vec3;
            expect(Math.hypot(...dir)).toBeCloseTo(1, 9);
            const hum = r.plan.voices.find((v) => v.cue === 'target.hum') as VoicePlan;
            // the ring's centre, where the hum comes from too (the same listener frame)
            for (let a = 0; a < 3; a++) expect(dir[a] as number).toBeCloseTo(hum.dir[a] as number, 9);
            const dy = r.plan.height!.target!.heightM - (r.pos[1] - 0);
            if (dy > 0.05) {
                above++;
                expect(dir[1]).toBeGreaterThan(0);
            } else if (dy < -0.05) {
                below++;
                expect(dir[1]).toBeLessThan(0);
            }
        }
        expect(above).toBeGreaterThan(50);
        expect(below).toBeGreaterThan(50);
    });

    it(`hover-height: from the band's middle ${TARGET_AHEAD_M} m ahead, whichever way the craft faces`, () => {
        const rs = flown('hover-height', true);
        for (const r of rs) {
            const t = r.plan.height?.target ?? null;
            expect(t).not.toBeNull();
            const dh = 2.5 - r.pos[1];
            const want = [0, dh, -TARGET_AHEAD_M].map((x) => x / Math.hypot(dh, TARGET_AHEAD_M));
            for (let a = 0; a < 3; a++) expect((t!.dir as Vec3)[a] as number).toBeCloseTo(want[a] as number, 9);
        }
        // 0.3 m under the middle: 8.5 degrees up; 0.9 m over it: 24 degrees down
        const at = (h: number): Vec3 => (rs.find((r) => Math.abs(r.pos[1] - h) < 1e-9)?.plan.height?.target?.dir ?? [0, 0, 0]) as Vec3;
        expect(Math.asin(at(2.2)[1]) * (180 / Math.PI)).toBeCloseTo(8.53, 1);
        expect(Math.asin(at(3.4)[1]) * (180 / Math.PI)).toBeCloseTo(-24.23, 1);
        expect(at(2.5)).toEqual([0, 0, -1]);
    });

    it('the glossary\'s preview: from above while the tone climbs to it, ahead when it is there; from below with the polarity turned over', () => {
        const dirs = (prefs: SonicPrefs): number[] => {
            const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs });
            planner.cue({ kind: 'preview', cue: 'height.target', dir: null }, 0);
            const out: number[] = [];
            for (const t of [0, 500, 1000, 1500, 2000, 2600]) {
                const p = planner.plan({ sample: { t, tick: t, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false }, world: null, target: null, floorY: 0 });
                out.push(((p.height?.target?.dir ?? [0, 0, 0]) as Vec3)[1]);
            }
            return out;
        };
        const up = dirs(defaultPrefs());
        expect(up[0]).toBeGreaterThan(0.4);
        for (let i = 1; i < up.length; i++) expect(up[i] as number).toBeLessThanOrEqual((up[i - 1] as number) + 1e-12);
        expect(up[up.length - 1]).toBeCloseTo(0, 9);
        const flipped = dirs({ ...defaultPrefs(), heightPolarity: 'up-lower' });
        expect(flipped[0]).toBeLessThan(-0.4);
    });
});

describe('the floor and the ceiling', () => {
    it('come from below and above as in v0.13, with the breath when the setting is on', () => {
        const on = flown('walls-hall-floor-ceiling', true);
        const off = flown('walls-hall-floor-ceiling', false);
        const floor = voices(on, 'safety.floor');
        const ceiling = voices(on, 'safety.ceiling');
        expect(floor.length).toBeGreaterThan(100);
        expect(ceiling.length).toBeGreaterThan(100);
        for (const v of floor) expect(v.dir[1]).toBeLessThan(-0.5);
        for (const v of ceiling) expect(v.dir[1]).toBeGreaterThan(0.5);
        expect(voices(off, 'safety.floor').map((v) => v.dir)).toEqual(floor.map((v) => v.dir));
        expect(new Set(floor.map((v) => v.airDb))).toEqual(new Set([ELEVATION_AIR_DB]));
        expect(new Set(voices(off, 'safety.ceiling').map((v) => v.airDb))).toEqual(new Set([undefined]));
    });
});

describe('the target of a gate lesson is the gate, a band\'s is ahead (the target object\'s shape decides)', () => {
    it('a zone as the target (move-stop) is no height: no note, so no direction', () => {
        const zone: SonicObject = { id: 'z', shape: { kind: 'zone', size: [2, 2, 2] }, pos: [0, 1, -7], quat: [1, 0, 0, 0], order: null, solid: false, material: 'obstacle' };
        const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), layers: { on: ['height'], heightBandM: null, hazardVoices: 0 } });
        const p = planner.plan({ sample: { t: 0, tick: 0, pos: [0, 1, 0], vel: [0, 0, 0], quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false }, world: null, target: zone, floorY: 0 });
        expect(p.height?.target).toBeNull();
    });
});
