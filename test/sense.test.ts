import { describe, expect, it } from 'vitest';
import {
    createAnalyticWorld,
    createSceneSampler,
    DEFAULT_SAMPLER_CONFIG,
    headingBasis,
    listenerToWorld,
    makeSpec,
    MAX_HAZARD_VOICES,
    quatAxisAngle,
    SamplerConfigError,
    SECTOR_AXES,
    SECTORS,
    sectorRays,
    worldToListener,
    bodyBasis,
    createRng,
    type FlightSample,
    type MaterialClass,
    type SectorId,
    type SonicWorld,
    type Vec3
} from '../src';

const DEG = Math.PI / 180;

function flight(over: Partial<FlightSample> = {}): FlightSample {
    return { t: 0, tick: 0, pos: [0, 0, 0], vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false, ...over };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const close = (a: number, b: number, tol = 1e-6): void => {
    expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol);
};
const closeVec = (a: Vec3, b: Vec3, tol = 1e-6): void => {
    for (let i = 0; i < 3; i++) close(a[i] as number, b[i] as number, tol);
};

/** A world of infinite planes `dot(n, x) = d`, n pointing to the free side. */
function planeWorld(planes: { n: Vec3; d: number; material?: MaterialClass; id?: string }[]): SonicWorld {
    return {
        kind: 'analytic',
        id: 'planes',
        version: 1,
        bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
        objects: () => [],
        castRay(o, dir, maxDist) {
            let best: { t: number; p: (typeof planes)[number] } | null = null;
            for (const p of planes) {
                const denom = dot(p.n, dir);
                if (denom >= -1e-12) continue;
                const t = (p.d - dot(p.n, o)) / denom;
                if (t < 0 || t > maxDist) continue;
                if (best === null || t < best.t) best = { t, p };
            }
            if (best === null) return null;
            return { distance: best.t, point: [o[0] + dir[0] * best.t, o[1] + dir[1] * best.t, o[2] + dir[2] * best.t], normal: best.p.n, material: best.p.material ?? 'wall', objectId: best.p.id ?? null };
        }
    };
}

/**
 * A world that answers only the three rays of the sectors named, at a scripted distance along the
 * ray (the side rays a little further). Meant for a craft at yaw 0, where listener and world
 * directions are the same. It lets a test set each sector's distance on its own.
 */
function sectorWorld(distances: Partial<Record<SectorId, number>>, spreadDeg = DEFAULT_SAMPLER_CONFIG.spreadDeg): SonicWorld {
    const rays = sectorRays(spreadDeg);
    return {
        kind: 'analytic',
        id: 'scripted',
        version: 1,
        bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
        objects: () => [],
        castRay(o, dir, maxDist) {
            for (const id of SECTORS) {
                const d = distances[id];
                if (d === undefined) continue;
                const [centre, a, b] = rays[id];
                const extra = dot(dir, centre) > 1 - 1e-9 ? 0 : dot(dir, a) > 1 - 1e-9 || dot(dir, b) > 1 - 1e-9 ? 0.5 : -1;
                if (extra < 0) continue;
                const t = d + extra;
                if (t > maxDist) return null;
                return { distance: t, point: [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t], normal: [-dir[0], -dir[1], -dir[2]], material: 'wall', objectId: null };
            }
            return null;
        }
    };
}

describe('the ten sectors and their rays', () => {
    it('ten distinct unit axes with the directions the contract names', () => {
        expect(SECTORS).toHaveLength(10);
        closeVec(SECTOR_AXES.front, [0, 0, -1]);
        closeVec(SECTOR_AXES.back, [0, 0, 1]);
        closeVec(SECTOR_AXES.left, [-1, 0, 0]);
        closeVec(SECTOR_AXES.right, [1, 0, 0]);
        closeVec(SECTOR_AXES.up, [0, 1, 0]);
        closeVec(SECTOR_AXES.down, [0, -1, 0]);
        closeVec(SECTOR_AXES['front-left'], [-Math.SQRT1_2, 0, -Math.SQRT1_2]);
        closeVec(SECTOR_AXES['front-up'], [0, Math.SQRT1_2, -Math.SQRT1_2]);
        for (const a of SECTORS) {
            close(Math.hypot(...SECTOR_AXES[a]), 1);
            for (const b of SECTORS) if (a !== b) expect(dot(SECTOR_AXES[a], SECTOR_AXES[b])).toBeLessThan(1 - 1e-6);
        }
    });

    it('three unit rays per sector: the axis and two mirror images spread by the angle', () => {
        const rays = sectorRays(20);
        const all: Vec3[] = [];
        for (const id of SECTORS) {
            const [c, a, b] = rays[id];
            closeVec(c, SECTOR_AXES[id]);
            for (const r of [c, a, b]) {
                close(Math.hypot(...r), 1);
                all.push(r);
            }
            close(Math.acos(dot(c, a)) / DEG, 20, 1e-6);
            close(Math.acos(dot(c, b)) / DEG, 20, 1e-6);
            // the two side rays are mirror images across the axis: their sum points along it
            const sum: Vec3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
            close(dot(sum, c), Math.hypot(...sum), 1e-9);
        }
        expect(all).toHaveLength(30);
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(dot(all[i]!, all[j]!), `rays ${i} and ${j}`).toBeLessThan(1 - 1e-9);
    });
});

describe('the listener frame', () => {
    it('heading: yaw 0 faces -Z, yaw 90 faces +X, positive yaw turns right', () => {
        const b0 = headingBasis(0);
        closeVec(b0.right, [1, 0, 0]);
        closeVec(b0.back, [0, 0, 1]);
        const b90 = headingBasis(90);
        closeVec(listenerToWorld(b90, [0, 0, -1]), [1, 0, 0]); // the front
        closeVec(listenerToWorld(b90, [1, 0, 0]), [0, 0, 1]); // the right hand side
        closeVec(listenerToWorld(headingBasis(-90), [0, 0, -1]), [-1, 0, 0]);
    });

    it('world and listener vectors convert back and forth', () => {
        const rng = createRng(4);
        for (let i = 0; i < 50; i++) {
            const basis = headingBasis(rng.range(-180, 180));
            const v: Vec3 = [rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)];
            closeVec(worldToListener(basis, listenerToWorld(basis, v)), v, 1e-9);
            close(Math.hypot(...listenerToWorld(basis, v)), Math.hypot(...v), 1e-9);
        }
    });

    it('body equals heading for a level craft, and follows the tilt otherwise', () => {
        const level = bodyBasis([1, 0, 0, 0]);
        closeVec(level.back, headingBasis(0).back);
        const pitched = bodyBasis(quatAxisAngle([1, 0, 0], -45 * DEG)); // nose down 45
        closeVec(listenerToWorld(pitched, [0, 0, -1]), [0, -Math.SQRT1_2, -Math.SQRT1_2]);
    });
});

describe('a craft in the hall, in closed form', () => {
    const hall = createAnalyticWorld(makeSpec('hall')); // 40 x 60 x 12, the craft at the middle, 1.5 m up
    const r = DEFAULT_SAMPLER_CONFIG.bodyRadiusM;

    it('reads all ten sectors', () => {
        const s = createSceneSampler().sample(flight({ pos: hall.start.pos }), hall);
        const by = Object.fromEntries(s.sectors.map((x) => [x.sector, x]));
        expect(s.sectors.map((x) => x.sector)).toEqual([...SECTORS]);
        close(by.front!.distance, 30 - r, 1e-3);
        close(by.back!.distance, 30 - r, 1e-3);
        close(by.left!.distance, 20 - r, 1e-3);
        close(by.right!.distance, 20 - r, 1e-3);
        close(by.up!.distance, 10.5 - r, 1e-3);
        close(by.down!.distance, 1.5 - r, 1e-3);
        // diagonals: the side ray that looks most toward the wall is the nearest of the three
        close(by['front-left']!.distance, 20 / Math.sin(65 * DEG) - r, 1e-3);
        close(by['front-right']!.distance, 20 / Math.sin(65 * DEG) - r, 1e-3);
        close(by['front-up']!.distance, 10.5 / Math.SQRT1_2 - r, 1e-3);
        close(by['front-down']!.distance, 1.5 / Math.SQRT1_2 - r, 1e-3);
        for (const x of s.sectors) {
            expect(x.hit).toBe(true);
            expect(x.material).not.toBeNull();
            close(Math.hypot(...x.dir), 1, 1e-9);
        }
        expect(by.up!.material).toBe('ceiling');
        expect(by.down!.material).toBe('floor');
        expect(by.left!.material).toBe('wall');
        closeVec(by.left!.dir, [-1, 0, 0], 1e-6);
        closeVec(by.front!.dir, [0, 0, -1], 1e-6);
        expect(s.frame).toBe('heading');
    });

    it('turns with the craft: at yaw 90 the front is the +X wall', () => {
        const sampler = createSceneSampler();
        const s = sampler.sample(flight({ pos: hall.start.pos, yawDeg: 90 }), hall);
        const by = Object.fromEntries(s.sectors.map((x) => [x.sector, x]));
        close(by.front!.distance, 20 - r, 1e-3);
        close(by.back!.distance, 20 - r, 1e-3);
        close(by.right!.distance, 30 - r, 1e-3); // right of a craft facing +X is +Z
        close(by.left!.distance, 30 - r, 1e-3);
        // and the direction toward that wall is still straight ahead for the listener
        closeVec(by.front!.dir, [0, 0, -1], 1e-6);
        const m = createSceneSampler().sample(flight({ pos: hall.start.pos, yawDeg: -90 }), hall);
        close(m.sectors[0]!.distance, 20 - r, 1e-3);
    });

    it('the mean free distance is the mean of the sector distances', () => {
        const s = createSceneSampler().sample(flight({ pos: hall.start.pos }), hall);
        close(s.meanFreeDistanceM, s.sectors.reduce((a, x) => a + x.distance, 0) / 10, 1e-9);
        // a bigger room is more open
        const big = createAnalyticWorld(makeSpec('hall', { widthM: 100, depthM: 150, heightM: 40, startHeightM: 20 }));
        const open = createSceneSampler().sample(flight({ pos: big.start.pos }), big);
        expect(open.meanFreeDistanceM).toBeGreaterThan(s.meanFreeDistanceM * 1.5); // capped by the range of 40 m, so not by the full ratio
    });

    it('a pillar ahead becomes a hazard with its object id and the metal class', () => {
        const pillars = createAnalyticWorld(makeSpec('pillars')); // a pillar at z = 7
        const sampler = createSceneSampler();
        const far = sampler.sample(flight({ pos: [0, 5, 22], t: 0 }), pillars);
        expect(far.hazards).toEqual([]); // 14 m away and not moving
        const near = sampler.sample(flight({ pos: [0, 5, 10], t: 20 }), pillars); // 2.5 m from the pillar's axis
        const front = near.hazards.find((h) => h.sector === 'front')!;
        expect(front).toBeDefined();
        expect(front.objectId).toBe('pillar-1');
        expect(front.material).toBe('obstacle');
        close(front.distance, 3 - 0.5 - r, 1e-3);
    });

    it('tilt: the heading frame ignores it, the body frame follows it', () => {
        const world = planeWorld([
            { n: [0, 1, 0], d: 0, material: 'floor' },
            { n: [0, 0, 1], d: -20 }
        ]);
        const tilted = flight({ pos: [0, 5, 0], quat: quatAxisAngle([1, 0, 0], -45 * DEG), pitchDeg: 45 });
        const heading = createSceneSampler({ bodyRadiusM: 0 }).sample(tilted, world, 'heading');
        const body = createSceneSampler({ bodyRadiusM: 0 }).sample(tilted, world, 'body');
        close(heading.sectors[0]!.distance, 20, 1e-6); // looking level, the wall
        expect(heading.sectors[0]!.material).toBe('wall');
        close(body.sectors[0]!.distance, 5 / Math.SQRT1_2, 1e-6); // nose down 45: the floor, 7.07 m away
        expect(body.sectors[0]!.material).toBe('floor');
        expect(body.frame).toBe('body');
    });
});

describe('the nearest of the three rays', () => {
    it('a thing only a side ray sees sets the distance and the direction of its sector', () => {
        // a wall at x = 1.5 facing -X: the front sector's +20 degree ray meets it, the centre ray never does
        const world = planeWorld([
            { n: [-1, 0, 0], d: -1.5 },
            { n: [0, 0, 1], d: -10 }
        ]);
        const s = createSceneSampler({ bodyRadiusM: 0, spreadDeg: 20 }).sample(flight(), world);
        const front = s.sectors[0]!;
        const t = 1.5 / Math.sin(20 * DEG);
        close(front.distance, t, 1e-6);
        closeVec(front.dir, [Math.sin(20 * DEG), 0, -Math.cos(20 * DEG)], 1e-6);
        // the right sector's rays (spread along z) meet the same wall, the centre one head on
        close(s.sectors[3]!.distance, 1.5, 1e-6);
        closeVec(s.sectors[3]!.dir, [1, 0, 0], 1e-6);
    });

    it('with spread 0 the three rays are one', () => {
        const world = planeWorld([{ n: [0, 0, 1], d: -10 }]);
        const s = createSceneSampler({ bodyRadiusM: 0, spreadDeg: 0 }).sample(flight(), world);
        close(s.sectors[0]!.distance, 10);
    });
});

describe('closing speed and time to collision', () => {
    const wall = planeWorld([{ n: [0, 0, 1], d: -10 }]);
    const sampler = (): ReturnType<typeof createSceneSampler> => createSceneSampler({ bodyRadiusM: 0.12 });
    const front = (vel: Vec3) => sampler().sample(flight({ vel }), wall).sectors[0]!;

    it('flying at the wall: time is distance over closing speed', () => {
        const f = front([0, 0, -5]);
        close(f.distance, 9.88);
        close(f.closingMps, 5);
        close(f.ttcS!, 9.88 / 5);
    });

    it('only the part of the velocity toward the wall closes', () => {
        const f = front([3, 0, -4]);
        close(f.closingMps, 4);
        close(f.ttcS!, 9.88 / 4);
    });

    it('standing, backing away and creeping give no time', () => {
        for (const vel of [[0, 0, 0], [0, 0, 5], [0, 0, -0.1], [4, 0, 0]] as Vec3[]) {
            const f = front(vel);
            expect(f.ttcS, JSON.stringify(vel)).toBeNull();
        }
        close(front([0, 0, -0.1]).closingMps, 0.1);
        expect(front([0, 0, 5]).closingMps).toBe(0);
    });

    it('flying along a wall is not closing on it, whichever ray sees it', () => {
        const corridor = createAnalyticWorld(makeSpec('corridor', { layout: 'straight' })); // walls at x = +-2.5, the end wall at z = -102.5
        const along = sampler().sample(flight({ pos: [0, 2, -70], vel: [0, 0, -45] }), corridor); // 32.5 m from the end wall
        const by = Object.fromEntries(along.sectors.map((x) => [x.sector, x]));
        for (const id of ['left', 'right', 'front-left', 'front-right', 'up', 'down'] as const) {
            expect(by[id]!.ttcS, id).toBeNull();
            close(by[id]!.closingMps, 0, 1e-6);
        }
        close(by.front!.closingMps, 45, 1e-6);
        close(by.front!.ttcS!, (32.5 - 0.12) / 45, 1e-3);
        // drifting left at 1 m/s while flying on: the left sector, which faces the wall, has the surface time;
        // the front-left sector sees it at a slant (its best ray is 25 degrees off the wall's normal), so its
        // time is stretched by 1 / cos^2 25 and the wall is voiced from the left, not from ahead
        const drift = sampler().sample(flight({ pos: [0, 2, -70], vel: [-1, 0, -45] }), corridor);
        const d = Object.fromEntries(drift.sectors.map((x) => [x.sector, x]));
        close(d.left!.ttcS!, 2.38, 1e-3);
        close(d['front-left']!.ttcS!, 2.38 / Math.cos((25 * Math.PI) / 180) ** 2, 1e-3);
    });

    it('a wall approached sideways is voiced from its side, not by the front sector that grazes it', () => {
        const hall = createAnalyticWorld(makeSpec('hall', {}, 1)); // the left wall at x = -20
        const s = createSceneSampler({ bodyRadiusM: 0.12, maxVoices: 1 }).sample(flight({ pos: [-14, 3, 0], vel: [-3, 0, 0] }), hall);
        expect(s.hazards[0]!.sector).toBe('left');
        expect(s.hazards[0]!.dir[0]).toBeLessThan(-0.99);
        // negative control: the front sector's side ray does see the same wall, at a slant
        const front = s.sectors.find((x) => x.sector === 'front')!;
        expect(front.hit).toBe(true);
        expect(front.ttcS === null || front.ttcS > s.sectors.find((x) => x.sector === 'left')!.ttcS! * 2).toBe(true);
    });

    it('a sector that sees nothing has no time and zero closing', () => {
        const s = sampler().sample(flight({ vel: [0, 0, -5] }), wall);
        const back = s.sectors[1]!;
        expect(back.hit).toBe(false);
        expect(back.ttcS).toBeNull();
        expect(back.closingMps).toBe(0);
        expect(back.distance).toBe(DEFAULT_SAMPLER_CONFIG.rangeM);
        closeVec(back.dir, SECTOR_AXES.back);
    });
});

describe('who becomes a hazard', () => {
    const none = { bodyRadiusM: 0 };

    it('near and still: a distance alone is enough (hovering under a ceiling)', () => {
        const s = createSceneSampler(none).sample(flight(), sectorWorld({ up: 1.0 }));
        expect(s.hazards.map((h) => h.sector)).toEqual(['up']);
        expect(s.hazards[0]!.ttcS).toBeNull();
        expect(s.hazards[0]!.material).toBe('wall'); // the scripted material
    });

    it('far but closing fast: a time alone is enough', () => {
        const fast = createSceneSampler(none).sample(flight({ vel: [0, 0, -10] }), sectorWorld({ front: 20 }));
        expect(fast.hazards.map((h) => h.sector)).toEqual(['front']);
        close(fast.hazards[0]!.ttcS!, 2);
        const slow = createSceneSampler(none).sample(flight({ vel: [0, 0, 0] }), sectorWorld({ front: 20 }));
        expect(slow.hazards).toEqual([]);
        const slowish = createSceneSampler(none).sample(flight({ vel: [0, 0, -5] }), sectorWorld({ front: 20 })); // 4 s away
        expect(slowish.hazards).toEqual([]);
    });

    it('nothing in range, no hazard; no world at all, ten clear sectors', () => {
        const s = createSceneSampler().sample(flight(), null);
        expect(s.hazards).toEqual([]);
        expect(s.sectors).toHaveLength(10);
        for (const x of s.sectors) {
            expect(x.hit).toBe(false);
            expect(x.distance).toBe(DEFAULT_SAMPLER_CONFIG.rangeM);
        }
        expect(s.meanFreeDistanceM).toBe(DEFAULT_SAMPLER_CONFIG.rangeM);
    });
});

describe('at most three hazard voices, by priority', () => {
    const all: Partial<Record<SectorId, number>> = Object.fromEntries(SECTORS.map((id) => [id, 1])) as Partial<Record<SectorId, number>>;

    it('ten hazards, three voices: the most urgent, ahead before behind', () => {
        const sampler = createSceneSampler({ bodyRadiusM: 0 });
        const s = sampler.sample(flight(), sectorWorld(all));
        expect(s.hazards).toHaveLength(3);
        expect(s.hazards.map((h) => h.sector)).toEqual(['front', 'front-left', 'front-right']);
        expect(s.hazards.map((h) => h.rank)).toEqual([0, 1, 2]);
        expect(s.hazards[0]!.urgency).toBeGreaterThan(s.hazards[1]!.urgency);
    });

    it('priority weights put ahead over behind at the same distance', () => {
        const s = createSceneSampler({ bodyRadiusM: 0, maxVoices: 2 }).sample(flight(), sectorWorld({ front: 3, back: 3 }));
        expect(s.hazards.map((h) => h.sector)).toEqual(['front', 'back']);
        const flat = createSceneSampler({ bodyRadiusM: 0, maxVoices: 1, enterDistM: { back: 6 }, weight: { back: 1 } }).sample(flight(), sectorWorld({ front: 3, back: 3 }));
        expect(flat.hazards).toHaveLength(1);
        expect(flat.hazards[0]!.sector).toBe('front'); // tie broken by sector order
    });

    it('the lesson can lower the number, down to none', () => {
        const sampler = createSceneSampler({ bodyRadiusM: 0 });
        sampler.setMaxVoices(1);
        expect(sampler.sample(flight(), sectorWorld(all)).hazards.map((h) => h.sector)).toEqual(['front']);
        sampler.setMaxVoices(0);
        expect(sampler.sample(flight({ t: 100 }), sectorWorld(all)).hazards).toEqual([]);
        expect(sampler.maxVoices).toBe(0);
    });

    it.each([[4], [-1], [2.5], [Number.NaN]])('never more than 3: %s is refused', (n) => {
        expect(() => createSceneSampler({ maxVoices: n })).toThrow(SamplerConfigError);
        const s = createSceneSampler();
        expect(() => s.setMaxVoices(n)).toThrow(SamplerConfigError);
        expect(MAX_HAZARD_VOICES).toBe(3);
    });
});

describe('hysteresis: voices do not flicker', () => {
    const none = { bodyRadiusM: 0 };

    /** the front sector's distance each frame, 20 ms apart; returns whether a front hazard sounded in each frame */
    function run(distances: number[], options: Parameters<typeof createSceneSampler>[0], dtMs = 20): boolean[] {
        const sampler = createSceneSampler({ ...none, ...options });
        return distances.map((d, i) => sampler.sample(flight({ t: i * dtMs }), sectorWorld({ front: d })).hazards.some((h) => h.sector === 'front'));
    }
    const transitions = (states: boolean[]): number => states.reduce((n, s, i) => (i > 0 && s !== states[i - 1] ? n + 1 : n), 0);

    // front threshold 6 m: the distance wavers 0.2 m around it
    const wavering = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 5.9 : 6.1));

    it('a distance wavering around the threshold gives one steady voice', () => {
        const states = run(wavering, {});
        expect(states.every(Boolean)).toBe(true);
        expect(transitions(states)).toBe(0);
    });

    it('without hysteresis the same input flickers (negative control)', () => {
        const states = run(wavering, { releaseRatio: 1, holdMs: 0 });
        expect(transitions(states)).toBeGreaterThanOrEqual(30);
    });

    it('turns on at once, and off only after the distance is clear of the release threshold', () => {
        // release threshold: risk 0.8, that is 6 / 0.8 = 7.5 m
        const states = run([8, 5.9, 7.4, 7.4, 7.4, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6, 7.6], {});
        expect(states.slice(0, 5)).toEqual([false, true, true, true, true]); // on at the first frame under 6, kept at 7.4
        expect(states[19]).toBe(false); // off once 7.6 m has lasted past the hold
    });

    it('holds for holdMs after the risk last reached one', () => {
        const sampler = createSceneSampler({ ...none, holdMs: 300 });
        const at = (t: number, d: number): boolean => sampler.sample(flight({ t }), sectorWorld({ front: d })).hazards.length > 0;
        expect(at(1000, 3)).toBe(true);
        expect(at(1100, 30)).toBe(true); // far now, held
        expect(at(1299, 30)).toBe(true);
        expect(at(1301, 30)).toBe(false);
        expect(at(1400, 3)).toBe(true); // back again
        expect(at(1600, 30)).toBe(true); // 200 ms after the last time at risk 1
        expect(at(1701, 30)).toBe(false);
    });

    it('a clock that goes back (a replay seek) does not freeze a voice', () => {
        const sampler = createSceneSampler({ ...none, holdMs: 300 });
        const at = (t: number, d: number): boolean => sampler.sample(flight({ t }), sectorWorld({ front: d })).hazards.length > 0;
        expect(at(10_000, 3)).toBe(true);
        expect(at(100, 30)).toBe(true); // jumped back: held from now on, not until 10 300
        expect(at(401, 30)).toBe(false);
    });

    it('a hazard whose thing vanishes has nothing to point at and stops sounding', () => {
        const sampler = createSceneSampler(none);
        expect(sampler.sample(flight({ t: 0 }), sectorWorld({ front: 3 })).hazards).toHaveLength(1);
        expect(sampler.sample(flight({ t: 20 }), sectorWorld({})).hazards).toEqual([]);
    });

    it('reset forgets the state', () => {
        const sampler = createSceneSampler(none);
        sampler.sample(flight({ t: 0 }), sectorWorld({ front: 3 }));
        expect(sampler.sample(flight({ t: 20 }), sectorWorld({ front: 7 })).hazards).toHaveLength(1); // held in the band
        sampler.reset();
        expect(sampler.sample(flight({ t: 40 }), sectorWorld({ front: 7 })).hazards).toEqual([]); // never started
    });
});

describe('a voice already sounding keeps its place against a near-equal newcomer', () => {
    // front urgency = 6 / d, left urgency = 4 / d * 0.8; one voice only
    const config = { bodyRadiusM: 0, maxVoices: 1 };
    const frame = (sampler: ReturnType<typeof createSceneSampler>, t: number, front: number, left: number): SectorId =>
        sampler.sample(flight({ t }), sectorWorld({ front, left })).hazards[0]!.sector;
    const leftAt = (urgency: number): number => (4 * 0.8) / urgency; // the left distance that gives this urgency

    it('stays until the challenger is clearly more urgent', () => {
        const sampler = createSceneSampler(config);
        expect(frame(sampler, 0, 4, leftAt(1.2))).toBe('front'); // front 1.5 against left 1.2
        expect(frame(sampler, 20, 4, leftAt(1.55))).toBe('front'); // left is slightly more urgent: front keeps it (1.5 x 1.25)
        expect(frame(sampler, 40, 4, leftAt(2.0))).toBe('left'); // clearly more: it takes over
        expect(frame(sampler, 60, 4, leftAt(1.55))).toBe('left'); // and now holds it
    });

    it('without stickiness the newcomer takes over at once (negative control)', () => {
        const sampler = createSceneSampler({ ...config, stickiness: 1 });
        expect(frame(sampler, 0, 4, leftAt(1.2))).toBe('front');
        expect(frame(sampler, 20, 4, leftAt(1.55))).toBe('left');
    });
});

describe('the sampler, as a whole', () => {
    it('is deterministic: the same frames give the same answers', () => {
        const world = createAnalyticWorld(makeSpec('corridor'));
        const run = (): string => {
            const sampler = createSceneSampler();
            const out: unknown[] = [];
            for (let i = 0; i < 100; i++) {
                const z = -i * 0.8;
                out.push(sampler.sample(flight({ t: i * 20, pos: [0.3 * Math.sin(i / 7), 2, z], vel: [0, 0, -40], yawDeg: 5 * Math.sin(i / 11) }), world));
            }
            return JSON.stringify(out);
        };
        expect(run()).toBe(run());
    });

    it('casts exactly 30 rays a sample', () => {
        let rays = 0;
        const counting: SonicWorld = { ...planeWorld([]), castRay: () => (rays++, null) };
        createSceneSampler().sample(flight(), counting);
        expect(rays).toBe(30);
        expect(createSceneSampler().sample(flight(), counting).sectors).toHaveLength(10);
    });

    it('flies a corridor at speed: the walls ahead raise voices in time, and 2000 samples are quick', () => {
        const world = createAnalyticWorld(makeSpec('corridor', { layout: 'straight' }));
        const sampler = createSceneSampler();
        let sawFront = false;
        const t0 = performance.now();
        for (let i = 0; i < 2000; i++) {
            const z = -Math.min(i, 100) * 0.9; // 45 m/s at 50 Hz, stopping short of the end wall at -102.5
            const s = sampler.sample(flight({ t: i * 20, pos: [0, 2, z], vel: [0, 0, i < 100 ? -45 : 0] }), world);
            if (i === 99) sawFront = s.hazards.some((h) => h.sector === 'front');
        }
        const ms = performance.now() - t0;
        expect(sawFront).toBe(true);
        expect(ms).toBeLessThan(4000);
    });
});

describe('the settings are checked (negative controls)', () => {
    it.each([
        ['rangeM', { rangeM: 0 }],
        ['rangeM', { rangeM: 1000 }],
        ['spreadDeg', { spreadDeg: 90 }],
        ['bodyRadiusM', { bodyRadiusM: -1 }],
        ['enterTtcS', { enterTtcS: 0 }],
        ['releaseRatio', { releaseRatio: 1.5 }],
        ['releaseRatio', { releaseRatio: 0 }],
        ['holdMs', { holdMs: -5 }],
        ['stickiness', { stickiness: 0.5 }],
        ['enterDistM.front', { enterDistM: { front: 0 } }],
        ['weight.back', { weight: { back: -1 } }],
        ['rangeM', { rangeM: Number.NaN }]
    ] as [string, Parameters<typeof createSceneSampler>[0]][])('%s: %j', (field, options) => {
        expect(() => createSceneSampler(options)).toThrow(SamplerConfigError);
        expect(() => createSceneSampler(options)).toThrow(new RegExp(field.replace('.', '\\.')));
    });

    it('accepts the defaults and a partial override', () => {
        const s = createSceneSampler({ enterDistM: { front: 8 } });
        expect(s.config.enterDistM.front).toBe(8);
        expect(s.config.enterDistM.back).toBe(DEFAULT_SAMPLER_CONFIG.enterDistM.back);
        expect(s.maxVoices).toBe(3);
    });
});
