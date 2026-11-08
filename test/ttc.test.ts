// Walls by time to contact, not by distance (v0.13, M41-13, owner's message 41): a hazard is heard when
// its time to contact drops under about 2.5 s, so fast flight hears far walls early; a slow craft does
// not hear far walls; within about 0.8 m everything is heard; urgency (pulse rate, level, brightness)
// follows the time to contact. Each claim has a control that must fail.
import { describe, expect, it } from 'vitest';
import type { FlightSample, MaterialClass, SectorId, SonicObject, SonicWorld, Vec3 } from '../src/contract';
import { SECTORS } from '../src/contract';
import { CuePlanner, distanceCode, hazardDistanceCode, isUrgent, pulsePeriodMs, URGENT_DISTANCE_M, type VoicePlan } from '../src/cues';
import { getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { ALWAYS_HEARD_M, createSceneSampler, DEFAULT_SAMPLER_CONFIG, ONSET_TTC_S, pathMissM, pathObjects, SECTOR_AXES, type CollisionCourse, type SamplerOptions } from '../src/sense';
import { getBuiltinTheme } from '../src/theme';
import { yawQuat } from '../src/util/vec';
import { createAnalyticWorld, makeSpec } from '../src/world';
import { block, boxTunnel } from './helpers/boxes';

const BODY = DEFAULT_SAMPLER_CONFIG.bodyRadiusM;
const soft = getBuiltinTheme('soft');
const S = soft.layers.safety.params as Record<string, number>;

function flight(pos: Vec3, vel: Vec3, t = 0): FlightSample {
    return { t, tick: Math.round(t), pos, vel, quat: yawQuat(0), rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** One infinite plane `dot(n, x) = d`, n pointing to the free side. */
function plane(n: Vec3, d: number, material: MaterialClass = 'wall'): SonicWorld {
    return {
        kind: 'analytic',
        id: 'plane',
        version: 1,
        bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
        objects: () => [],
        castRay(o, dir, maxDist) {
            const denom = dot(n, dir);
            if (denom >= -1e-12) return null;
            const t = (d - dot(n, o)) / denom;
            if (t < 0 || t > maxDist) return null;
            return { distance: t, point: [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t], normal: n, material, objectId: null };
        }
    };
}

/** The v0.12 sampler: a wall ahead from 6 m whatever the speed, and a time rule of 3 s. */
const V012: SamplerOptions = { enterDistM: { front: 6, 'front-left': 5, 'front-right': 5, 'front-up': 3, 'front-down': 1.8, left: 4, right: 4, back: 3, up: 1.5, down: 1.5 }, enterTtcS: 3 };
/** A distance-only rule (control): the v0.12 distances and no time rule at all (0.1 s is the least the sampler takes). */
const DISTANCE_ONLY: SamplerOptions = { enterDistM: V012.enterDistM, enterTtcS: 0.1 };

/**
 * Flies straight at a wall 30 m ahead at `speed`, 60 frames a second; returns the hull distance and the
 * time to contact at the first frame where the front sector is voiced (null: never, down to 5 cm).
 */
function onset(speed: number, options: SamplerOptions = {}): { distance: number; ttcS: number } | null {
    const wall = plane([0, 0, 1], -30);
    const sampler = createSceneSampler(options);
    const dt = 1 / 60;
    for (let k = 0; ; k++) {
        const z = -speed * k * dt;
        const hull = 30 + z - BODY;
        if (hull < 0.05) return null;
        const s = sampler.sample(flight([0, 2, z], [0, 0, -speed], k * dt * 1000), wall);
        if (s.hazards.some((h) => h.sector === 'front')) return { distance: hull, ttcS: hull / speed };
    }
}

describe('a wall ahead is heard by its time to contact', () => {
    it.each([1, 3, 5])('at %s m/s it is heard at least 2 s before contact, and not much earlier than 2.5 s', (speed) => {
        const o = onset(speed)!;
        expect(o).not.toBeNull();
        expect(o.ttcS).toBeGreaterThanOrEqual(2);
        expect(o.ttcS).toBeLessThanOrEqual(ONSET_TTC_S + 0.05);
    });

    it('control: a distance-only rule (the v0.12 6 m) is heard only 1.2 s before contact at 5 m/s', () => {
        const o = onset(5, DISTANCE_ONLY)!;
        expect(o.ttcS).toBeLessThan(2);
        // and it is a rule that would pass at walking pace: the control fails where the owner said it does
        expect(onset(1, DISTANCE_ONLY)!.ttcS).toBeGreaterThanOrEqual(2);
    });

    it('fast flight hears the far wall early: at 5 m/s from about 12.5 m, at 1 m/s from about 2.5 m', () => {
        expect(onset(5)!.distance).toBeGreaterThan(12);
        expect(onset(1)!.distance).toBeLessThan(2.6);
    });

    it('at 0.5 m/s a far wall stays quiet: nothing until about 1.25 m (control: v0.12 sounds it from 6 m)', () => {
        const o = onset(0.5)!;
        expect(o.distance).toBeLessThan(1.3);
        const old = onset(0.5, V012)!;
        expect(old.distance).toBeGreaterThan(5.9);
    });
});

describe('within 0.8 m everything is heard, still or not', () => {
    it.each(SECTORS)('a surface 0.7 m away in sector %s sounds while hovering; one 1.1 m away does not', (sector: SectorId) => {
        const axis = SECTOR_AXES[sector];
        // the plane faces the craft along this sector's axis, its nearest point 0.7 m from the hull
        const near = plane([-axis[0], -axis[1], -axis[2]], -(0.7 + BODY));
        const far = plane([-axis[0], -axis[1], -axis[2]], -(1.1 + BODY));
        const s = createSceneSampler().sample(flight([0, 0, 0], [0, 0, 0]), near);
        expect(s.hazards.length, sector).toBeGreaterThan(0);
        expect(s.hazards.some((h) => h.distance <= ALWAYS_HEARD_M)).toBe(true);
        expect(createSceneSampler().sample(flight([0, 0, 0], [0, 0, 0]), far).hazards).toEqual([]);
    });
});

describe('urgency follows the time to contact', () => {
    const planAt = (speed: number, ttc: number): VoicePlan => {
        const hull = speed * ttc;
        const wall = plane([0, 0, 1], -(hull + BODY));
        const planner = new CuePlanner({ theme: soft, layers: { on: ['safety'], heightBandM: null, hazardVoices: 1 } });
        return planner.plan({ sample: flight([0, 2, 0], [0, 0, -speed]), world: wall, target: null, floorY: 0 }).voices.find((v) => v.key === 'safety:front')!;
    };

    it('the same time to contact pulses alike, as loud and as bright, at 1, 3 and 5 m/s', () => {
        for (const ttc of [2.4, 1.6, 1]) {
            const [a, b, c] = [planAt(1, ttc), planAt(3, ttc), planAt(5, ttc)];
            for (const v of [b, c]) {
                expect(Math.abs(v.periodS! / a.periodS! - 1), `period at ${ttc} s`).toBeLessThan(0.02);
                expect(Math.abs(v.gainDb - a.gainDb), `level at ${ttc} s`).toBeLessThan(0.5);
                expect(Math.abs(v.lowpassHz / a.lowpassHz - 1), `low-pass at ${ttc} s`).toBeLessThan(0.05);
            }
            // the far one still sounds far: more reverb
            expect(c.reverbSend).toBeGreaterThan(a.reverbSend);
        }
        // and urgency rises as the time falls
        expect(planAt(5, 1).periodS!).toBeLessThan(planAt(5, 2.4).periodS!);
        expect(planAt(5, 1).gainDb).toBeGreaterThanOrEqual(planAt(5, 2.4).gainDb);
    });

    it('control: the v0.12 rules (rhythm floor by 12 m, level by distance) make the fast wall calmer and quieter at the same time to contact', () => {
        const rule = { periodNearMs: S['periodNearMs'] as number, periodFarMs: S['periodFarMs'] as number, ttcFarS: S['ttcFarS'] as number, distM: S['distFarM'] as number };
        const slow = pulsePeriodMs(2.4, 2.4, rule);
        const fast = pulsePeriodMs(2.4, 12, rule);
        expect(fast / slow).toBeGreaterThan(1.3);
        const d = { nearHz: S['lowpassNearHz'] as number, farHz: S['lowpassFarHz'] as number, farM: S['distFarM'] as number, sendNear: 0.04, sendFar: S['reverbSendFar'] as number, ildBoostDb: S['ildBoostDb'] as number };
        expect(distanceCode(2.4, d).gainDb - distanceCode(12, d).gainDb).toBeGreaterThan(6);
        // the v0.13 code closes that gap
        expect(Math.abs(hazardDistanceCode(2.4, 2.4, d).gainDb - hazardDistanceCode(12, 2.4, d).gainDb)).toBeLessThan(0.01);
    });

    it('urgent (the other layers duck) under 1.5 s or within 0.4 m; a hovering craft 0.7 m from a wall is not urgent', () => {
        expect(isUrgent(1.4, 10)).toBe(true);
        expect(isUrgent(null, 0.3)).toBe(true);
        expect(isUrgent(null, 0.7)).toBe(false);
        expect(isUrgent(2, 0.7)).toBe(false);
        expect(URGENT_DISTANCE_M).toBe(0.4);
    });
});

describe('objects: a time to contact only on a collision course', () => {
    it('flying through a ring at 5 m/s raises no hazard; a pillar straight ahead at the same speed does (control)', () => {
        const rings = createAnalyticWorld(makeSpec('rings', { layout: 'single', aheadM: 12, sizeM: 3 }, 1));
        const ring = rings.objects().find((o) => o.order !== null) as SonicObject;
        const sampler = createSceneSampler();
        let voiced = 0;
        for (let k = 0; k < 120; k++) {
            const z = ring.pos[2] + 3 - (k * 5) / 60;
            const s = sampler.sample(flight([ring.pos[0], ring.pos[1], z], [0, 0, -5], (k * 1000) / 60), rings);
            voiced += s.hazards.filter((h) => h.objectId === ring.id).length;
        }
        expect(voiced).toBe(0);
        const pillars = createAnalyticWorld(makeSpec('pillars', { layout: 'single', aheadM: 15 }, 1));
        const pillar = pillars.objects()[0] as SonicObject;
        const s2 = createSceneSampler();
        let hit = 0;
        for (let k = 0; k < 60; k++) {
            const z = pillar.pos[2] + 14 - (k * 5) / 60;
            hit += s2.sample(flight([pillar.pos[0], 1.5, z], [0, 0, -5], (k * 1000) / 60), pillars).hazards.filter((h) => h.objectId === pillar.id).length;
        }
        expect(hit).toBeGreaterThan(0);
    });

    it('the path rays: the soonest hit of each object on the straight path, walls left to the sectors, none when still', () => {
        const world = boxTunnel([block(-10, 10, 0, 8, -40, -38)], { min: [-10, 0, -60], max: [10, 8, 20] });
        const hits = pathObjects({ pos: [0, 4, -18], vel: [0, 0, -4] }, world, BODY, 40, 0.2);
        expect([...hits.keys()]).toEqual(['block']);
        expect(hits.get('block')!.ttcS).toBeCloseTo((20 - BODY) / 4, 6);
        expect(pathObjects({ pos: [0, 4, -18], vel: [0, 0, 4] }, world, BODY, 40, 0.2).size).toBe(0); // the wall behind has no object id
        expect(pathObjects({ pos: [0, 4, -18], vel: [0, 0, -0.1] }, world, BODY, 40, 0.2).size).toBe(0);
    });

    it('pathMissM: the closest approach of the straight path to a point', () => {
        expect(pathMissM([0, 0, -10], [0, 0, -5])).toBeCloseTo(0, 9);
        expect(pathMissM([1.5, 0, 0], [0, 0, -5])).toBeCloseTo(1.5, 9);
        expect(pathMissM([1, 0, -10], [0, 0, -5])).toBeCloseTo(1, 9);
        expect(pathMissM([0, 0, 10], [0, 0, -5])).toBeCloseTo(10, 9); // behind: full distance
        expect(pathMissM([3, 4, 0], [0, 0, 0])).toBeCloseTo(5, 9); // not moving
    });
});

// Review B1: the first v0.13 filter kept an object's time to contact only when the path passed within the hull plus
// 0.3 m of the point a sector ray found. For a box face or a pillar the path meets the object elsewhere, so a gentle
// sink, a little drift or a pillar between two sector rays were heard late (down to 0.4 s before contact).
describe('objects on the path are heard by their time to contact, at any angle to the sector rays', () => {
    const DT = 1 / 60;

    /**
     * Flies the straight line p0 + vel t at 60 frames a second, the nose at `yawDeg`; returns the true time to contact
     * (`contactS`, from the frame's position) at the first frame with a hazard on `objectId`, or null when none comes
     * before contact.
     */
    function objectOnset(world: SonicWorld, objectId: string, p0: Vec3, vel: Vec3, contactS: (pos: Vec3) => number | null, course: CollisionCourse, yawDeg = 0): number | null {
        const sampler = createSceneSampler({ collisionCourse: course });
        for (let k = 0; k < 60 * 30; k++) {
            const pos: Vec3 = [p0[0] + vel[0] * k * DT, p0[1] + vel[1] * k * DT, p0[2] + vel[2] * k * DT];
            const left = contactS(pos);
            if (left === null || left <= 0) return null;
            const sample: FlightSample = { ...flight(pos, vel, k * DT * 1000), quat: yawQuat(yawDeg), yawDeg };
            if (sampler.sample(sample, world).hazards.some((h) => h.objectId === objectId)) return left;
        }
        return null;
    }

    // a box across a hall 20 m wide and 8 m high; its face at z = -38, the craft 22 m before it
    const FACE_Z = -38;
    const boxHall = boxTunnel([block(-10, 10, 0, 8, -40, FACE_Z)], { min: [-10, 0, -60], max: [10, 8, 20] });
    const boxPath = (speed: number, deg: number, how: 'sink' | 'drift'): { p0: Vec3; vel: Vec3 } => {
        const a = (deg * Math.PI) / 180;
        const across = speed * Math.sin(a);
        return { p0: [how === 'drift' ? -3 : 0, how === 'sink' ? 6 : 4, FACE_Z + 22], vel: [how === 'drift' ? across : 0, how === 'sink' ? -across : 0, -speed * Math.cos(a)] };
    };
    const faceContact = (vel: Vec3) => (pos: Vec3): number => (pos[2] - BODY - FACE_Z) / -vel[2];

    it.each([3, 5])('a box face 2, 5 and 10 degrees off the sector rays at %s m/s, sinking or drifting: heard at least 2 s before contact', (speed) => {
        for (const deg of [2, 5, 10]) {
            for (const how of ['sink', 'drift'] as const) {
                const { p0, vel } = boxPath(speed, deg, how);
                const at = objectOnset(boxHall, 'block', p0, vel, faceContact(vel), 'path-rays');
                expect(at, `${deg} deg ${how}`).not.toBeNull();
                expect(at!, `${deg} deg ${how}`).toBeGreaterThanOrEqual(2);
                expect(at!, `${deg} deg ${how}`).toBeLessThanOrEqual(ONSET_TTC_S + 0.05);
            }
        }
    });

    it('control: the first v0.13 rule (the hit point) hears the same face late once the path is 5 degrees or more off a ray', () => {
        for (const speed of [3, 5]) {
            for (const deg of [5, 10]) {
                const { p0, vel } = boxPath(speed, deg, 'sink');
                const at = objectOnset(boxHall, 'block', p0, vel, faceContact(vel), 'hit-point');
                expect(at === null || at < 2, `${speed} m/s ${deg} deg: ${String(at)}`).toBe(true);
            }
        }
    });

    // walls-pillar's pillar: radius 0.5 m, its axis at x = 0, z = 7 (the lesson's world)
    const lessonWorld = getLesson('walls-pillar').world;
    const pillarWorld = createAnalyticWorld(lessonWorld.kind === 'analytic' ? lessonWorld.spec : makeSpec('pillars', { layout: 'single', aheadM: 15 }, 0));
    const pillar = pillarWorld.objects().find((o) => o.shape.kind === 'pillar') as SonicObject;
    const R = (pillar.shape as { radius: number }).radius;
    /** Time until the hull touches the pillar flying straight on, or null when the line passes it. */
    const pillarContact = (vel: Vec3) => (pos: Vec3): number | null => {
        const dx = pos[0] - pillar.pos[0], dz = pos[2] - pillar.pos[2];
        const a = vel[0] * vel[0] + vel[2] * vel[2];
        const b = 2 * (dx * vel[0] + dz * vel[2]);
        const c = dx * dx + dz * dz - (R + BODY) ** 2;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return null;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        return t >= 0 ? t : null;
    };
    /** A line at `speed` that passes `missM` from the pillar's axis at its closest, `deg` degrees to the hall's axis, 25 m before it. */
    const pillarPath = (speed: number, missM: number, deg: number): { p0: Vec3; vel: Vec3 } => {
        const a = (deg * Math.PI) / 180;
        const dir: Vec3 = [Math.sin(a), 0, -Math.cos(a)];
        const normal: Vec3 = [Math.cos(a), 0, Math.sin(a)];
        const p0: Vec3 = [pillar.pos[0] + missM * normal[0] - 22 * dir[0], 2, pillar.pos[2] + missM * normal[2] - 22 * dir[2]];
        return { p0, vel: [dir[0] * speed, 0, dir[2] * speed] };
    };

    it('the 0.5 m pillar, the path 0, 0.3 and 0.5 m off its axis, straight or at 10 degrees, at 3 and 5 m/s: heard at least 2 s before contact', () => {
        expect(R).toBe(0.5);
        for (const speed of [3, 5]) {
            for (const miss of [0, 0.3, 0.5]) {
                for (const deg of [0, 10]) {
                    const { p0, vel } = pillarPath(speed, miss, deg);
                    const at = objectOnset(pillarWorld, pillar.id, p0, vel, pillarContact(vel), 'path-rays');
                    expect(at, `${speed} m/s, ${miss} m off, ${deg} deg`).not.toBeNull();
                    expect(at!, `${speed} m/s, ${miss} m off, ${deg} deg`).toBeGreaterThanOrEqual(2);
                }
            }
        }
    });

    it('the pillar straight ahead with the nose 5 or 10 degrees off the path (between two sector rays): heard at least 2 s before contact', () => {
        for (const yaw of [5, 10, -5]) {
            const { p0, vel } = pillarPath(3, 0, 0);
            const at = objectOnset(pillarWorld, pillar.id, p0, vel, pillarContact(vel), 'path-rays', yaw);
            expect(at, `yaw ${yaw}`).not.toBeNull();
            expect(at!, `yaw ${yaw}`).toBeGreaterThanOrEqual(2);
        }
    });

    it('controls: the hit-point rule and no rule at all (v0.12) hear the pillar late when the path is 0.5 m off its axis or the nose is 5 degrees off', () => {
        const off = pillarPath(3, 0.5, 0);
        for (const course of ['hit-point', 'none'] as const) {
            const at = objectOnset(pillarWorld, pillar.id, off.p0, off.vel, pillarContact(off.vel), course);
            expect(at === null || at < 2, `${course}, 0.5 m off: ${String(at)}`).toBe(true);
            const ahead = pillarPath(3, 0, 0);
            const at2 = objectOnset(pillarWorld, pillar.id, ahead.p0, ahead.vel, pillarContact(ahead.vel), course, 5);
            expect(at2 === null || at2 < 2, `${course}, nose 5 deg off: ${String(at2)}`).toBe(true);
        }
    });

    it('a path that passes the pillar by more than the hull gives it no time to contact: heard only within 0.8 m', () => {
        const { p0, vel } = pillarPath(3, R + BODY + 0.25, 0);
        const sampler = createSceneSampler();
        let nearest = Infinity;
        for (let k = 0; k < 60 * 10; k++) {
            const pos: Vec3 = [p0[0] + vel[0] * k * DT, p0[1], p0[2] + vel[2] * k * DT];
            const h = sampler.sample(flight(pos, vel, k * DT * 1000), pillarWorld).hazards.find((x) => x.objectId === pillar.id);
            if (h !== undefined) nearest = Math.min(nearest, h.distance);
            if (h !== undefined) expect(h.distance, `frame ${k}`).toBeLessThanOrEqual(ALWAYS_HEARD_M + 0.01);
        }
        expect(nearest).toBeLessThan(ALWAYS_HEARD_M);
    });
});

describe('the sampler looks far enough', () => {
    it('its range covers 3 s of the fastest lesson, and the onset distance of every lesson', () => {
        for (const id of SHIPPED_LESSON_IDS) {
            const lesson = getLesson(id);
            const v = lesson.assists.maxSpeedMps;
            expect(v, `${id}: a lesson with no speed cap needs a range check of its own`).not.toBeNull();
            expect(3 * (v as number), id).toBeLessThanOrEqual(DEFAULT_SAMPLER_CONFIG.rangeM);
            expect(ONSET_TTC_S * (v as number) + BODY, id).toBeLessThan(DEFAULT_SAMPLER_CONFIG.rangeM);
        }
    });
});
