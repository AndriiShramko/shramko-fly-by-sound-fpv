import { describe, expect, it } from 'vitest';
import type { CueEvent, FlightSample, LessonLayers, SonicObject, SonicPrefs, Vec3 } from '../src/contract';
import { LAYER_IDS } from '../src/contract';
import {
    aimMissM,
    bandRoughness,
    compressorMakeupDb,
    CuePlanner,
    dbToGain,
    distanceCode,
    dopplerCents,
    duckDb,
    duePulses,
    createPulseTrain,
    elevationSteps,
    fadeCurve,
    LOOKAHEAD_S,
    MAX_MOVING_VOICES,
    pannerDirection,
    PRIORITY,
    pulsePeriodMs,
    shapeAccents,
    shapePoint,
    softClipCurve,
    speedTempoHz,
    targetRateHz,
    targetRoughness,
    URGENT_DUCK_DB,
    VoiceAllocator,
    type FramePlan
} from '../src/cues';
import { defaultPrefs } from '../src/prefs';
import { BUILTIN_THEME_IDS, getBuiltinTheme, isInScale } from '../src/theme';
import { createAnalyticWorld, makeSpec } from '../src/world';
import { yawQuat } from '../src/util/vec';

const soft = getBuiltinTheme('soft');
const SAFETY = soft.layers.safety.params as Record<string, number>;
const RULE = { periodNearMs: SAFETY['periodNearMs'] as number, periodFarMs: SAFETY['periodFarMs'] as number, ttcFarS: SAFETY['ttcFarS'] as number, distM: SAFETY['pulseDistM'] as number };

function sample(pos: Vec3, vel: Vec3 = [0, 0, 0], yawDeg = 0, t = 0): FlightSample {
    return { t, tick: t, pos, vel, quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

const close = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

describe('the pulse period follows the time to collision', () => {
    it('runs from periodNearMs at contact to periodFarMs at ttcFarS, evenly on a log scale', () => {
        expect(pulsePeriodMs(0, 0.1, RULE)).toBeCloseTo(RULE.periodNearMs, 6);
        expect(pulsePeriodMs(RULE.ttcFarS, 100, RULE)).toBeCloseTo(RULE.periodFarMs, 6);
        expect(pulsePeriodMs(RULE.ttcFarS * 3, 100, RULE)).toBeCloseTo(RULE.periodFarMs, 6);
        // halfway in x is the geometric mean
        expect(pulsePeriodMs(RULE.ttcFarS / 2, 100, RULE)).toBeCloseTo(Math.sqrt(RULE.periodNearMs * RULE.periodFarMs), 6);
    });

    it('quickens as the time to collision falls, and uses the distance when not closing', () => {
        let prev = Infinity;
        for (const ttc of [4, 3, 2, 1.5, 1, 0.5, 0.2]) {
            const p = pulsePeriodMs(ttc, 100, RULE);
            expect(p).toBeLessThan(prev);
            prev = p;
        }
        expect(pulsePeriodMs(null, RULE.distM / 2, RULE)).toBeCloseTo(Math.sqrt(RULE.periodNearMs * RULE.periodFarMs), 6);
    });

    it('never sounds calmer for a near wall because the craft creeps toward it', () => {
        const hovering = pulsePeriodMs(null, 0.3, RULE);
        const creeping = pulsePeriodMs(3.5, 0.3, RULE);
        expect(creeping).toBeLessThanOrEqual(hovering + 1e-9);
        // negative control: with the distance floor left out, creeping would be much calmer
        expect(pulsePeriodMs(3.5, 100, RULE)).toBeGreaterThan(hovering * 3);
    });
});

describe('pulses are placed on the audio clock with lookahead', () => {
    /** Wakes at jittered times like frames and timers do; returns every pulse placed. */
    function run(periodAt: (t: number) => number, wakes: number[]): number[] {
        const train = createPulseTrain();
        const out: number[] = [];
        for (const now of wakes) out.push(...duePulses(train, now, now + LOOKAHEAD_S, periodAt(now)));
        return out;
    }
    const jittered = (): number[] => {
        const w: number[] = [];
        let t = 0;
        let k = 0;
        while (t < 3) {
            t += 0.016 + 0.012 * Math.abs(Math.sin(k++ * 1.7)); // 16 to 28 ms wake-ups
            w.push(t);
        }
        return w;
    };

    it('keeps an exact period whatever the wake-ups', () => {
        const times = run(() => 0.25, jittered());
        expect(times.length).toBeGreaterThan(10);
        for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeCloseTo(0.25, 9);
        // negative control: pulses fired at the wake-ups themselves (timers alone) are off by milliseconds
        const naive: number[] = [];
        let next = 0;
        for (const now of jittered()) {
            if (now >= next) {
                naive.push(now);
                next = now + 0.25;
            }
        }
        const worst = Math.max(...naive.slice(1).map((t, i) => Math.abs(t - naive[i]! - 0.25)));
        expect(worst).toBeGreaterThan(0.005);
    });

    it('applies a quicker period at the very next pulse, and never places a pulse twice or in the past', () => {
        const wakes = jittered();
        const times = run((t) => (t < 1 ? 1.2 : 0.1), wakes);
        const after = times.filter((t) => t >= 1);
        expect(after[0]! - times.filter((t) => t < 1).at(-1)!).toBeLessThanOrEqual(1.2 + 1e-9);
        for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
        const train = createPulseTrain();
        for (const now of wakes) for (const p of duePulses(train, now, now + LOOKAHEAD_S, 0.2)) expect(p).toBeGreaterThanOrEqual(now);
    });

    it('skips the pulses missed while asleep instead of playing them in a burst, and stops at period 0', () => {
        const train = createPulseTrain();
        duePulses(train, 0, 0.1, 0.05);
        const late = duePulses(train, 5, 5.1, 0.05);
        expect(late.every((t) => t >= 5)).toBe(true);
        expect(late.length).toBeLessThanOrEqual(3);
        expect(duePulses(train, 6, 6.1, 0)).toEqual([]);
        expect(train.last).toBeNull();
    });
});

describe('every pitch is a note of the scale', () => {
    const hall = createAnalyticWorld(makeSpec('hall', {}, 1));
    const rings = createAnalyticWorld(makeSpec('rings', { layout: 'course', count: 6 }, 3));
    const pillars = createAnalyticWorld(makeSpec('pillars', { layout: 'row' }, 2));
    const events: CueEvent[] = [
        { kind: 'touch', material: 'wall', dir: [1, 0, 0], speed: 3 },
        { kind: 'touch', material: 'floor', dir: null, speed: 1 },
        { kind: 'gate', index: 0, of: 6 },
        { kind: 'gate', index: 5, of: 6 },
        { kind: 'lap' },
        { kind: 'checkpoint' },
        { kind: 'reset' },
        { kind: 'fanfare' },
        { kind: 'preview', cue: 'safety.wall', dir: null },
        { kind: 'preview', cue: 'shape.cube', dir: [0, 0, -1] },
        { kind: 'preview', cue: 'target.off', dir: [-1, 0, 0] }
    ];

    // every pitch but the height glide (it slides between the notes, M41-12: test/height.test.ts holds it);
    // its target tone is a note again
    function collect(plan: FramePlan): number[] {
        const hz: number[] = [];
        for (const v of plan.voices) hz.push(v.hz);
        if (plan.height !== null && plan.height.target !== null) hz.push(plan.height.target.hz);
        if (plan.speed !== null) hz.push(plan.speed.hz);
        if (plan.room !== null) hz.push(plan.room.hz);
        for (const c of plan.cues) if (c.pitchHz !== null && c.id !== 'height.tone' && c.id !== 'height.rough') hz.push(c.pitchHz);
        return hz;
    }

    it('for every theme, polarity, pitch offset and world on a scripted flight', () => {
        let checked = 0;
        for (const id of BUILTIN_THEME_IDS) {
            const theme = getBuiltinTheme(id);
            for (const polarity of ['up-higher', 'up-lower'] as const) {
                for (const offset of [0, -3, 4]) {
                    const prefs: SonicPrefs = { ...defaultPrefs(), heightPolarity: polarity, layerPitchSteps: Object.fromEntries(LAYER_IDS.map((l) => [l, offset])) };
                    const planner = new CuePlanner({ theme, prefs, layers: { on: LAYER_IDS, heightBandM: [1, 2], hazardVoices: 3 } });
                    for (const world of [hall, rings, pillars]) {
                        planner.reset();
                        const target = world.objects()[0] ?? null;
                        for (let k = 0; k < 60; k++) {
                            const t = k * 50;
                            const pos: Vec3 = [Math.sin(k / 7) * 6, 0.4 + (k % 20) * 0.4, world.start.pos[2] - k * 0.6];
                            const plan = planner.plan({ sample: sample(pos, [1, 0.2, -6], (k * 7) % 360, t), world, target, floorY: 0 });
                            const notes = k % 6 === 0 ? planner.cue(events[(k / 6) % events.length]!, t) : [];
                            for (const hz of [...collect(plan), ...notes.map((n) => n.hz)]) {
                                expect(isInScale(theme.scale, hz), `${id} ${polarity} ${offset} ${hz.toFixed(2)} Hz`).toBe(true);
                                checked++;
                            }
                        }
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(5000);
    });

    it('the check refuses a pitch off the scale (negative control)', () => {
        expect(isInScale(soft.scale, 450)).toBe(false);
        expect(isInScale(soft.scale, soft.scale.rootHz * 2 ** (1 / 12))).toBe(false);
    });
});

describe('roughness and the target hum', () => {
    const T = soft.layers.target.params as Record<string, number>;
    const tr = { rateNearHz: T['rateNearHz'] as number, rateFarHz: T['rateFarHz'] as number, nearM: T['nearM'] as number, farM: T['farM'] as number, roughMax: T['roughMax'] as number, missFullM: T['missFullM'] as number };

    it('the height tone is smooth inside the band and roughens outside it', () => {
        expect(bandRoughness(1.5, [1, 2], 0.6, 0.3)).toBe(0);
        expect(bandRoughness(0.85, [1, 2], 0.6, 0.3)).toBeCloseTo(0.3, 9);
        expect(bandRoughness(0.5, [1, 2], 0.6, 0.3)).toBeCloseTo(0.6, 9);
        expect(bandRoughness(2.3, [1, 2], 0.6, 0.3)).toBeCloseTo(0.6, 9);
        expect(bandRoughness(9, null, 0.6, 0.3)).toBe(0);
    });

    it('the hum roughens with the aim miss and repeats faster as the gate nears', () => {
        expect(aimMissM([0, 0, -10], [0, 0, -1])).toBeCloseTo(0, 9);
        expect(aimMissM([2, 0, -10], [0, 0, -1])).toBeCloseTo(2, 9);
        expect(aimMissM([0, 0, 10], [0, 0, -1])).toBeCloseTo(10, 9);
        expect(targetRoughness(0, 10, tr)).toBe(0);
        expect(targetRoughness(1.5, 10, tr)).toBeCloseTo(tr.roughMax / 2, 9);
        expect(targetRoughness(30, 10, tr)).toBeCloseTo(tr.roughMax, 9);
        // a far gate does not turn rough for a heading error the ear cannot hear
        expect(targetRoughness(3, 60, tr)).toBeLessThan(tr.roughMax / 2);
        expect(targetRateHz(tr.farM * 2, tr)).toBeCloseTo(tr.rateFarHz, 9);
        expect(targetRateHz(tr.nearM / 2, tr)).toBeCloseTo(tr.rateNearHz, 9);
        expect(targetRateHz(10, tr)).toBeGreaterThan(targetRateHz(20, tr));
    });

    it('speed ticks are silent in a hover and quicken with speed', () => {
        const S = soft.layers.speed.params as Record<string, number>;
        const sr = { tempoMinHz: S['tempoMinHz'] as number, tempoMaxHz: S['tempoMaxHz'] as number, speedMaxMps: S['speedMaxMps'] as number };
        expect(speedTempoHz(0.1, sr)).toBe(0);
        expect(speedTempoHz(sr.speedMaxMps, sr)).toBeCloseTo(sr.tempoMaxHz, 9);
        expect(speedTempoHz(5, sr)).toBeGreaterThan(speedTempoHz(2, sr));
    });
});

describe('distance is coded redundantly, direction for the HRTF panner', () => {
    const rule = { nearHz: 16000, farHz: 2500, farM: 12, sendNear: 0.04, sendFar: 0.35, ildBoostDb: 6 };

    it('level, low-pass, reverb send and ILD all move with distance', () => {
        expect(distanceCode(0.5, rule).gainDb).toBe(0);
        expect(distanceCode(2, rule).gainDb).toBeCloseTo(-4, 9);
        expect(distanceCode(4, rule).gainDb).toBeCloseTo(-8, 9);
        expect(distanceCode(1e6, rule).gainDb).toBe(-18);
        const near = distanceCode(1, rule);
        const far = distanceCode(12, rule);
        expect(near.lowpassHz).toBeCloseTo(16000, 6);
        expect(far.lowpassHz).toBeCloseTo(2500, 6);
        expect(far.reverbSend).toBeGreaterThan(near.reverbSend);
        expect(distanceCode(2.5, rule).ildDb).toBe(0);
        expect(distanceCode(0.3, rule).ildDb).toBeCloseTo(6, 9);
        expect(distanceCode(1.2, rule).ildDb).toBeGreaterThan(0);
    });

    it('Doppler bends a cue by at most 60 cents either way', () => {
        expect(dopplerCents(0)).toBe(0);
        expect(dopplerCents(10)).toBeGreaterThan(40);
        expect(dopplerCents(-10)).toBeLessThan(-40);
        expect(dopplerCents(200)).toBe(60);
        expect(dopplerCents(-200)).toBe(-60);
    });

    it('raises the elevation by 7.5 degrees and keeps the azimuth', () => {
        const DEG = Math.PI / 180;
        for (const az of [-150, -90, -30, 0, 45, 90, 170]) {
            const d: Vec3 = [Math.sin(az * DEG), 0, -Math.cos(az * DEG)];
            const p = pannerDirection(d);
            expect(Math.hypot(...p)).toBeCloseTo(1, 9);
            expect(Math.asin(p[1]) / DEG).toBeCloseTo(7.5, 6);
            expect(Math.atan2(p[0], -p[2]) / DEG).toBeCloseTo(az, 6);
        }
        expect(pannerDirection([0, 1, 0])[1]).toBeCloseTo(1, 9);
        expect(pannerDirection([0, 0, 0])).toEqual([0, 0, -1]);
    });

    it('codes elevation in pitch, by coarse bands, flipped with the polarity', () => {
        expect(elevationSteps(0, 'up-higher')).toBe(0);
        expect(elevationSteps(0.3, 'up-higher')).toBe(1);
        expect(elevationSteps(0.9, 'up-higher')).toBe(2);
        expect(elevationSteps(-0.9, 'up-higher')).toBe(-2);
        expect(elevationSteps(0.9, 'up-lower')).toBe(-2);
    });
});

describe('the voice budget', () => {
    it('keeps holders, steals only from a lower priority and never exceeds its size', () => {
        const pool = new VoiceAllocator(3);
        let a = pool.assign([
            { key: 'p1', priority: PRIORITY.preview },
            { key: 'p2', priority: PRIORITY.preview },
            { key: 'p3', priority: PRIORITY.preview }
        ]);
        expect(a.started).toEqual(['p1', 'p2', 'p3']);
        a = pool.assign([
            { key: 'p1', priority: PRIORITY.preview },
            { key: 'p2', priority: PRIORITY.preview },
            { key: 'p3', priority: PRIORITY.preview },
            { key: 'safety:front', priority: PRIORITY.hazard }
        ]);
        expect(a.slotOf.has('safety:front')).toBe(true);
        expect(a.slotOf.size).toBe(3);
        expect(a.dropped).toEqual(['p3']);
        // an equal priority does not steal: no flicker
        const before = pool.slots();
        a = pool.assign([
            { key: 'p1', priority: PRIORITY.preview },
            { key: 'p2', priority: PRIORITY.preview },
            { key: 'safety:front', priority: PRIORITY.hazard },
            { key: 'p9', priority: PRIORITY.preview }
        ]);
        expect(pool.slots()).toEqual(before);
        expect(a.dropped).toEqual(['p9']);
    });

    it('the planner gives at most 8 moving voices, hazards first, however many are asked', () => {
        const hall = createAnalyticWorld(makeSpec('hall', { widthM: 8, heightM: 3 }, 1));
        const planner = new CuePlanner({ theme: soft });
        for (let i = 0; i < 12; i++) planner.cue({ kind: 'preview', cue: i % 2 === 0 ? 'shape.ring' : 'safety.obstacle', dir: [Math.sin(i), 0, -Math.cos(i)] }, 0);
        const target: SonicObject = { id: 'g', shape: { kind: 'ring', diameter: 2, tube: 0.1 }, pos: [0, 1.5, -10], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
        const plan = planner.plan({ sample: sample([3.2, 0.5, 0], [4, -1, -3], 0, 100), world: hall, target, floorY: 0 });
        expect(plan.voices.length).toBe(MAX_MOVING_VOICES);
        expect(plan.dropped.length).toBeGreaterThan(0);
        const hazards = plan.voices.filter((v) => v.layer === 'safety' && !v.key.startsWith('preview'));
        expect(hazards.length).toBeGreaterThan(0);
        expect(plan.voices.some((v) => v.key === 'target')).toBe(true);
        expect(plan.dropped.every((k) => k.startsWith('preview'))).toBe(true);
        // negative control: a planner allowed 16 voices lets more through
        const loose = new CuePlanner({ theme: soft, maxMovingVoices: 16 });
        for (let i = 0; i < 12; i++) loose.cue({ kind: 'preview', cue: 'shape.ring', dir: [Math.sin(i), 0, -Math.cos(i)] }, 0);
        expect(loose.plan({ sample: sample([0, 1.5, 0], [0, 0, 0], 0, 100), world: hall, target, floorY: 0 }).voices.length).toBeGreaterThan(MAX_MOVING_VOICES);
    });
});

describe('the planner hears the scene as the spec says', () => {
    const hall = createAnalyticWorld(makeSpec('hall', {}, 1));
    const front = hall.landmarks.find((l) => l.id === 'wall-front')!.pos;

    it('a wall ahead sounds from the front, wood in soft, pulsing by the time to collision', () => {
        const planner = new CuePlanner({ theme: soft });
        const pos: Vec3 = [0, 1.5, front[2] + 8];
        const plan = planner.plan({ sample: sample(pos, [0, 0, -4]), world: hall, target: null, floorY: 0 });
        const v = plan.voices.find((x) => x.key === 'safety:front')!;
        expect(v.cue).toBe('safety.wall');
        expect(v.timbre).toBe('wood');
        expect(v.dir[2]).toBeLessThan(-0.95);
        const ttc = (8 - 0.12) / 4;
        expect(v.periodS! * 1000).toBeCloseTo(pulsePeriodMs(ttc, v.distance, RULE), 2);
        expect(plan.cues.some((c) => c.id === 'safety.wall:front' && c.dir !== null)).toBe(true);
    });

    it('turning the craft turns the scene: the same wall moves to the side', () => {
        const planner = new CuePlanner({ theme: soft });
        const pos: Vec3 = [0, 1.5, front[2] + 0.7]; // within 0.8 m of the hull: heard when still
        const plan = planner.plan({ sample: sample(pos, [0, 0, 0], 90), world: hall, target: null, floorY: 0 });
        const wall = plan.voices.find((x) => x.cue === 'safety.wall')!;
        expect(wall.dir[0]).toBeLessThan(-0.9); // yaw right 90: the front wall is now on the left
    });

    it('the target hums from its gate, smooth on aim and rough off it, and pitch codes its height', () => {
        const planner = new CuePlanner({ theme: soft, layers: { on: ['target'], heightBandM: null, hazardVoices: 0 } });
        const gate: SonicObject = { id: 'r', shape: { kind: 'ring', diameter: 3, tube: 0.1 }, pos: [0, 1.5, -20], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
        const aimed = planner.plan({ sample: sample([0, 1.5, 0], [0, 0, -5]), world: null, target: gate, floorY: 0 }).voices[0]!;
        expect(aimed.beatDepth).toBeCloseTo(0, 9);
        expect(aimed.dir[2]).toBeLessThan(-0.99);
        const off = planner.plan({ sample: sample([0, 1.5, 0], [5, 0, -1]), world: null, target: gate, floorY: 0 }).voices[0]!;
        expect(off.beatDepth).toBeGreaterThan(0.3);
        const above = planner.plan({ sample: sample([0, -10, -15], [0, 0, -5]), world: null, target: gate, floorY: 0 }).voices[0]!;
        expect(above.hz).toBeGreaterThan(aimed.hz);
        expect(above.dir[1]).toBeGreaterThan(0.5);
    });

    it('the shape layer traces the next gate at its real size', () => {
        const planner = new CuePlanner({ theme: soft, layers: { on: ['shape'], heightBandM: null, hazardVoices: 0 } });
        const gate: SonicObject = { id: 'r', shape: { kind: 'ring', diameter: 4, tube: 0.1 }, pos: [0, 2, -3], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
        const dirs = [0, 250, 500, 800].map((t) => planner.plan({ sample: sample([0, 2, 0], [0, 0, 0], 0, t), world: null, target: gate, floorY: 0 }).voices[0]!);
        expect(dirs.every((v) => v.cue === 'shape.ring')).toBe(true);
        expect(dirs.every((v) => close(v.distance, Math.hypot(2.1, 3), 1e-6))).toBe(true);
        const xs = dirs.map((v) => v.dir[0]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
    });

    it('speech ducks every other layer by duckDb; an urgent hazard is never ducked and ducks the rest', () => {
        const quiet = duckDb(false, false, soft);
        expect(Object.values(quiet).every((d) => d === 0)).toBe(true);
        const speech = duckDb(true, false, soft);
        for (const id of LAYER_IDS) expect(speech[id]).toBe(id === 'voice' ? 0 : -soft.duckDb);
        const urgent = duckDb(true, true, soft);
        expect(urgent.safety).toBe(0);
        expect(urgent.target).toBe(-Math.max(soft.duckDb, URGENT_DUCK_DB));
        expect(duckDb(false, true, soft).height).toBe(-URGENT_DUCK_DB);
        const planner = new CuePlanner({ theme: soft });
        const pos: Vec3 = [0, 1.5, front[2] + 1.2];
        expect(planner.plan({ sample: sample(pos, [0, 0, -3]), world: hall, target: null, floorY: 0 }).urgent).toBe(true);
    });

    it('a lesson switches layers and the number of hazard voices', () => {
        const layers: LessonLayers = { on: ['height'], heightBandM: [1, 2], hazardVoices: 0 };
        const planner = new CuePlanner({ theme: soft, layers });
        const plan = planner.plan({ sample: sample([0, 0.5, front[2] + 1], [0, 0, -3]), world: hall, target: null, floorY: 0 });
        expect(plan.voices).toEqual([]);
        expect(plan.height!.rough).toBeGreaterThan(0);
        expect(plan.cues.map((c) => c.id)).toEqual(['height.rough', 'height.target']);
        planner.setLayers({ on: LAYER_IDS, heightBandM: null, hazardVoices: 1 });
        const corner = planner.plan({ sample: sample([19, 0.6, front[2] + 1], [2, -1, -3]), world: hall, target: null, floorY: 0 });
        expect(corner.voices.filter((v) => v.layer === 'safety').length).toBe(1);
    });

    it('the calm preset slows the pulses of the same scene', () => {
        const calmPrefs: SonicPrefs = { ...defaultPrefs(), calm: true };
        const a = new CuePlanner({ theme: soft }).plan({ sample: sample([0, 1.5, front[2] + 5], [0, 0, -3]), world: hall, target: null, floorY: 0 });
        const b = new CuePlanner({ theme: soft, prefs: calmPrefs }).plan({ sample: sample([0, 1.5, front[2] + 5], [0, 0, -3]), world: hall, target: null, floorY: 0 });
        expect(b.voices[0]!.periodS!).toBeGreaterThan(a.voices[0]!.periodS!);
    });
});

describe('shape traces', () => {
    const rule = { orbitHz: 1, sweepHz: 0.5, faceHz: 2 };

    it('a ring orbits on its centre line, a square has four corners, a cube jumps faces, a pillar sweeps its height', () => {
        for (const t of [0, 0.1, 0.37, 0.8]) expect(Math.hypot(...shapePoint({ kind: 'ring', diameter: 2, tube: 0.1 }, rule, t)!)).toBeCloseTo(1.1, 9);
        expect(shapePoint({ kind: 'square', side: 2, bar: 0.2 }, rule, 0)).toEqual([1.1, 1.1, 0]);
        expect(shapePoint({ kind: 'square', side: 2, bar: 0.2 }, rule, 0.25)![1]).toBeCloseTo(-1.1, 9);
        expect(shapeAccents({ kind: 'square', side: 2, bar: 0.2 }, rule, 0, 1)).toEqual([0.25, 0.5, 0.75, 1]);
        const cube = { kind: 'cube-frame', side: 2, bar: 0.2 } as const;
        expect(shapePoint(cube, rule, 0.1)![2]).toBeCloseTo(1.1, 9);
        expect(shapePoint(cube, rule, 0.6)![2]).toBeCloseTo(-1.1, 9);
        expect(shapeAccents(cube, rule, 0, 1)).toEqual([0.5, 1]);
        const pillar = { kind: 'pillar', radius: 0.5, height: 6 } as const;
        const ys = Array.from({ length: 41 }, (_, i) => shapePoint(pillar, rule, i * 0.05, [1, 0, 0])![1]);
        expect(Math.max(...ys)).toBeCloseTo(3, 9);
        expect(Math.min(...ys)).toBeCloseTo(-3, 9);
        expect(shapePoint(pillar, rule, 0, [1, 0, 0])![0]).toBeCloseTo(0.5, 9);
        expect(shapeAccents({ kind: 'ring', diameter: 2, tube: 0.1 }, rule, 0, 5)).toEqual([]);
        expect(shapePoint({ kind: 'zone', size: [1, 1, 1] }, rule, 0)).toBeNull();
    });
});

describe('the output chain numbers', () => {
    it('the soft clipper never passes the ceiling and leaves quiet signals alone', () => {
        for (const ceiling of [-6, -12]) {
            const curve = softClipCurve(ceiling);
            const c = dbToGain(ceiling);
            expect(Math.max(...curve)).toBeLessThanOrEqual(c);
            expect(Math.min(...curve)).toBeGreaterThanOrEqual(-c);
            for (let i = 1; i < curve.length; i++) expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
            const mid = (curve.length - 1) / 2;
            const x = 0.1;
            expect(curve[mid + Math.round((x * (curve.length - 1)) / 2)]!).toBeCloseTo(x, 3);
        }
        // negative control: a plain identity curve passes the ceiling
        expect(1).toBeGreaterThan(dbToGain(-6));
    });

    it('the compressor make-up is taken back out, and the fade runs 0 to 1 without a corner', () => {
        expect(compressorMakeupDb(-10, 4, 12)).toBeGreaterThan(0);
        const f = fadeCurve(101);
        expect(f[0]).toBe(0);
        expect(f[100]).toBeCloseTo(1, 9);
        expect(f[50]).toBeCloseTo(0.5, 9);
        expect(f[1]! - f[0]!).toBeLessThan(0.001);
        for (let i = 1; i < f.length; i++) expect(f[i]!).toBeGreaterThanOrEqual(f[i - 1]!);
    });
});
