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
// with seeded noise, played into the engine's motorInput. Not the simulator's code: its recipe.
import type { FlightSample, LessonLayers, SonicObject, SonicPrefs, SonicWorld, SpeechOut, Vec3 } from '../../src/contract';
import { createSonicEngine, type EngineTestHooks, type FlyBySoundEngine, type SoloPart } from '../../src/audio';
import { defaultPrefs } from '../../src/prefs/prefs';
import { getBuiltinTheme } from '../../src/theme/builtin';
import { createRng } from '../../src/util/rng';
import { yawQuat } from '../../src/util/vec';
import { createAnalyticWorld, makeSpec } from '../../src/world/analytic-world';
import { RATE, RIG_VERSION, SCENARIOS, VARIANTS, type RenderRequest, type RenderResult, type SpeechClip, type SpeechSpan, type TruthRow } from './listen-types';

export type { RenderRequest, RenderResult, ScenarioId, SoloName, SpeechClip, SpeechSpan, TruthRow, Variant } from './listen-types';

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

/** Rotor speed at full output: a 5-inch quad on 6S (KV 1950, 0.8 loaded, 22 V), Hz. */
const ROTOR_FULL_HZ = (1950 * 0.8 * 0.10471975511965977 * 22) / (2 * Math.PI);

class MotorStandIn {
    private readonly master: GainNode;
    private readonly gains: GainNode[] = [];
    private readonly oscs: OscillatorNode[] = [];
    private readonly wash: GainNode;
    private readonly band: BiquadFilterNode;

    constructor(ctx: BaseAudioContext, out: AudioNode, blades = 3) {
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

    /** motorMix() of motor-sound.ts for four motors at `m` (slightly apart, as a real quad's), the airspeed and the volume slider (0..100). */
    apply(at: number, m: number, speed: number, volume: number): void {
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
}

const hall = createAnalyticWorld(makeSpec('hall', {}, 1));
const HALL_FRONT_Z = -30;
const rings = createAnalyticWorld(makeSpec('rings', { layout: 'single', aheadM: 12, sizeM: 3 }, 1));
const ring = rings.objects().find((o) => o.order !== null) as SonicObject;
const BODY = 0.12;

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

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
    const hooks: EngineTestHooks = {
        destination: earsIn,
        tap: pre,
        ...(req.solo === null ? {} : { solo: req.solo as readonly SoloPart[] }),
        ...(req.variant === 'stepped' ? { steppedHeight: true } : {}),
        ...(req.variant === 'seed-2' ? { noiseSeed: 2 } : {}),
        ...(req.variant === 'motor-raw-60' ? { motorBus: 'raw' as const } : {})
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
    const motor = sc.motorVolume === null ? null : new MotorStandIn(ctx, engine.motorInput as AudioNode);
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
        engine.update({ sample, world: sc.world, target, floorY: 0 });
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
            motor: f.motor
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
    return { rate: RATE, frames, channels, truth, speech: speech.spans, userAgent: navigator.userAgent };
}

(globalThis as unknown as { SonicListen: unknown }).SonicListen = { render, RIG_VERSION, SCENARIOS, VARIANTS };
