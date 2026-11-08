// The free way around an obstacle ahead (v0.13, M41-14, owner's message 41): when an obstacle ahead is
// closer than about 3 s, an "open way" chime comes from the free side: left and right by its direction
// (HRTF), above and below by its pitch (high = above), because HRTF elevation fails for most heads.
// Worlds here are tunnels of boxes with exact ray casts. Controls: a closed tunnel gives no chime, and a
// gap on the left never gives a right chime.
import { describe, expect, it } from 'vitest';
import type { FlightSample, SonicObject, SonicPrefs, SonicWorld, Vec3 } from '../src/contract';
import { CuePlanner, FREE_DIRS, type FramePlan, type VoicePlan } from '../src/cues';
import { defaultPrefs } from '../src/prefs';
import { createSceneSampler, findFreeWay, FREE_PROBES_V013_FIRST, FREE_TTC_S, sideOrder, type FreeSide, type FreeWayOptions } from '../src/sense';
import { BUILTIN_THEME_IDS, getBuiltinTheme, isInScale } from '../src/theme';
import { yawQuat } from '../src/util/vec';
import { createAnalyticWorld, makeSpec } from '../src/world';
import { block, boxTunnel } from './helpers/boxes';

// a 3 x 3 m tunnel; the obstacle 6 to 8 m ahead of a craft at z = 0, leaving one way 1.2 m wide
const WORLDS: Readonly<Record<FreeSide | 'closed', SonicWorld>> = {
    up: boxTunnel([block(-1.5, 1.5, 0, 1.8)]),
    down: boxTunnel([block(-1.5, 1.5, 1.2, 3)]),
    left: boxTunnel([block(-0.3, 1.5, 0, 3)]),
    right: boxTunnel([block(-1.5, 0.3, 0, 3)]),
    closed: boxTunnel([block(-1.5, 1.5, 0, 3)])
};

function flight(pos: Vec3, vel: Vec3, t = 0): FlightSample {
    return { t, tick: Math.round(t), pos, vel, quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

const SAFETY = { on: ['safety'] as const, heightBandM: null, hazardVoices: 3 };

/** Flies the tunnel straight at `speed` from z = 0 for `seconds` (60 frames a second); every frame's plan. */
function fly(world: SonicWorld, speed: number, options: { pos?: Vec3; drift?: Vec3; seconds?: number; prefs?: SonicPrefs; theme?: string } = {}): FramePlan[] {
    const planner = new CuePlanner({ theme: getBuiltinTheme((options.theme ?? 'soft') as 'soft'), prefs: options.prefs ?? defaultPrefs(), layers: SAFETY });
    const start = options.pos ?? [0, 1.5, 0];
    const drift = options.drift ?? [0, 0, 0];
    const out: FramePlan[] = [];
    const frames = Math.round((options.seconds ?? 1.6) * 60);
    for (let k = 0; k < frames; k++) {
        const s = k / 60;
        const pos: Vec3 = [start[0] + drift[0] * s, start[1] + drift[1] * s, start[2] - speed * s];
        out.push(planner.plan({ sample: flight(pos, [drift[0], drift[1], -speed], s * 1000), world, target: null, floorY: 0 }));
    }
    return out;
}

const chimes = (plans: readonly FramePlan[]): VoicePlan[] => plans.flatMap((p) => p.voices.filter((v) => v.cue === 'safety.free'));
const sides = (plans: readonly FramePlan[]): Set<string> => new Set(plans.map((p) => p.freeWay?.side).filter((x): x is FreeSide => x !== undefined));

describe('the open way is found on the free side', () => {
    it.each(['up', 'down', 'left', 'right'] as const)('a gap %s: the chime names that side and no other', (side) => {
        const plans = fly(WORLDS[side], 3);
        expect([...sides(plans)]).toEqual([side]);
        expect(chimes(plans).length).toBeGreaterThan(0);
        for (const p of plans) {
            const c = p.cues.find((x) => x.id.startsWith('safety.free'));
            if (c !== undefined) expect(c.id).toBe(`safety.free:${side}`);
        }
    });

    it('control: a closed tunnel gives no chime (the knocks of the obstacle still sound)', () => {
        const plans = fly(WORLDS.closed, 3);
        expect(chimes(plans)).toEqual([]);
        expect(sides(plans).size).toBe(0);
        expect(plans.some((p) => p.voices.some((v) => v.key.startsWith('safety:') && v.cue === 'safety.obstacle'))).toBe(true);
    });

    it('control: a gap on the left never gives a right chime, wherever the craft is in the tunnel and whichever way it drifts', () => {
        let found = 0;
        for (const x of [-0.6, 0, 0.6]) {
            for (const y of [1, 1.5, 2]) {
                for (const drift of [[0.6, 0, 0], [-0.6, 0, 0], [0, 0.4, 0], [0, 0, 0]] as Vec3[]) {
                    const plans = fly(WORLDS.left, 2.5, { pos: [x, y, 0], drift, seconds: 1.8 });
                    for (const s of sides(plans)) expect(s, `x ${x} y ${y} drift ${drift.join(',')}`).toBe('left');
                    found += chimes(plans).length;
                }
            }
        }
        expect(found).toBeGreaterThan(0);
    });

    it('only when the obstacle is under about 3 s ahead: slow flight far from it gives none', () => {
        const slow = fly(WORLDS.left, 0.5, { seconds: 2 }); // 6 m at 0.5 m/s: 12 s
        expect(chimes(slow)).toEqual([]);
        // on the way in at 3 m/s from 12 m (4 s) it starts once the time to contact is under 3 s
        const plans = fly(WORLDS.left, 3, { pos: [0, 1.5, 6], seconds: 2.6 });
        const first = plans.findIndex((p) => p.freeWay !== null);
        expect(first).toBeGreaterThan(0);
        expect(plans[first]!.freeWay!.ttcS).toBeLessThan(FREE_TTC_S);
        expect(plans[first]!.freeWay!.ttcS).toBeGreaterThan(FREE_TTC_S - 0.1);
    });
});

describe('the chime: left and right by direction, above and below by pitch', () => {
    const at = (side: FreeSide, prefs = defaultPrefs(), theme = 'soft'): VoicePlan => {
        const v = chimes(fly(WORLDS[side], 3, { prefs, theme }))[0];
        expect(v, side).toBeDefined();
        return v as VoicePlan;
    };

    it('comes from the left for a left gap and from the right for a right one; up and down come from ahead', () => {
        expect(at('left').dir[0]).toBeLessThan(-0.5);
        expect(at('right').dir[0]).toBeGreaterThan(0.5);
        for (const side of ['up', 'down'] as const) {
            expect(at(side).dir).toEqual(FREE_DIRS[side]);
            expect(Math.abs(at(side).dir[1])).toBe(0); // no HRTF elevation to rely on
        }
    });

    it('is higher for a way above and lower for one below, turned over with the polarity; every note on the scale', () => {
        for (const id of BUILTIN_THEME_IDS) {
            const theme = getBuiltinTheme(id);
            const side = at('left', defaultPrefs(), id).hz;
            expect(at('right', defaultPrefs(), id).hz).toBe(side);
            expect(at('up', defaultPrefs(), id).hz).toBeGreaterThan(side);
            expect(at('down', defaultPrefs(), id).hz).toBeLessThan(side);
            const flipped = { ...defaultPrefs(), heightPolarity: 'up-lower' as const };
            expect(at('up', flipped, id).hz).toBeLessThan(side);
            expect(at('down', flipped, id).hz).toBeGreaterThan(side);
            for (const s of ['left', 'up', 'down'] as const) {
                const v = at(s, defaultPrefs(), id);
                expect(isInScale(theme.scale, v.hz)).toBe(true);
                expect(isInScale(theme.scale, v.harmonyHz as number)).toBe(true);
                expect(v.harmonyHz as number).toBeGreaterThan(v.hz);
            }
        }
    });

    it('repeats at the theme period (slower in calm) and keeps the hazard voices: they outrank it', () => {
        const v = at('left');
        expect(v.periodS).toBeCloseTo(0.6, 9);
        expect(at('left', { ...defaultPrefs(), calm: true }).periodS!).toBeGreaterThan(v.periodS!);
        const plans = fly(WORLDS.left, 3);
        for (const p of plans) {
            const free = p.voices.find((x) => x.cue === 'safety.free');
            const hazards = p.voices.filter((x) => x.key.startsWith('safety:'));
            if (free !== undefined) for (const h of hazards) expect(h.priority).toBeGreaterThan(free.priority);
        }
    });
});

describe('the glossary preview of the open way', () => {
    it('with no direction plays the four sides in turn; with one, that side', () => {
        const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), layers: { on: [], heightBandM: null, hazardVoices: 0 } });
        planner.cue({ kind: 'preview', cue: 'safety.free', dir: null }, 0);
        const seen: string[] = [];
        for (let t = 0; t < 3000; t += 50) {
            const v = planner.plan({ sample: flight([0, 0, 0], [0, 0, 0], t), world: null, target: null, floorY: 0 }).voices.find((x) => x.cue === 'safety.free');
            if (v !== undefined && seen.at(-1) !== v.key.split(':').at(-1)) seen.push(v.key.split(':').at(-1) as string);
        }
        expect(seen).toEqual(['left', 'right', 'up', 'down']);
        const one = new CuePlanner({ theme: getBuiltinTheme('soft'), layers: { on: [], heightBandM: null, hazardVoices: 0 } });
        one.cue({ kind: 'preview', cue: 'safety.free', dir: [0, 1, 0] }, 0);
        const up = one.plan({ sample: flight([0, 0, 0], [0, 0, 0], 100), world: null, target: null, floorY: 0 }).voices.find((x) => x.cue === 'safety.free');
        expect(up!.key.endsWith(':up')).toBe(true);
    });
});

describe('the probes', () => {
    it('look for the preferred side first, then the side of the drift, then left, right, up, down', () => {
        expect(sideOrder([0, 0, -3], null)).toEqual(['left', 'right', 'up', 'down']);
        expect(sideOrder([0.5, 0, -3], null)).toEqual(['right', 'left', 'up', 'down']);
        expect(sideOrder([0, -0.5, -3], 'up')).toEqual(['up', 'down', 'left', 'right']);
    });

    it('find nothing with no world, nothing ahead, or nothing closing', () => {
        const sampler = createSceneSampler();
        const still = flight([0, 1.5, 0], [0, 0, 0]);
        expect(sampler.sample(still, WORLDS.left).hazards).toEqual([]);
        expect(findFreeWay(still, WORLDS.left, 'heading', { bodyRadiusM: 0.12 })).toBeNull();
        const moving = flight([0, 1.5, 0], [0, 0, -3]);
        expect(findFreeWay(moving, null, 'heading', { bodyRadiusM: 0.12 })).toBeNull();
        expect(findFreeWay(moving, WORLDS.left, 'heading', { bodyRadiusM: 0.12 })!.side).toBe('left');
        // a side wall the craft drifts toward is not an obstacle ahead: the probe looks along the nose
        const drifting = flight([-1, 1.5, 0], [-1, 0, -0.3]);
        expect(findFreeWay(drifting, boxTunnel([]), 'heading', { bodyRadiusM: 0.12 })).toBeNull();
    });

    it('a gap too narrow for the hull is no way (control for the width check)', () => {
        const narrow = boxTunnel([block(-1.5, -0.89, 0, 3), block(-0.63, 1.5, 0, 3)]); // a 0.26 m slot at x = -0.76: the hull and 1 cm
        const plans = fly(narrow, 3);
        expect(chimes(plans)).toEqual([]);
    });
});

// Review M1: the first probes began 0.7 m off the craft's line with a half width of 0.2 m, so a way had to reach
// 0.9 m from the line: in tunnels under about 2 m wide the obstacle knocked and no chime came.
describe('narrow tunnels: the way is found wherever the craft is in the tunnel', () => {
    /** A tunnel `w` wide and `h` high with an obstacle 6 to 8 m ahead that leaves a way `gap` across on `side`. */
    const narrowTunnel = (w: number, h: number, side: FreeSide | 'closed', gap: number): SonicWorld => {
        const x0 = -w / 2, x1 = w / 2;
        const b = side === 'left' ? block(x0 + gap, x1, 0, h) : side === 'right' ? block(x0, x1 - gap, 0, h) : side === 'up' ? block(x0, x1, 0, h - gap) : side === 'down' ? block(x0, x1, gap, h) : block(x0, x1, 0, h);
        return boxTunnel([b], { min: [x0, 0, -200], max: [x1, h, 20] });
    };
    const CASES: readonly (readonly [number, number, number])[] = [
        [2, 2, 0.8],
        [1.6, 2, 0.6],
        [1.2, 1.5, 0.5]
    ];
    /**
     * Three places across the tunnel where the obstacle is straight ahead (elsewhere nothing is ahead and no chime is
     * due): 0.15 m inside its edge by the way, its middle, and 0.2 m from the far wall, across the way's own axis.
     */
    const starts = (w: number, h: number, side: FreeSide, gap: number): Vec3[] => {
        const span = side === 'left' || side === 'right' ? w : h;
        const lo = side === 'left' || side === 'down' ? gap : 0;
        const hi = side === 'left' || side === 'down' ? span : span - gap;
        const near = side === 'left' || side === 'down' ? lo + 0.15 : hi - 0.15;
        const far = side === 'left' || side === 'down' ? hi - 0.2 : lo + 0.2;
        const across = [near, (lo + hi) / 2, far];
        return side === 'left' || side === 'right' ? across.map((x): Vec3 => [x - w / 2, h / 2, 0]) : across.map((y): Vec3 => [0, y, 0]);
    };
    /** The sides findFreeWay names, frame by frame, flying straight at 3 m/s from `pos` (no hold, no planner). */
    const found = (world: SonicWorld, pos: Vec3, probes?: FreeWayOptions['probes']): Set<FreeSide> => {
        const out = new Set<FreeSide>();
        for (let k = 0; k < 120; k++) {
            const z = pos[2] - (3 * k) / 60;
            if (z < -5.7) break;
            const w = findFreeWay(flight([pos[0], pos[1], z], [0, 0, -3], (k * 1000) / 60), world, 'heading', { bodyRadiusM: 0.12, ...(probes === undefined ? {} : { probes }) });
            if (w !== null) out.add(w.side);
        }
        return out;
    };

    it.each(CASES)('a tunnel %s m wide and %s m high, a way of %s m on each side in turn: that side is named, never another', (w, h, gap) => {
        for (const side of ['left', 'right', 'up', 'down'] as const) {
            for (const pos of starts(w, h, side, gap)) {
                const plans = fly(narrowTunnel(w, h, side, gap), 3, { pos, seconds: 1.8 });
                expect([...sides(plans)], `${side} from ${pos.join(',')}`).toEqual([side]);
                expect(chimes(plans).length, `${side} from ${pos.join(',')}`).toBeGreaterThan(0);
            }
        }
    });

    it('control: the same tunnels closed give no chime', () => {
        for (const [w, h] of CASES) expect(chimes(fly(narrowTunnel(w, h, 'closed', 0), 3, { pos: [0, h / 2, 0], seconds: 1.8 }))).toEqual([]);
    });

    it('control: the first v0.13 probes (0.7 m out, 0.2 m half width) miss the ways of the 1.6 m and 1.2 m tunnels', () => {
        let missed = 0;
        let tried = 0;
        for (const [w, h, gap] of CASES.slice(1)) {
            for (const side of ['left', 'right', 'up', 'down'] as const) {
                const world = narrowTunnel(w, h, side, gap);
                tried++;
                if (found(world, [0, h / 2, 0], FREE_PROBES_V013_FIRST).size === 0) missed++;
                expect(found(world, [0, h / 2, 0]).has(side), `${w} m, ${side}`).toBe(true);
            }
        }
        expect(missed, `${missed} of ${tried} ways missed`).toBeGreaterThanOrEqual(6);
    });
});

// Review m1: the trigger took any hit, so flying at a ring's tube gave a chime that could point outside the ring.
describe('a gate ahead gives no open-way chime: the target layer leads through it', () => {
    const rings = createAnalyticWorld(makeSpec('rings', { layout: 'single', aheadM: 12, sizeM: 3 }, 1));
    const ring = rings.objects().find((o) => o.order !== null) as SonicObject;
    const tube = (ring.shape as { diameter: number }).diameter / 2;
    /** Flies at 3 m/s at the ring's height from 6 m before it, the nose at the left or the right tube. */
    const at = (world: SonicWorld, dx: number): FramePlan[] => fly(world, 3, { pos: [ring.pos[0] + dx, ring.pos[1], ring.pos[2] + 6], seconds: 1.7 });

    it('nose on the left or the right tube: no chime', () => {
        for (const dx of [-tube, tube]) {
            const plans = at(rings, dx);
            expect(plans.every((p) => p.freeWay === null), `dx ${dx}`).toBe(true);
        }
    });

    it('control: the same ring without a place in the course (an obstacle, not a gate) gives one', () => {
        const plain: SonicWorld = { ...rings, objects: () => rings.objects().map((o) => ({ ...o, order: null })) };
        expect(at(plain, -tube).some((p) => p.freeWay !== null)).toBe(true);
    });
});
