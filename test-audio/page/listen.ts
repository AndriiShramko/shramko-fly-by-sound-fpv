// The virtual listener's first measuring rig, render side (docs/design/virtual-listener.md, sections 2.3 to
// 2.5; VL-0 and a cheap part of VL-2 and VL-6). Scripted flights through the real engine in an
// OfflineAudioContext at 48 kHz, frames at 60 Hz through suspend and resume (as test-audio/page/proofs.ts).
// Four channels out: 0 and 1 are the ears (after the output chain), 2 and 3 the master before the chain
// (stems sum there exactly). A solo render keeps one part (a layer, the motor) and plays the same notes, so
// its pre-chain channels are that part's stem. Per frame the truth: height, target, hazards, speech.
//
// Speech: Chrome's speechSynthesis cannot be captured, so the rig's SpeechOut only keeps time: a line "takes"
// the length of its pre-rendered clip (the driver passes the lengths) and the engine ducks meanwhile, as
// live. The measurer sums the clips into the ears' channels at the engine's utterance volume (the route of
// the live voice: outside the Web Audio graph, never through the limiter).
//
// The motor: a stand-in that follows the simulator's motor sound (ShramkoGSFPV apps/fly/src/audio/motor-sound.ts:
// four rotor voices with the blade-pass harmonics, prop wash through a band-pass, the volume slider's curve),
// with seeded noise, played into the engine's motorInput. Not the simulator's code: its recipe, with the rotor
// speeds of the simulator's crafts (CRAFTS; the default craft unless the request names another, review M3).
//
// The hover band (review M2): the height layer alone over a hover lesson's band, the craft held at heights in
// and out of it, so the measurer can tell the target notes, the plain height tone and the out-of-band buzz apart.
//
// The free chime (lane s13-elev, owner's message 42): the open-way chime of a way above, then of a way below, played as
// a lesson names it (repeat-cue from up, from down), the safety layer alone and its direct sound alone (no reverb
// return); with the up/down direction on (above and below), off (both from ahead: v0.13) and each again with no HRTF
// panner (its dry twin), so the measurer can take the HRTF's own response per elevation and the notes' pitch.
//
// The gaps flight (lane s13-elev, review E5): tunnel-gaps flown along its world's own track through the four free ways
// (above, right, below, left) at 2 m/s with the lesson's layers, the motor and three spoken lines: the open-way chime
// above and below, the ceiling and the floor sound with their breath of air, under speech and over the motor, so VL-6
// and VL-2 measure them too (the flight above has none of them).
import type { FlightSample, LessonLayers, SonicObject, SonicPrefs, SonicWorld, SpeechOut, Vec3 } from '../../src/contract';
import { createSonicEngine, type EngineTestHooks, type FlyBySoundEngine, type SoloPart } from '../../src/audio';
import { beaconPointIndex, lineClear } from '../../src/cues/beacon';
import { getLesson } from '../../src/lesson/library';
import { yawOf } from '../../src/lesson/track';
import { defaultPrefs } from '../../src/prefs/prefs';
import { getBuiltinTheme } from '../../src/theme/builtin';
import { createRng } from '../../src/util/rng';
import { yawQuat } from '../../src/util/vec';
import { createAnalyticWorld, makeSpec } from '../../src/world/analytic-world';
import { CRAFTS, DEFAULT_CRAFT, RATE, RIG_VERSION, SCENARIOS, VARIANTS, type CraftId, type RenderRequest, type RenderResult, type SpeechClip, type SpeechSpan, type TruthRow } from './listen-types';

export type { CraftId, RenderRequest, RenderResult, ScenarioId, SoloName, SpeechClip, SpeechSpan, TruthRow, Variant } from './listen-types';

const FRAME_S = 1 / 60;

// ------------------------------------------------------------------ the motor stand-in

/** The harmonic amplitudes of a rotor's voice: the blade-pass harmonic and its double carry the tone (motor-sound.ts voiceHarmonics). */
function voiceHarmonics(blades: number): Float32Array {
    const n = blades * 2 + 2;
    const a = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) a[k] = 0.12 / k;
    a[1] = 0.35;
    a[blades] = 1;
    a[blades * 2] = 0.45;
    return a;
}

/** The flights' motor outputs are written for this hover output; a craft's own hover output scales them. */
const SCENARIO_HOVER = 0.42;

class MotorStandIn {
    private readonly rotorFullHz: number;
    private readonly scaleOut: number;
    private readonly master: GainNode;
    private readonly gains: GainNode[] = [];
    private readonly oscs: OscillatorNode[] = [];
    private readonly wash: GainNode;
    private readonly band: BiquadFilterNode;

    constructor(ctx: BaseAudioContext, out: AudioNode, craft: CraftId) {
        const c = CRAFTS[craft];
        const blades = c.blades;
        this.rotorFullHz = c.rotorFullHz;
        this.scaleOut = c.hoverOut / SCENARIO_HOVER;
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(out);
        const h = voiceHarmonics(blades);
        const wave = ctx.createPeriodicWave(new Float32Array(h.length), h, { disableNormalization: false });
        for (let k = 0; k < 4; k++) {
            const o = ctx.createOscillator();
            o.setPeriodicWave(wave);
            o.frequency.value = 25;
            const g = ctx.createGain();
            g.gain.value = 0;
            o.connect(g);
            g.connect(this.master);
            o.start();
            this.oscs.push(o);
            this.gains.push(g);
        }
        const len = Math.round(ctx.sampleRate * 2);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        const rng = createRng(4242);
        for (let i = 0; i < len; i++) d[i] = rng.next() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        noise.loop = true;
        this.band = ctx.createBiquadFilter();
        this.band.type = 'bandpass';
        this.band.Q.value = 0.9;
        this.wash = ctx.createGain();
        this.wash.gain.value = 0;
        noise.connect(this.band);
        this.band.connect(this.wash);
        this.wash.connect(this.master);
        noise.start();
    }

    /**
     * motorMix() of motor-sound.ts for four motors at `m` (slightly apart, as a real quad's), the airspeed and the
     * volume slider (0..100). `m` is the flight's output for a craft that hovers at SCENARIO_HOVER: scaled to this one.
     */
    apply(at: number, flightM: number, speed: number, volume: number): void {
        const m = Math.min(Math.max(flightM * this.scaleOut, 0), 1);
        const ROTOR_FULL_HZ = this.rotorFullHz;
        const vol = Math.min(Math.max(volume, 0), 100) / 100;
        this.master.gain.setTargetAtTime(Math.pow(vol, 1.5) * 0.7, at, 0.03);
        const spread = [1, 1.012, 0.991, 1.006];
        for (let k = 0; k < 4; k++) {
            const mk = Math.min(Math.max(m * (spread[k] as number), 0), 1);
            (this.oscs[k] as OscillatorNode).frequency.setTargetAtTime(Math.min(Math.max(mk * ROTOR_FULL_HZ, 25), 3000), at, 0.03);
            (this.gains[k] as GainNode).gain.setTargetAtTime(0.18 * Math.pow(mk, 0.8), at, 0.03);
        }
        const air = Math.min(Math.max(speed / 25, 0), 1);
        this.wash.gain.setTargetAtTime(0.45 * m * m + 0.25 * air * air, at, 0.03);
        this.band.frequency.setTargetAtTime(Math.min(Math.max(400 + 2.2 * m * ROTOR_FULL_HZ, 300), 6000), at, 0.03);
    }
}

// ------------------------------------------------------------------ scripted flights

interface Frame {
    readonly pos: Vec3;
    readonly vel: Vec3;
    readonly yawDeg: number;
    /** the motor's output now */
    readonly motor: number;
}

interface Scenario {
    readonly seconds: number;
    readonly layers: LessonLayers;
    readonly prefs: SonicPrefs;
    readonly world: SonicWorld | null;
    readonly frame: (t: number) => Frame;
    readonly target: (t: number) => SonicObject | null;
    /** lines to say: key of the clip, at time t */
    readonly say: readonly { readonly t: number; readonly key: string }[];
    readonly events: readonly { readonly t: number; readonly run: (e: FlyBySoundEngine) => void }[];
    readonly motorVolume: number | null;
    /** for the approaches: the wall's plane z, to give the hull distance */
    readonly wallZ: number | null;
    /** lane sonic-beacon (S4): the frame's beacon field (SonicFrameInput.beacon), when the flight has one */
    readonly beacon?: (t: number, f: Frame) => SonicObject | null;
    /** lane sonic-beacon (S4): the beacon ring's pose at t */
    readonly pose?: (t: number) => { readonly k: number; readonly azDeg: number; readonly distM: number } | null;
    /** lane sonic-beacon (S5, review R4): the true beacon point (the runner's rule), recorded as an azimuth from the nose */
    readonly truthBeacon?: (t: number, f: Frame) => Vec3 | null;
}

const hall = createAnalyticWorld(makeSpec('hall', {}, 1));
const HALL_FRONT_Z = -30;
const rings = createAnalyticWorld(makeSpec('rings', { layout: 'single', aheadM: 12, sizeM: 3 }, 1));
const ring = rings.objects().find((o) => o.order !== null) as SonicObject;
const BODY = 0.12;

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** tunnel-gaps' world and its track (the start, then the world's checkpoints through the free ways), and its length, m */
const GAPS = ((): { readonly world: SonicWorld; readonly layers: LessonLayers; readonly path: readonly Vec3[]; readonly at: readonly number[] } => {
    const lesson = getLesson('tunnel-gaps');
    if (lesson.world.kind !== 'analytic') throw new Error('tunnel-gaps has an analytic world');
    const world = createAnalyticWorld(lesson.world.spec);
    const path: Vec3[] = [lesson.start.pos, ...(world.checkpoints ?? []).map((c) => c.pos)];
    const at: number[] = [0];
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1] as Vec3;
        const b = path[i] as Vec3;
        at.push((at[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    return { world, layers: lesson.layers, path, at };
})();
/** The gaps flight's speed along the track, m/s (the lesson's cap is 2.5), and the second it holds still first. */
export const GAPS_SPEED = 2;
const GAPS_HOLD_S = 1;

/** Where the gaps flight is `s` m along the track, and its velocity there. */
function alongGaps(s: number, v: number): { readonly pos: Vec3; readonly vel: Vec3 } {
    const total = GAPS.at[GAPS.at.length - 1] as number;
    const d = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < GAPS.at.length - 1 && (GAPS.at[i] as number) < d) i++;
    const a = GAPS.path[i - 1] as Vec3;
    const b = GAPS.path[i] as Vec3;
    const len = Math.max(1e-9, (GAPS.at[i] as number) - (GAPS.at[i - 1] as number));
    const u = (d - (GAPS.at[i - 1] as number)) / len;
    const moving = s > 0 && s < total;
    return { pos: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], vel: moving ? [((b[0] - a[0]) / len) * v, ((b[1] - a[1]) / len) * v, ((b[2] - a[2]) / len) * v] : [0, 0, 0] };
}

/** The free chime's two plays: from up at FREE_PLAYS_S[0], from down at [1], each FREE_PLAY_S long. */
export const FREE_PLAYS_S: readonly number[] = [0.3, 3.6];
export const FREE_PLAY_S = 2.5;

/**
 * The hover band's held heights (hover-height's band, 2 to 3 m, its target the centre, 2.5 m), each for HOVER_HOLD_S:
 * the target, 5, 10, 20 and 30 cm under it, 2.05 m near the band's edge, 20 and 45 cm over it, then out of the band
 * under it and over it (the buzz).
 */
export const HOVER_HEIGHTS: readonly number[] = [2.5, 2.45, 2.4, 2.3, 2.2, 2.05, 2.7, 2.95, 1.6, 3.4];
export const HOVER_HOLD_S = 2.5;


// ------------------------------------------------------------------ lane sonic-beacon (S4): the beacon's flights

/**
 * The beacon ring: the craft hovers still at BEACON_RING_POS facing -z; the target (a zone, as the runner's beacon is)
 * holds each pose for its hold time: every 20 degrees from 10 to 170 on both sides at 10 m (side), 120 on both sides
 * (fold), 0, 5 and 12 degrees on both sides (on course), then 30 degrees right at 5, 20 and 40 m (heard from afar).
 * [azimuth from the nose, + right, degrees; distance, m; hold, s]. The holds are estimates: long enough for the hum's
 * slowest tempo (1.2 Hz at 40 m) to play notes in the measured last part of the hold.
 */
export const BEACON_POSES: readonly (readonly [number, number, number])[] = [
    ...[10, 30, 50, 70, 90, 110, 130, 150, 170].flatMap((a) => [[a, 10, 1.6] as const, [-a, 10, 1.6] as const]),
    [120, 10, 1.6],
    [-120, 10, 1.6],
    [0, 10, 1.6],
    [5, 10, 1.6],
    [-5, 10, 1.6],
    [12, 10, 1.6],
    [-12, 10, 1.6],
    [30, 5, 3],
    [30, 20, 3],
    [30, 40, 3]
];
const BEACON_RING_POS: Vec3 = [0, 2, 0];
const BEACON_POSE_T0: readonly number[] = BEACON_POSES.reduce<number[]>((acc, p, i) => [...acc, (acc[i] as number) + p[2]], [0.5]);

function beaconPoseAt(t: number): { readonly k: number; readonly azDeg: number; readonly distM: number } | null {
    for (let k = 0; k < BEACON_POSES.length; k++) {
        if (t >= (BEACON_POSE_T0[k] as number) && t < (BEACON_POSE_T0[k + 1] as number)) {
            const p = BEACON_POSES[k] as readonly [number, number, number];
            return { k, azDeg: p[0], distM: p[1] };
        }
    }
    return null;
}

function zoneAt(id: string, pos: Vec3): SonicObject {
    return { id, shape: { kind: 'zone', size: [1, 1, 1] }, pos, quat: [1, 0, 0, 0], order: null, solid: false, material: 'obstacle' };
}

/** The lesson the beacon path flies: the corridor and the widest tunnel (the owner's "wide corridor, high ceiling"). */
const BEACON_PATH_LESSON = { 'beacon-corridor': 'corridor', 'beacon-tunnel': 'tunnel-wide' } as const;
/** Speed along the track, m/s, the still second first, the yaw rate limit, degrees/s, and the longest flight, s (estimates). */
const BEACON_PATH_SPEED = 2;
const BEACON_PATH_HOLD_S = 1;
const BEACON_PATH_YAW_RATE = 90;
const BEACON_PATH_MAX_S = 40;
/**
 * Lane sonic-beacon (S5, review R4), the off-line flights: the nose held BEACON_OFFLINE_YAW_DEG off the track, to the
 * right and to the left in turn, each for BEACON_OFFLINE_PERIOD_S (the first BEACON_OFFLINE_RAMP_S of it turning
 * over), from BEACON_OFFLINE_T0_S on, and the craft BEACON_OFFLINE_LATERAL_M right of the track's line. Estimates: the
 * review asks for 30 to 45 degrees off for a few seconds and a lateral offset; the time pattern does not follow the
 * bends, so holds fall before, across and after them alike.
 */
const BEACON_OFFLINE_YAW_DEG = 40;
const BEACON_OFFLINE_PERIOD_S = 3;
const BEACON_OFFLINE_RAMP_S = 0.5;
const BEACON_OFFLINE_T0_S = 1.5;
const BEACON_OFFLINE_LATERAL_M = 0.8;

function offlineYawDeg(t: number): number {
    if (t < BEACON_OFFLINE_T0_S) return 0;
    const ph = (t - BEACON_OFFLINE_T0_S) / BEACON_OFFLINE_PERIOD_S;
    const k = Math.floor(ph);
    const sign = k % 2 === 0 ? 1 : -1;
    const from = k === 0 ? 0 : -sign;
    const u = ((ph - k) * BEACON_OFFLINE_PERIOD_S) / BEACON_OFFLINE_RAMP_S;
    return BEACON_OFFLINE_YAW_DEG * (from + (sign - from) * smooth(u));
}

const fwdOf = (yawDeg: number): Vec3 => [Math.sin((yawDeg * Math.PI) / 180), 0, -Math.cos((yawDeg * Math.PI) / 180)];
const rightOf = (yawDeg: number): Vec3 => [Math.cos((yawDeg * Math.PI) / 180), 0, Math.sin((yawDeg * Math.PI) / 180)];

/** Azimuth of p from a craft at pos with the nose at yawDeg, + right, degrees. */
function azimuthDeg(pos: Vec3, yawDeg: number, p: Vec3): number {
    const r: Vec3 = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
    const f = fwdOf(yawDeg);
    const q = rightOf(yawDeg);
    return (Math.atan2(r[0] * q[0] + r[2] * q[2], r[0] * f[0] + r[2] * f[2]) * 180) / Math.PI;
}

interface TrackFlight {
    readonly world: SonicWorld;
    readonly layers: LessonLayers;
    readonly points: readonly Vec3[];
    readonly path: readonly Vec3[];
    readonly at: readonly number[];
    readonly sdf: ((x: number, y: number, z: number) => number) | null;
    readonly yawAt: readonly number[];
}

function trackFlight(lessonId: string): TrackFlight {
    const lesson = getLesson(lessonId);
    if (lesson.world.kind !== 'analytic') throw new Error(`${lessonId} has an analytic world`);
    const world = createAnalyticWorld(lesson.world.spec);
    const points = (world.checkpoints ?? []).map((c) => c.pos);
    const path: Vec3[] = [lesson.start.pos, ...points];
    const at: number[] = [0];
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1] as Vec3;
        const b = path[i] as Vec3;
        at.push((at[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    // the craft flies with its nose along the track (the heading the pilot would hold), turning at most
    // BEACON_PATH_YAW_RATE degrees a second: a yaw per frame, made once
    const sdf = (world as unknown as { sdf?: (x: number, y: number, z: number) => number }).sdf ?? null;
    const yawAt: number[] = [];
    let yaw = lesson.start.yawDeg;
    for (let k = 0; k * FRAME_S < BEACON_PATH_MAX_S + 1; k++) {
        const s = Math.max(0, (k * FRAME_S - BEACON_PATH_HOLD_S) * BEACON_PATH_SPEED);
        let i = 1;
        while (i < at.length - 1 && (at[i] as number) < s) i++;
        const a = path[i - 1] as Vec3;
        const b = path[i] as Vec3;
        const want = yawOf([b[0] - a[0], 0, b[2] - a[2]]);
        const d = ((((want - yaw) % 360) + 540) % 360) - 180;
        yaw += Math.max(-BEACON_PATH_YAW_RATE * FRAME_S, Math.min(BEACON_PATH_YAW_RATE * FRAME_S, d));
        yawAt.push(yaw);
    }
    return { world, layers: lesson.layers, points, path, at, sdf, yawAt };
}

function scenarioOf(req: RenderRequest): Scenario {
    const base = defaultPrefs();
    switch (req.scenario) {
        case 'height-climb': {
            // from 0.5 m up to 4.5 m at 0.5 m/s, a second still at each end; no band (no roughness), no target tone:
            // the height tone alone, to track its pitch
            const prefs: SonicPrefs = { ...base, heightTarget: false };
            return {
                seconds: 10,
                layers: { on: ['height'], heightBandM: null, hazardVoices: 0 },
                prefs,
                world: null,
                frame: (t) => {
                    const u = Math.min(Math.max((t - 1) / 8, 0), 1);
                    return { pos: [0, 0.5 + 4 * u, 0], vel: [0, t > 1 && t < 9 ? 0.5 : 0, 0], yawDeg: 0, motor: 0.4 };
                },
                target: () => null,
                say: [],
                events: [],
                motorVolume: null,
                wallZ: null
            };
        }
        case 'approach-1':
        case 'approach-3':
        case 'approach-5': {
            // straight at the hall's front wall at v, from 4.3 s before contact to 0.3 m from it
            const v = Number(req.scenario.slice(9));
            const d0 = 4.3 * v;
            const seconds = (d0 - 0.3) / v;
            const z0 = HALL_FRONT_Z + BODY + d0;
            return {
                seconds,
                layers: { on: ['safety'], heightBandM: null, hazardVoices: 1 },
                prefs: base,
                world: hall,
                frame: (t) => ({ pos: [0, 3, z0 - v * t], vel: [0, 0, -v], yawDeg: 0, motor: 0.5 }),
                target: () => null,
                say: [],
                events: [],
                motorVolume: null,
                wallZ: HALL_FRONT_Z
            };
        }
        case 'hover-band': {
            // the height layer alone, a target (the band centre) and the band's roughness: in the band one tone at a
            // time (the glide, then the target note in its place); out of it the glide buzzes
            return {
                seconds: HOVER_HEIGHTS.length * HOVER_HOLD_S,
                layers: { on: ['height'], heightBandM: [2, 3], hazardVoices: 0 },
                prefs: base,
                world: null,
                frame: (t) => ({ pos: [0, HOVER_HEIGHTS[Math.min(Math.floor(t / HOVER_HOLD_S), HOVER_HEIGHTS.length - 1)] as number, 0], vel: [0, 0, 0], yawDeg: 0, motor: 0.42 }),
                target: () => null,
                say: [],
                events: [],
                motorVolume: null,
                wallZ: null
            };
        }
        case 'free-chime': {
            // the chime a lesson plays for a way above, then for a way below: the safety layer alone, the craft still
            const off = req.variant === 'direction-off' || req.variant === 'direction-off-dry';
            return {
                seconds: 6.5,
                layers: { on: ['safety'], heightBandM: null, hazardVoices: 3 },
                prefs: { ...base, heightDirection: !off },
                world: null,
                frame: () => ({ pos: [0, 1.5, 0], vel: [0, 0, 0], yawDeg: 0, motor: 0 }),
                target: () => null,
                say: [],
                events: [
                    { t: FREE_PLAYS_S[0] as number, run: (e) => e.cue({ kind: 'repeat-cue', cue: 'safety.free', dir: [0, 1, 0], index: 1, of: 1, durS: FREE_PLAY_S }) },
                    { t: FREE_PLAYS_S[1] as number, run: (e) => e.cue({ kind: 'repeat-cue', cue: 'safety.free', dir: [0, -1, 0], index: 1, of: 1, durS: FREE_PLAY_S }) }
                ],
                motorVolume: null,
                wallZ: null
            };
        }
        case 'gaps-flight': {
            // tunnel-gaps along its track at GAPS_SPEED after a still second: the chime above (from 2.5 s), the ceiling over
            // the way above, the chime from the right, below with the floor under the way below, then from the left; the
            // lesson's layers, the motor and three spoken lines (the second over the way above, the third over the way below)
            const total = GAPS.at[GAPS.at.length - 1] as number;
            return {
                seconds: GAPS_HOLD_S + total / GAPS_SPEED + 0.5,
                layers: GAPS.layers,
                // 'direction-off': Sound from above and below off, so no voice has the breath (the breath's own effect)
                prefs: { ...base, heightDirection: req.variant !== 'direction-off' },
                world: GAPS.world,
                frame: (t) => {
                    const { pos, vel } = alongGaps((t - GAPS_HOLD_S) * GAPS_SPEED, GAPS_SPEED);
                    const moving = vel[0] !== 0 || vel[1] !== 0 || vel[2] !== 0;
                    return { pos, vel, yawDeg: 0, motor: moving ? 0.5 : 0.42 };
                },
                target: () => null,
                say: [
                    { t: 1.2, key: 'fly.go' },
                    { t: 5, key: 'lesson.rings-first.hint.1' },
                    { t: 10.5, key: 'fly.attempt' }
                ],
                events: [],
                motorVolume: req.variant === 'motor-raw-60' ? 60 : 15,
                wallZ: null
            };
        }
        case 'beacon-ring': {
            // lane sonic-beacon (S4): the hum from the target at each of BEACON_POSES, the craft still; the room layer and the
            // motor at a moving output (0.5, the gaps flight's) for the far poses; 'beacon-off': SonicPrefs.beacon false
            const seconds = (BEACON_POSE_T0[BEACON_POSE_T0.length - 1] as number) + 0.3;
            return {
                seconds,
                layers: { on: ['target', 'room'], heightBandM: null, hazardVoices: 2 },
                prefs: { ...base, beacon: req.variant !== 'beacon-off' },
                world: null,
                frame: () => ({ pos: BEACON_RING_POS, vel: [0, 0, 0], yawDeg: 0, motor: 0.5 }),
                target: (t) => {
                    const p = beaconPoseAt(t);
                    if (p === null) return null;
                    const a = (p.azDeg * Math.PI) / 180;
                    return zoneAt(`beacon:${p.k}`, [BEACON_RING_POS[0] + Math.sin(a) * p.distM, BEACON_RING_POS[1], BEACON_RING_POS[2] - Math.cos(a) * p.distM]);
                },
                say: [],
                events: [],
                motorVolume: 15,
                wallZ: null,
                pose: beaconPoseAt
            };
        }
        case 'beacon-corridor':
        case 'beacon-tunnel': {
            // lane sonic-beacon (S4): the lesson's world flown along its track at BEACON_PATH_SPEED after a still second, the
            // nose along the track; the frame's beacon is the runner's rule (beaconPointIndex over the world's checkpoints
            // after the last one passed, stepped back where a solid is in the way). 'no-target-layer': the lesson's
            // previous version, without the layer target (the owner's complaint of 2026-11-10)
            // 'off-line' (S5, review R4): the nose off the track and the craft off its line (offlineYawDeg,
            // BEACON_OFFLINE_LATERAL_M); its controls carry a wrong point in the frame's beacon field: 'off-line-mirror'
            // the true point mirrored left-right about the nose, 'off-line-ahead' a point straight ahead of the nose at the
            // true point's distance
            const fl = trackFlight(BEACON_PATH_LESSON[req.scenario]);
            const total = fl.at[fl.at.length - 1] as number;
            const offline = req.variant === 'off-line' || req.variant === 'off-line-mirror' || req.variant === 'off-line-ahead';
            const along = (t: number): { readonly pos: Vec3; readonly vel: Vec3; readonly seg: number } => {
                const s = Math.max(0, Math.min(total, (t - BEACON_PATH_HOLD_S) * BEACON_PATH_SPEED));
                let i = 1;
                while (i < fl.at.length - 1 && (fl.at[i] as number) < s) i++;
                const a = fl.path[i - 1] as Vec3;
                const b = fl.path[i] as Vec3;
                const len = Math.max(1e-9, (fl.at[i] as number) - (fl.at[i - 1] as number));
                const u = (s - (fl.at[i - 1] as number)) / len;
                const moving = t > BEACON_PATH_HOLD_S && s < total;
                const v = moving ? BEACON_PATH_SPEED / len : 0;
                return { pos: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], vel: [(b[0] - a[0]) * v, (b[1] - a[1]) * v, (b[2] - a[2]) * v], seg: i };
            };
            return {
                seconds: Math.min(BEACON_PATH_MAX_S, BEACON_PATH_HOLD_S + total / BEACON_PATH_SPEED + 0.5),
                layers: req.variant === 'no-target-layer' ? { ...fl.layers, on: fl.layers.on.filter((l) => l !== 'target') } : fl.layers,
                prefs: base,
                world: fl.world,
                frame: (t) => {
                    const { pos, vel } = along(t);
                    const k = Math.min(fl.yawAt.length - 1, Math.round(t / FRAME_S));
                    const yaw = fl.yawAt[k] as number;
                    const motor = vel[0] !== 0 || vel[2] !== 0 ? 0.5 : 0.42;
                    if (!offline) return { pos, vel, yawDeg: yaw, motor };
                    const r = rightOf(yaw);
                    const off: Vec3 = [pos[0] + r[0] * BEACON_OFFLINE_LATERAL_M, pos[1], pos[2] + r[2] * BEACON_OFFLINE_LATERAL_M];
                    return { pos: off, vel, yawDeg: yaw + offlineYawDeg(t), motor };
                },
                target: () => null,
                truthBeacon: (t, f) => {
                    // path[i] is checkpoint i - 1: on the way to path[seg] the checkpoints before seg - 1 are passed
                    const next = Math.max(0, along(t).seg - 1);
                    const sdf = fl.sdf;
                    const i = beaconPointIndex(fl.points, next, f.pos, sdf === null ? undefined : (a, b) => lineClear(sdf, a, b));
                    return i === null ? null : (fl.points[i] ?? null);
                },
                beacon: (t, f) => {
                    const next = Math.max(0, along(t).seg - 1);
                    const sdf = fl.sdf;
                    const i = beaconPointIndex(fl.points, next, f.pos, sdf === null ? undefined : (a, b) => lineClear(sdf, a, b));
                    const p = i === null ? undefined : fl.points[i];
                    if (p === undefined) return null;
                    if (req.variant === 'off-line-mirror' || req.variant === 'off-line-ahead') {
                        const q = rightOf(f.yawDeg);
                        const rel: Vec3 = [p[0] - f.pos[0], p[1] - f.pos[1], p[2] - f.pos[2]];
                        if (req.variant === 'off-line-mirror') {
                            const lat = rel[0] * q[0] + rel[2] * q[2];
                            return zoneAt(`beacon:${i}`, [p[0] - 2 * lat * q[0], p[1], p[2] - 2 * lat * q[2]]);
                        }
                        const h = Math.hypot(rel[0], rel[2]);
                        const fw = fwdOf(f.yawDeg);
                        return zoneAt(`beacon:${i}`, [f.pos[0] + fw[0] * h, p[1], f.pos[2] + fw[2] * h]);
                    }
                    return zoneAt(`beacon:${i}`, p);
                },
                say: [],
                events: [],
                motorVolume: null,
                wallZ: null
            };
        }
        case 'flight': {
            // rings-first: a still second, then forward at 3 m/s through the ring with a height wobble, praise,
            // a turn to the right, a run at the right wall at 4 m/s, a stop 1 m short of it, the bed and the motor
            // throughout, three spoken lines (ducking)
            const start = rings.start.pos;
            const ringT = 1 + (start[2] - ring.pos[2]) / 3;
            const turnT0 = ringT + 2;
            const turnT1 = turnT0 + 1.5;
            const zTurn = start[2] - 3 * (turnT0 - 1);
            const xWall = 30 - BODY - 1; // stop 1 m short of the right wall of the 60 m hall
            return {
                seconds: 16,
                layers: { on: ['safety', 'height', 'target', 'shape', 'room', 'voice'], heightBandM: null, hazardVoices: 2 },
                prefs: base,
                world: rings,
                frame: (t) => {
                    if (t < 1) return { pos: start, vel: [0, 0, 0], yawDeg: 0, motor: 0.42 };
                    if (t < turnT0) {
                        const z = start[2] - 3 * (t - 1);
                        const y = start[1] - 0.6 * Math.sin(((t - 1) * Math.PI) / (ringT - 1)) * (t < ringT ? 1 : 0);
                        return { pos: [0.4 * Math.sin(t), y, z], vel: [0.4 * Math.cos(t), 0, -3], yawDeg: 0, motor: 0.5 };
                    }
                    if (t < turnT1) {
                        const u = smooth((t - turnT0) / (turnT1 - turnT0));
                        return { pos: [0, start[1], zTurn], vel: [0, 0, 0], yawDeg: 90 * u, motor: 0.44 };
                    }
                    const x = Math.min(4 * (t - turnT1), xWall);
                    const moving = 4 * (t - turnT1) < xWall;
                    return { pos: [x, start[1], zTurn], vel: [moving ? 4 : 0, 0, 0], yawDeg: 90, motor: moving ? 0.55 : 0.42 };
                },
                target: (t) => (t < ringT ? ring : null),
                say: [
                    { t: 1.2, key: 'fly.go' },
                    { t: 6.5, key: 'lesson.rings-first.hint.1' },
                    { t: 11, key: 'fly.attempt' }
                ],
                events: [
                    { t: ringT, run: (e) => e.cue({ kind: 'gate', index: 0, of: 1 }) },
                    { t: ringT + 0.6, run: (e) => e.cue({ kind: 'praise' }) }
                ],
                motorVolume: req.variant === 'motor-raw-60' ? 60 : 15,
                wallZ: null
            };
        }
    }
}

// ------------------------------------------------------------------ speech that only keeps time

class ClockSpeech implements SpeechOut {
    private pending: { end: number; resolve: () => void }[] = [];
    readonly spans: SpeechSpan[] = [];
    now = 0;
    constructor(private readonly clips: readonly SpeechClip[]) {}
    get speaking(): boolean {
        return this.pending.length > 0;
    }
    speak(text: string, o: { readonly lang: string; readonly rate: number; readonly interrupt: boolean; readonly volume?: number }): Promise<void> {
        const clip = this.clips.find((c) => c.text === text);
        const durS = clip === undefined ? 0.4 + text.length * 0.065 : clip.durS;
        const t0 = this.now;
        this.spans.push({ key: clip?.key ?? '?', text, t0, t1: t0 + durS, volume: o.volume ?? 1 });
        return new Promise((resolve) => this.pending.push({ end: t0 + durS, resolve }));
    }
    cancel(): void {
        for (const p of this.pending) p.resolve();
        this.pending = [];
    }
    tick(t: number): void {
        this.now = t;
        const due = this.pending.filter((p) => p.end <= t);
        this.pending = this.pending.filter((p) => p.end > t);
        for (const p of due) p.resolve();
    }
}

// ------------------------------------------------------------------ rendering

function sampleOf(f: Frame, t: number): FlightSample {
    return { t: t * 1000, tick: Math.round(t * 1000), pos: f.pos, vel: f.vel, quat: yawQuat(f.yawDeg), rate: [0, 0, 0], yawDeg: f.yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

function base64(x: Float32Array): string {
    const bytes = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    return btoa(out);
}

const LINES: Readonly<Record<string, { readonly key: string; readonly params?: Readonly<Record<string, string | number>> }>> = {
    'fly.go': { key: 'fly.go' },
    'lesson.rings-first.hint.1': { key: 'lesson.rings-first.hint.1' },
    'fly.attempt': { key: 'fly.attempt', params: { n: 2 } }
};

export async function render(req: RenderRequest): Promise<RenderResult> {
    const sc = scenarioOf(req);
    const frames = Math.round(sc.seconds * RATE);
    const ctx = new OfflineAudioContext(4, frames, RATE);
    const merger = ctx.createChannelMerger(4);
    merger.connect(ctx.destination);
    const ears = ctx.createChannelSplitter(2);
    const pre = ctx.createGain();
    pre.channelCount = 2;
    pre.channelCountMode = 'explicit';
    const preSplit = ctx.createChannelSplitter(2);
    ears.connect(merger, 0, 0);
    ears.connect(merger, 1, 1);
    pre.connect(preSplit);
    preSplit.connect(merger, 0, 2);
    preSplit.connect(merger, 1, 3);
    const earsIn = ctx.createGain();
    earsIn.channelCount = 2;
    earsIn.channelCountMode = 'explicit';
    earsIn.connect(ears);
    const targetNotes: { t0: number; hz: number; noteS: number }[] = [];
    const hooks: EngineTestHooks = {
        destination: earsIn,
        tap: pre,
        onTargetNote: (t0, hz, noteS) => targetNotes.push({ t0, hz, noteS }),
        ...(req.solo === null ? {} : { solo: req.solo as readonly SoloPart[] }),
        ...(req.variant === 'stepped' ? { steppedHeight: true } : {}),
        ...(req.variant === 'seed-2' ? { noiseSeed: 2 } : {}),
        ...(req.variant === 'motor-raw-60' ? { motorBus: 'raw' as const } : {}),
        ...(req.variant === 'target-steady' ? { targetTone: 'steady' as const } : {}),
        ...(req.variant === 'dry' || req.variant === 'direction-off-dry' ? { bypassPanner: true } : {}),
        // the free chime's direct sound alone: the reverb return mixes every direction alike, with the panner or without
        ...(req.scenario === 'free-chime' ? { reverb: false } : {})
    };
    const speech = new ClockSpeech(req.clips);
    const engine = createSonicEngine({
        theme: getBuiltinTheme(req.theme),
        prefs: sc.prefs,
        layers: sc.layers,
        speech,
        pump: false,
        testHooks: hooks,
        ...(req.variant === 'distance-only' ? { sampler: { enterDistM: { front: 6, 'front-left': 5, 'front-right': 5, 'front-up': 3, 'front-down': 1.8, left: 4, right: 4, back: 3, up: 1.5, down: 1.5 }, enterTtcS: 0.1 } } : {})
    });
    await engine.start(ctx);
    const motor = sc.motorVolume === null ? null : new MotorStandIn(ctx, engine.motorInput as AudioNode, req.craft ?? DEFAULT_CRAFT);
    const truth: TruthRow[] = [];
    const says = [...sc.say].sort((a, b) => a.t - b.t);
    const events = [...sc.events].sort((a, b) => a.t - b.t);
    let nextSay = 0;
    let nextEvent = 0;
    const tick = (t: number): void => {
        speech.tick(t);
        while (nextSay < says.length && (says[nextSay] as { t: number }).t <= t + 1e-9) {
            const line = LINES[(says[nextSay++] as { key: string }).key];
            if (line !== undefined) void engine.say(line);
        }
        while (nextEvent < events.length && (events[nextEvent] as { t: number }).t <= t + 1e-9) (events[nextEvent++] as { run: (e: FlyBySoundEngine) => void }).run(engine);
        const f = sc.frame(t);
        const sample = sampleOf(f, t);
        const target = sc.target(t);
        const beacon = sc.beacon?.(t, f);
        engine.update({ sample, world: sc.world, target, floorY: 0, ...(beacon === undefined ? {} : { beacon }) });
        const plan = engine.plan;
        const speed = Math.hypot(f.vel[0], f.vel[1], f.vel[2]);
        if (motor !== null) motor.apply(ctx.currentTime, f.motor, speed, sc.motorVolume as number);
        truth.push({
            t,
            pos: f.pos,
            speedMps: speed,
            heightM: f.pos[1],
            targetM: plan?.height?.target?.heightM ?? null,
            heightHz: plan?.height?.hz ?? null,
            targetHz: plan?.height?.target?.hz ?? null,
            hazards: (plan?.scene?.hazards ?? []).map((h) => ({ sector: h.sector, distance: h.distance, ttcS: h.ttcS })),
            frontHullM: sc.wallZ === null ? null : f.pos[2] - sc.wallZ - BODY,
            freeSide: plan?.freeWay?.side ?? null,
            urgent: plan?.urgent ?? false,
            speaking: engine.speaking,
            motor: f.motor,
            chime: ((v) => (v === undefined ? null : { key: v.key, dir: v.dir, hz: v.hz, harmonyHz: v.harmonyHz ?? null }))(plan?.voices.find((v) => v.cue === 'safety.free')),
            voices: (plan?.voices ?? []).map((v) => ({ cue: v.cue, breath: v.airDb !== undefined })),
            hum: ((v) => (v === undefined ? null : { hz: v.hz, dir: v.dir }))(plan?.voices.find((v) => v.cue === 'target.hum' && v.key === 'target')),
            beaconPose: sc.pose?.(t) ?? null,
            beaconAzDeg: ((p) => (p === undefined || p === null ? null : azimuthDeg(f.pos, f.yawDeg, p)))(sc.truthBeacon?.(t, f))
        });
    };
    tick(0);
    // a line that ends un-ducks the engine in a promise's continuation: let those run before the render goes on,
    // so every render of a scenario is the same, sample for sample
    const flush = async (): Promise<void> => {
        for (let i = 0; i < 6; i++) await Promise.resolve();
    };
    const step = (k: number): void => {
        const t = k * FRAME_S;
        if (t >= sc.seconds - 0.02) return;
        void ctx.suspend(t).then(async () => {
            tick(t);
            await flush();
            step(k + 1);
            void ctx.resume();
        });
    };
    step(1);
    const buffer = await ctx.startRendering();
    const channels = [0, 1, 2, 3].map((c) => base64(buffer.getChannelData(c)));
    return { rate: RATE, frames, channels, truth, speech: speech.spans, targetNotes, userAgent: navigator.userAgent };
}

(globalThis as unknown as { SonicListen: unknown }).SonicListen = { render, RIG_VERSION, SCENARIOS, VARIANTS, CRAFTS };
