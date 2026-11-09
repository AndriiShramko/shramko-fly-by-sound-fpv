// K1 of the simulator's v0.13 review (lane s13-int): a craft flying dead ahead at a wall sees its two front-side sectors
// (front-left, front-right) tie. Live, a yaw far below what a recording keeps (the quaternion to 1e-4) broke the tie to
// one side; the replay of the rounded frame saw it exact and broke it by the order of SECTORS, to the other: 28 frames of
// 'safety.wall:front-right' live against 'safety.wall:front-left' in the replay, 83.7 % of the sounds the same, and the
// recording read FAIL (the simulator's sonic-v13-page F2, a straight flight). The sampler now treats two mirror sectors
// within MIRROR_DEAD_BAND of each other as one tie, live and in the replay alike; the control is the rule before it
// (mirrorDeadBand 0).
import { describe, expect, it } from 'vitest';
import {
    createSceneSampler,
    DEFAULT_SAMPLER_CONFIG,
    MIRROR_DEAD_BAND,
    MIRROR_PAIRS,
    mirrorTie,
    riskOf,
    SamplerConfigError,
    SECTORS,
    type FlightSample,
    type Quat,
    type SamplerOptions,
    type SectorId,
    type SonicWorld,
    type Vec3
} from '../src';
import { roundFrame } from '../src/session/codec';

const DEG = Math.PI / 180;
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A world of infinite planes `dot(n, x) = d`, n pointing to the free side (as test/sense.test.ts). */
function planeWorld(planes: { n: Vec3; d: number }[]): SonicWorld {
    return {
        kind: 'analytic',
        id: 'planes',
        version: 1,
        bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
        objects: () => [],
        castRay(o, dir, maxDist) {
            let best: { t: number; n: Vec3 } | null = null;
            for (const p of planes) {
                const denom = dot(p.n, dir);
                if (denom >= -1e-12) continue;
                const t = (p.d - dot(p.n, o)) / denom;
                if (t < 0 || t > maxDist) continue;
                if (best === null || t < best.t) best = { t, n: p.n };
            }
            if (best === null) return null;
            return { distance: best.t, point: [o[0] + dir[0] * best.t, o[1] + dir[1] * best.t, o[2] + dir[2] * best.t], normal: best.n, material: 'wall', objectId: null };
        }
    };
}

/** A room 6 m wide and 3 m high, its front wall 8 m ahead of the craft (dead ahead on its axis, x = 0). */
const ROOM = planeWorld([
    { n: [0, 0, 1], d: -8 },
    { n: [1, 0, 0], d: -3 },
    { n: [-1, 0, 0], d: -3 },
    { n: [0, 1, 0], d: 0 },
    { n: [0, -1, 0], d: -3 }
]);

/** The quaternion of a yaw (degrees, right positive: the nose from -Z toward +X), body to world. */
function yawQuat(yawDeg: number): Quat {
    const a = -yawDeg * DEG;
    return [Math.cos(a / 2), 0, Math.sin(a / 2), 0];
}

/** The craft at `t` ms flying at 3 m/s toward the front wall from z = 0, its nose `yawDeg` off the axis. */
function sample(t: number, yawDeg: number, x = 0): FlightSample {
    const z = -3 * (t / 1000);
    return { t, tick: t, pos: [x, 1.5, z], vel: [0, 0, -3], quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

/**
 * The same sample after a recording's round trip (src/session/codec.ts: the position to the millimetre, the quaternion to
 * 1e-4), its yaw worked out again from the rounded quaternion as the replay does (src/replay/frames.ts).
 */
function recorded(s: FlightSample): FlightSample {
    const f = roundFrame({ t: s.t, tick: s.tick, p: s.pos, v: s.vel, q: s.quat, s: s.sticks, c: [] });
    const [w, x, y, z] = f.q;
    const r02 = 2 * (x * z + w * y);
    const r22 = 1 - 2 * (x * x + y * y);
    return { ...s, pos: f.p, vel: f.v, quat: f.q, yawDeg: Math.atan2(-r02, r22) / DEG };
}

/**
 * Flies the approach live (60 Hz) and as its replay (every second frame, rounded): the hazard sectors voiced at each
 * replayed frame, live and replayed, with two voices (the front and one more, as rings-first's layers).
 */
function flown(yawDeg: number, options: SamplerOptions = {}): { live: string[]; replay: string[] } {
    const live = createSceneSampler({ maxVoices: 2, ...options });
    const replay = createSceneSampler({ maxVoices: 2, ...options });
    const out = { live: [] as string[], replay: [] as string[] };
    for (let k = 0; k * 1000 / 60 < 2400; k++) {
        const t = Math.round((k * 1000) / 60);
        const s = sample(t, yawDeg);
        const l = live.sample(s, ROOM).hazards.map((h) => h.sector).join(',');
        if (k % 2 !== 0) continue;
        out.live.push(l);
        out.replay.push(replay.sample(recorded(s), ROOM).hazards.map((h) => h.sector).join(','));
    }
    return out;
}

const sides = (list: readonly string[]): string[] => [...new Set(list.flatMap((x) => x.split(',')).filter((x) => x === 'front-left' || x === 'front-right'))];
const differing = (r: { live: string[]; replay: string[] }): number => r.live.filter((x, i) => x !== r.replay[i]).length;

/** A yaw a recording keeps as none: 1e-5 rad, its quaternion's y 5e-6, rounded to 0. */
const UNDER_ROUNDING_DEG = 1e-5 / DEG;

describe('K1: a wall dead ahead, live and in the replay of its recording', () => {
    it('a yaw under the recording\'s rounding is no yaw to the replay: the rounded frame flies exactly on the axis', () => {
        for (const yaw of [UNDER_ROUNDING_DEG, -UNDER_ROUNDING_DEG]) expect(Math.abs(recorded(sample(1000, yaw)).yawDeg)).toBe(0);
    });

    it('with the dead band: live and the replay voice the same sectors at every frame, the front and front-left (the order of SECTORS), whichever way the yaw under the rounding goes', () => {
        for (const yaw of [UNDER_ROUNDING_DEG, -UNDER_ROUNDING_DEG, 0]) {
            const r = flown(yaw);
            expect(differing(r), `yaw ${yaw}`).toBe(0);
            expect(sides(r.live), `yaw ${yaw}`).toEqual(['front-left']);
            // the wall is voiced at all: the approach reaches the onset
            expect(r.live.filter((x) => x.includes('front-left')).length, `yaw ${yaw}`).toBeGreaterThan(20);
        }
    });

    it('control, the rule before (no dead band): the same yaw to the right of the axis voices front-right live and front-left in the replay, frame after frame', () => {
        const r = flown(-UNDER_ROUNDING_DEG, { mirrorDeadBand: 0 });
        expect(sides(r.live)).toEqual(['front-right']);
        expect(sides(r.replay)).toEqual(['front-left']);
        expect(differing(r)).toBeGreaterThan(20);
        // and to the left it happens to agree (the order of SECTORS breaks the replay's tie the same way)
        expect(differing(flown(UNDER_ROUNDING_DEG, { mirrorDeadBand: 0 }))).toBe(0);
    });

    it('the band is wide enough: the recording\'s rounding (a yaw of up to 0.0115 degrees) moves the two risks apart by under 0.05 %, 40 times under the band', () => {
        const s = createSceneSampler();
        let worst = 0;
        for (const yaw of [0.0115, -0.0115, 0.005]) {
            for (const t of [600, 1200, 1800]) {
                const read = s.sample(sample(t, yaw), ROOM).sectors;
                const risk = (id: SectorId): number => {
                    const r = read.find((x) => x.sector === id)!;
                    return riskOf(r.distance, r.ttcS, DEFAULT_SAMPLER_CONFIG.enterDistM[id], DEFAULT_SAMPLER_CONFIG.enterTtcS);
                };
                const a = risk('front-left');
                const b = risk('front-right');
                worst = Math.max(worst, Math.abs(a - b) / Math.max(a, b));
            }
        }
        expect(worst).toBeGreaterThan(0);
        expect(worst).toBeLessThan(0.0005);
        expect(worst * 40).toBeLessThan(MIRROR_DEAD_BAND);
    });

    it('a real yaw beyond the band is still a side: 3 degrees to the right of the axis voices the front-left sector, which faces the wall more squarely, live and in the replay', () => {
        const r = flown(3);
        expect(differing(r)).toBe(0);
        expect(sides(r.live)).toEqual(['front-left']);
        const l = flown(-3);
        expect(differing(l)).toBe(0);
        expect(sides(l.live)).toEqual(['front-right']);
    });

    it('a voice keeps its own urgency (its loudness): only its rank and its turning on and off take the tie', () => {
        const s = createSceneSampler({ maxVoices: 3 });
        let h = s.sample(sample(0, -0.3), ROOM);
        for (let t = 0; t <= 1500; t += 16) h = s.sample(sample(t, -0.3), ROOM);
        const read = (id: SectorId) => h.sectors.find((x) => x.sector === id)!;
        const own = (id: SectorId): number => riskOf(read(id).distance, read(id).ttcS, DEFAULT_SAMPLER_CONFIG.enterDistM[id], DEFAULT_SAMPLER_CONFIG.enterTtcS) * DEFAULT_SAMPLER_CONFIG.weight[id];
        const voiced = h.hazards.filter((x) => x.sector === 'front-left' || x.sector === 'front-right');
        expect(voiced.length).toBeGreaterThan(0);
        for (const v of voiced) expect(v.urgency).toBeCloseTo(own(v.sector), 12);
        // the two are within the band, and differ: the tie is the rank's, not the voice's
        expect(own('front-left')).not.toBe(own('front-right'));
    });
});

describe('K1: the tie itself', () => {
    const at = (id: SectorId): number => SECTORS.indexOf(id);

    it('the mirror pairs: left and right of the axis ahead, above and below it, each pair one weight', () => {
        expect(MIRROR_PAIRS.map((p) => p.join('|'))).toEqual(['front-left|front-right', 'left|right', 'front-up|front-down', 'up|down']);
        for (const [a, b] of MIRROR_PAIRS) expect(DEFAULT_SAMPLER_CONFIG.weight[a]).toBe(DEFAULT_SAMPLER_CONFIG.weight[b]);
    });

    it('within the band both take the higher risk; beyond it, or with one of them clear, each keeps its own', () => {
        const risk = new Array(SECTORS.length).fill(0);
        risk[at('front-left')] = 1;
        risk[at('front-right')] = 1.019;
        risk[at('left')] = 0.5;
        risk[at('right')] = 0.6;
        risk[at('up')] = 0.7;
        const tied = mirrorTie(risk, 0.02);
        expect(tied[at('front-left')]).toBe(1.019);
        expect(tied[at('front-right')]).toBe(1.019);
        expect(tied[at('left')]).toBe(0.5);
        expect(tied[at('right')]).toBe(0.6);
        expect(tied[at('up')]).toBe(0.7);
        expect(tied[at('down')]).toBe(0);
        expect(mirrorTie(risk, 0)).toEqual(risk);
    });

    it('two tied sectors turn on together: one at risk 1.01, its mirror at 0.995, both sound', () => {
        const world: SonicWorld = {
            kind: 'analytic',
            id: 'two',
            version: 1,
            bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
            objects: () => [],
            castRay(o, dir, maxDist) {
                // only the left and right sectors' axis rays meet a wall: the left 0.8 / 1.01 m from the hull, the right 0.8 / 0.995 m
                // (the distance rule's risks 1.01 and 0.995)
                const side = dir[0] < -0.99 ? 0.8 / 1.01 : dir[0] > 0.99 ? 0.8 / 0.995 : null;
                if (side === null) return null;
                const tt = side + 0.12;
                if (tt > maxDist) return null;
                return { distance: tt, point: [o[0] + dir[0] * tt, o[1], o[2]], normal: [-Math.sign(dir[0]), 0, 0], material: 'wall', objectId: null };
            }
        };
        const still: FlightSample = { ...sample(0, 0), vel: [0, 0, 0] };
        const on = createSceneSampler().sample(still, world).hazards.map((h) => h.sector);
        expect(on).toEqual(['left', 'right']);
        const before = createSceneSampler({ mirrorDeadBand: 0 }).sample(still, world).hazards.map((h) => h.sector);
        expect(before).toEqual(['left']);
    });

    it.each([[-0.01], [0.21], [Number.NaN]])('the band is checked: %s is refused', (band) => {
        expect(() => createSceneSampler({ mirrorDeadBand: band })).toThrow(SamplerConfigError);
    });
});
