// The audio proofs (plan section 4.1 step 7; spec section 12): the real engine renders into an
// OfflineAudioContext in headless Chromium, frames are driven at 60 Hz through suspend/resume,
// and the rendered samples are measured. Each proof runs twice: on the engine as shipped (the
// check must pass) and on an engine broken on purpose by a test hook (the same check must fail),
// so a check that cannot fail proves nothing.
import type { CueEvent, FlightSample, LessonLayers, SonicFrameInput, SonicObject, ThemeDef, Vec3 } from '../../src/contract';
import { LAYER_IDS } from '../../src/contract';
import { createSonicEngine, type EngineOptions, type FlyBySoundEngine } from '../../src/audio';
import { dbToGain, pulsePeriodMs } from '../../src/cues/rules';
import { MAX_MOVING_VOICES } from '../../src/cues/voices';
import { defaultPrefs } from '../../src/prefs/prefs';
import { getBuiltinTheme } from '../../src/theme/builtin';
import { createAnalyticWorld, makeSpec } from '../../src/world/analytic-world';
import { yawQuat } from '../../src/util/vec';

export const SAMPLE_RATE = 48000;
const FRAME_S = 1 / 60;

export interface Check {
    readonly ok: boolean;
    readonly measured: Readonly<Record<string, unknown>>;
}

export interface ProofResult {
    readonly name: string;
    readonly claim: string;
    readonly shipped: Check;
    readonly control: Check & { readonly broken: string };
    /** the shipped engine passes and the broken one fails */
    readonly pass: boolean;
}

interface Rendered {
    readonly left: Float32Array;
    readonly right: Float32Array;
    readonly engine: FlyBySoundEngine;
    readonly panners: number;
}

interface Scenario {
    readonly seconds: number;
    readonly engine: EngineOptions;
    readonly layers?: LessonLayers;
    /** the frame at time t, s (null: no frame then) */
    readonly frame: (t: number) => SonicFrameInput | null;
    /** things to do at given times, s */
    readonly at?: readonly { readonly t: number; readonly run: (e: FlyBySoundEngine) => void }[];
}

function flight(pos: Vec3, vel: Vec3, yawDeg = 0, t = 0): FlightSample {
    return { t: t * 1000, tick: Math.round(t * 1000), pos, vel, quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

async function render(s: Scenario): Promise<Rendered> {
    const ctx = new OfflineAudioContext(2, Math.round(s.seconds * SAMPLE_RATE), SAMPLE_RATE);
    // count every panner the engine makes
    let panners = 0;
    const make = ctx.createPanner.bind(ctx);
    ctx.createPanner = (): PannerNode => {
        panners++;
        return make();
    };
    const engine = createSonicEngine({ speech: null, pump: false, ...s.engine });
    if (s.layers !== undefined) engine.setLayers(s.layers);
    await engine.start(ctx);
    const actions = [...(s.at ?? [])].sort((a, b) => a.t - b.t);
    let next = 0;
    const tick = (t: number): void => {
        while (next < actions.length && (actions[next] as { t: number }).t <= t + 1e-9) (actions[next++] as { run: (e: FlyBySoundEngine) => void }).run(engine);
        const input = s.frame(t);
        if (input !== null) engine.update(input);
    };
    tick(0);
    const step = (k: number): void => {
        const t = k * FRAME_S;
        if (t >= s.seconds - 0.02) return;
        void ctx.suspend(t).then(() => {
            tick(t);
            step(k + 1);
            void ctx.resume();
        });
    };
    step(1);
    const buffer = await ctx.startRendering();
    return { left: buffer.getChannelData(0), right: buffer.getChannelData(1), engine, panners };
}

// ------------------------------------------------------------------ measures

function rms(x: Float32Array, from: number, to: number): number {
    const a = Math.max(0, Math.floor(from * SAMPLE_RATE));
    const b = Math.min(x.length, Math.floor(to * SAMPLE_RATE));
    let sum = 0;
    for (let i = a; i < b; i++) sum += (x[i] as number) * (x[i] as number);
    return Math.sqrt(sum / Math.max(1, b - a));
}

function peak(...xs: Float32Array[]): number {
    let p = 0;
    for (const x of xs) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i] as number));
    return p;
}

const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));

/** An 8th-order high-pass (four RBJ sections): the band where the ears' level difference lives, the low body of a note shut out by more than 60 dB. */
function highpass(x: Float32Array, cutoffHz: number): Float32Array {
    let y = x;
    for (let k = 0; k < 4; k++) y = highpass2(y, cutoffHz);
    return y;
}

/** An 8th-order low-pass (four RBJ sections). */
function lowpass(x: Float32Array, cutoffHz: number): Float32Array {
    let y = x;
    for (let k = 0; k < 4; k++) y = biquad(y, cutoffHz, 'low');
    return y;
}

/**
 * How much earlier the left ear hears the signal than the right, s (negative: the right ear first):
 * the lag of the largest cross-correlation within +-1.2 ms, the range of human interaural delays.
 */
function leftLeadS(left: Float32Array, right: Float32Array, from: number, to: number): number {
    const a = Math.floor(from * SAMPLE_RATE);
    const b = Math.floor(to * SAMPLE_RATE);
    const maxLag = Math.round(0.0012 * SAMPLE_RATE);
    let best = 0;
    let bestLag = 0;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = a + maxLag; i < b - maxLag; i++) sum += (left[i] as number) * (right[i + lag] as number);
        if (sum > best) {
            best = sum;
            bestLag = lag;
        }
    }
    return bestLag / SAMPLE_RATE;
}

function highpass2(x: Float32Array, cutoffHz: number): Float32Array {
    return biquad(x, cutoffHz, 'high');
}

function biquad(x: Float32Array, cutoffHz: number, kind: 'low' | 'high'): Float32Array {
    const w = (2 * Math.PI * cutoffHz) / SAMPLE_RATE;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    const b0 = kind === 'high' ? (1 + c) / 2 / a0 : (1 - c) / 2 / a0;
    const b1 = kind === 'high' ? -(1 + c) / a0 : (1 - c) / a0;
    const b2 = b0;
    const a1 = (-2 * c) / a0, a2 = (1 - alpha) / a0;
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const xi = x[i] as number;
        const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        y[i] = yi;
        x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    }
    return y;
}

/** Onsets of pulses: rising crossings of a fraction of the loudest 2 ms envelope, re-armed when it falls well below. */
function onsets(left: Float32Array, right: Float32Array, from: number, to: number): number[] {
    const win = Math.round(0.002 * SAMPLE_RATE);
    const a = Math.floor(from * SAMPLE_RATE);
    const b = Math.min(left.length, Math.floor(to * SAMPLE_RATE));
    const env: number[] = [];
    for (let i = a; i + win <= b; i += win) {
        let m = 0;
        for (let j = i; j < i + win; j++) m = Math.max(m, Math.abs((left[j] as number) + (right[j] as number)));
        env.push(m);
    }
    const top = Math.max(...env);
    const out: number[] = [];
    let armed = true;
    env.forEach((v, k) => {
        if (armed && v >= 0.3 * top) {
            out.push(from + (k * win) / SAMPLE_RATE);
            armed = false;
        } else if (!armed && v < 0.08 * top) armed = true;
    });
    return out;
}

const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

// ------------------------------------------------------------------ worlds and scenes

const soft = getBuiltinTheme('soft');
const hall = createAnalyticWorld(makeSpec('hall', {}, 1));
const HALL_HALF_W = 20;
const frontZ = -30;
const safetyOnly: LessonLayers = { on: ['safety'], heightBandM: null, hazardVoices: 3 };
const SAFETY = soft.layers.safety.params as Record<string, number>;
const RULE = { periodNearMs: SAFETY['periodNearMs'] as number, periodFarMs: SAFETY['periodFarMs'] as number, ttcFarS: SAFETY['ttcFarS'] as number, distM: SAFETY['pulseDistM'] as number };
const BODY = 0.12;

// ------------------------------------------------------------------ 1. direction

async function direction(): Promise<ProofResult> {
    const claim = 'a wall on the left is heard on the left and one on the right on the right: louder in the near ear over the whole band (2 dB or more) and above 2 kHz (8 dB or more), and earlier in the near ear below 800 Hz (0.25 ms or more); the craft 2.5 m from the wall drifts toward it at 1.2 m/s (2 s to contact: since v0.13 a still craft hears a wall only within 0.8 m)';
    const run = async (hooks: EngineOptions['testHooks']): Promise<Check> => {
        const side = async (x: number): Promise<{ broad: number; high: number; leadMs: number }> => {
            const r = await render({ seconds: 2, engine: { testHooks: hooks }, layers: safetyOnly, frame: (t) => ({ sample: flight([x, 3, 0], [Math.sign(x) * 1.2, 0, 0], 0, t), world: hall, target: null, floorY: 0 }) });
            const broad = db(rms(r.left, 0.3, 2)) - db(rms(r.right, 0.3, 2));
            const high = db(rms(highpass(r.left, 2000), 0.3, 2)) - db(rms(highpass(r.right, 2000), 0.3, 2));
            const leadMs = 1000 * leftLeadS(lowpass(r.left, 800), lowpass(r.right, 800), 0.3, 1.3);
            return { broad, high, leadMs };
        };
        const l = await side(-HALL_HALF_W + 2.5);
        const r = await side(HALL_HALF_W - 2.5);
        const ok = l.broad >= 2 && l.high >= 8 && l.leadMs >= 0.25 && r.broad <= -2 && r.high <= -8 && r.leadMs <= -0.25;
        return {
            ok,
            measured: {
                leftWall: { LminusRdb: round(l.broad), LminusRdbAbove2kHz: round(l.high), leftLeadsMsBelow800Hz: round(l.leadMs, 3) },
                rightWall: { LminusRdb: round(r.broad), LminusRdbAbove2kHz: round(r.high), leftLeadsMsBelow800Hz: round(r.leadMs, 3) },
                thresholds: { broadDb: 2, above2kHzDb: 8, leadMs: 0.25 }
            }
        };
    };
    const shipped = await run({});
    const control = await run({ bypassPanner: true });
    return { name: 'direction', claim, shipped, control: { ...control, broken: 'HRTF panner bypassed: both ears get the same signal' }, pass: shipped.ok && !control.ok };
}

// ------------------------------------------------------------------ 2. pulse rate

async function pulseRate(): Promise<ProofResult> {
    const claim = 'the safety pulse period matches the time-to-collision rule within 5 % for times to collision of 0.6, 1.2, 2 and 2.4 s (a wall is heard from 2.5 s since v0.13)';
    const cases = [0.6, 1.2, 2, 2.4];
    const distance = 11.9; // from the craft's centre to the front wall: the time to collision governs (x_ttc < x_distance)
    const run = async (hooks: EngineOptions['testHooks']): Promise<Check> => {
        const rows: Record<string, number>[] = [];
        let ok = true;
        for (const ttc of cases) {
            const v = (distance - BODY) / ttc;
            const expected = pulsePeriodMs(ttc, distance - BODY, RULE) / 1000;
            const seconds = Math.max(3, 1 + 6 * expected);
            const r = await render({ seconds, engine: { testHooks: hooks }, layers: { on: ['safety'], heightBandM: null, hazardVoices: 1 }, frame: (t) => ({ sample: flight([0, 3, frontZ + distance], [0, 0, -v], 0, t), world: hall, target: null, floorY: 0 }) });
            const on = onsets(r.left, r.right, 0.2, seconds - 0.1);
            const intervals = on.slice(1).map((t, i) => t - (on[i] as number));
            const measured = intervals.length >= 3 ? median(intervals) : NaN;
            const error = Math.abs(measured - expected) / expected;
            if (!(error <= 0.05)) ok = false;
            rows.push({ ttcS: ttc, expectedS: round(expected, 4), measuredS: round(measured, 4), relError: round(error, 4), pulses: on.length });
        }
        return { ok, measured: { cases: rows, tolerance: 0.05 } };
    };
    const shipped = await run({});
    const control = await run({ periodScale: 1.15 });
    return { name: 'pulse-rate', claim, shipped, control: { ...control, broken: 'every pulse period stretched by 15 %' }, pass: shipped.ok && !control.ok };
}

// ------------------------------------------------------------------ 3. ceiling

async function ceiling(): Promise<ProofResult> {
    const claim = 'with every layer at its maximum gain and everything sounding at once, no sample passes -6 dBFS';
    const loud: ThemeDef = { ...soft, master: { ...soft.master, gainDb: 0 } };
    const prefs = { ...defaultPrefs(), layerGainDb: Object.fromEntries(LAYER_IDS.map((l) => [l, 12])) };
    const narrow = createAnalyticWorld(makeSpec('corridor', { layout: 'straight', widthM: 2.4, heightM: 2.4, startHeightM: 1 }, 1));
    const gate: SonicObject = { id: 'g', shape: { kind: 'ring', diameter: 1.2, tube: 0.06 }, pos: [0.4, 1.4, -3], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
    const events: CueEvent[] = [{ kind: 'fanfare' }, { kind: 'touch', material: 'wall', dir: [-1, 0, 0], speed: 8 }, { kind: 'lap' }, { kind: 'gate', index: 2, of: 3 }, { kind: 'checkpoint' }];
    const ceilingLinear = dbToGain(loud.master.ceilingDb);
    const run = async (hooks: EngineOptions['testHooks']): Promise<Check> => {
        const r = await render({
            seconds: 3,
            engine: { theme: loud, prefs, testHooks: hooks },
            layers: { on: LAYER_IDS, heightBandM: [3, 4], hazardVoices: 3 },
            frame: (t) => ({ sample: flight([0.6, 0.5, -1 - 2 * t], [6, -2, -14], 0, t), world: narrow, target: gate, floorY: 0 }),
            at: events.map((e, i) => ({ t: 0.4 + 0.45 * i, run: (en: FlyBySoundEngine) => en.cue(e) }))
        });
        const p = peak(r.left, r.right);
        return { ok: p <= ceilingLinear, measured: { peak: round(p, 5), peakDbfs: round(db(p), 2), ceilingDbfs: loud.master.ceilingDb } };
    };
    const shipped = await run({});
    const control = await run({ limiter: false });
    return { name: 'ceiling', claim, shipped, control: { ...control, broken: 'compressor and soft clipper removed' }, pass: shipped.ok && !control.ok };
}

// ------------------------------------------------------------------ 4. fade-in

async function fadeIn(): Promise<ProofResult> {
    const claim = 'the output comes in over the theme fade (1 s) on start and again on a re-fade (resume, device change): under 0.1 of full in the first 50 ms, 0.4 to 0.6 at the middle, 0.97 or more after it, never falling';
    const fade = soft.master.fadeInS;
    const refadeAt = 2.5;
    const seconds = 4;
    // the engine is deterministic (seeded noise, the same schedule), so the render divided by the
    // same render without the fade is the fade's own gain, whatever the layers do meanwhile
    const scene = (hooks: EngineOptions['testHooks']): Promise<Rendered> =>
        render({
            seconds,
            engine: { testHooks: hooks },
            layers: { on: ['height', 'room'], heightBandM: null, hazardVoices: 0 },
            frame: (t) => ({ sample: flight([0, 2, 0], [0, 0, 0], 0, t), world: hall, target: null, floorY: 0 }),
            at: [{ t: refadeAt, run: (e) => e.fadeIn() }]
        });
    const reference = await scene({ fade: false });
    const refMono = mono(reference);
    const check = (r: Rendered): Check => {
        const m = mono(r);
        const gain = (t0: number, t1: number): number => {
            const ref = rms(refMono, t0, t1);
            return ref < 1e-6 ? NaN : rms(m, t0, t1) / ref;
        };
        const segment = (t0: number): { first: number; middle: number; after: number; monotonic: boolean; curve: number[] } => {
            const w = 0.025;
            const curve: number[] = [];
            for (let t = t0; t < t0 + fade + 0.1; t += w) curve.push(gain(t, t + w));
            const known = curve.filter((x) => Number.isFinite(x));
            let monotonic = true;
            for (let i = 1; i < known.length; i++) if ((known[i] as number) < (known[i - 1] as number) - 0.02) monotonic = false;
            return { first: gain(t0, t0 + 0.05), middle: gain(t0 + fade / 2 - 0.0125, t0 + fade / 2 + 0.0125), after: gain(t0 + fade + 0.02, t0 + fade + 0.2), monotonic, curve: curve.filter((_, i) => i % 4 === 0).map((x) => round(x, 3)) };
        };
        const a = segment(0.01);
        const b = segment(refadeAt + 0.01);
        const good = (x: ReturnType<typeof segment>): boolean => x.first < 0.1 && x.middle >= 0.4 && x.middle <= 0.6 && x.after >= 0.97 && x.monotonic;
        const show = (x: ReturnType<typeof segment>): Record<string, unknown> => ({ first50ms: round(x.first, 3), middle: round(x.middle, 3), afterFade: round(x.after, 3), monotonic: x.monotonic, every100ms: x.curve });
        return { ok: good(a) && good(b), measured: { method: 'rms of the render over rms of the same render without the fade, 25 ms windows', start: show(a), refade: show(b) } };
    };
    const shipped = check(await scene({}));
    const control = check(await scene({ fade: false }));
    return { name: 'fade-in', claim, shipped, control: { ...control, broken: 'no fade: full level at once' }, pass: shipped.ok && !control.ok };
}

function mono(r: Rendered): Float32Array {
    const out = new Float32Array(r.left.length);
    for (let i = 0; i < out.length; i++) out[i] = ((r.left[i] as number) + (r.right[i] as number)) / 2;
    return out;
}

// ------------------------------------------------------------------ 5. voice budget

async function voiceBudget(): Promise<ProofResult> {
    // lane s13-elev: the target height note has its own panner (it comes from the target), so 8 + 24 + 1
    const claim = `at most ${MAX_MOVING_VOICES} moving voices sound at once when 15 ask for one, the hazards keep theirs, and the engine makes no more than 8 + 24 panners and one for the target note`;
    const pillars = createAnalyticWorld(makeSpec('pillars', { layout: 'single', aheadM: 4, widthM: 8, heightM: 3, startHeightM: 0.6 }, 1));
    const run = async (hooks: EngineOptions['testHooks']): Promise<Check> => {
        const previews: CueEvent[] = Array.from({ length: 10 }, (_, i) => ({ kind: 'preview', cue: i % 2 === 0 ? 'shape.ring' : 'target.hum', dir: [Math.sin(i), 0, -Math.cos(i)] }));
        const gate: SonicObject = { id: 'g', shape: { kind: 'ring', diameter: 2, tube: 0.1 }, pos: [0, 1, 20], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
        let hazardsKept = true;
        const r = await render({
            seconds: 2,
            engine: { testHooks: hooks },
            frame: (t) => ({ sample: flight([2.6, 0.5, 26], [3, -1, -3], 0, t), world: pillars, target: gate, floorY: 0 }),
            at: [
                ...previews.map((e, i) => ({ t: 0.2 + 0.02 * i, run: (en: FlyBySoundEngine) => en.cue(e) })),
                {
                    t: 1,
                    run: (en: FlyBySoundEngine) => {
                        hazardsKept = en.stats().movingKeys.filter((k) => k.startsWith('safety:')).length >= 2;
                    }
                }
            ]
        });
        const stats = r.engine.stats();
        return {
            ok: stats.movingPeak <= MAX_MOVING_VOICES && r.panners <= MAX_MOVING_VOICES + 24 + 1 && hazardsKept,
            measured: { movingPeak: stats.movingPeak, budget: MAX_MOVING_VOICES, pannersMade: r.panners, hazardsKeptTheirVoices: hazardsKept }
        };
    };
    const shipped = await run({});
    const control = await run({ maxMovingVoices: 16 });
    return { name: 'voice-budget', claim, shipped, control: { ...control, broken: 'the budget raised to 16 moving voices' }, pass: shipped.ok && !control.ok };
}

// ------------------------------------------------------------------ 6 and 7. the target note from the target (lane s13-elev, review E6)

/**
 * The target-note scene: the height layer alone, the craft 0.3 m under a ring 3 m to its left, so the target note (its
 * pitch the ring's height) comes from the left through its own panner; at TARGET_TURN_S the craft faces the other way,
 * and the notes after it come from the right; then from behind and from ahead (TARGET_YAWS: two notes each, a note
 * every 1.25 s). Rendered twice with the same schedule: the height tone alone and the target notes alone
 * (EngineTestHooks.heightPart), the direct sound only (no reverb return).
 */
const TARGET_RING: SonicObject = { id: 'g', shape: { kind: 'ring', diameter: 1, tube: 0.05 }, pos: [-3, 2.5, 0], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
const TARGET_TURN_S = 1.9;
/** the craft's heading from each time on: the ring on the left, on the right, behind, ahead */
const TARGET_YAWS: readonly { readonly t: number; readonly yawDeg: number }[] = [
    { t: 0, yawDeg: 0 },
    { t: TARGET_TURN_S, yawDeg: 180 },
    { t: TARGET_TURN_S + 2.5, yawDeg: 90 },
    { t: TARGET_TURN_S + 5, yawDeg: -90 }
];
const TARGET_SCENE_S = 9.2;

async function targetScene(hooks: EngineOptions['testHooks']): Promise<{ tone: Rendered; note: Rendered; notes: { readonly t0: number; readonly noteS: number }[] }> {
    const notes: { t0: number; noteS: number }[] = [];
    const yawAt = (t: number): number => [...TARGET_YAWS].reverse().find((y) => t >= y.t)?.yawDeg ?? 0;
    const scene = (part: 'tone' | 'target'): Promise<Rendered> =>
        render({
            seconds: TARGET_SCENE_S,
            engine: { testHooks: { ...hooks, heightPart: part, reverb: false, ...(part === 'target' ? { onTargetNote: (t0: number, _hz: number, noteS: number) => notes.push({ t0, noteS }) } : {}) } },
            layers: { on: ['height'], heightBandM: null, hazardVoices: 0 },
            frame: (t) => ({ sample: flight([0, 2.2, 0], [0, 0, 0], yawAt(t), t), world: null, target: TARGET_RING, floorY: 0 })
        });
    const tone = await scene('tone');
    const note = await scene('target');
    return { tone, note, notes };
}

/** The longest time within one note (from 50 ms before it to 60 ms after its release) that the tone and the note are both above -60 dB of their own peaks, ms; and where it is. */
function noteToneOverlap(tone: Rendered, note: Rendered, notes: readonly { readonly t0: number; readonly noteS: number }[]): { maxMs: number; perNoteMs: number[]; startGapMs: number[]; endGapMs: number[] } {
    const floor = 10 ** (-60 / 20);
    const level = (r: Rendered, i: number): number => Math.max(Math.abs(r.left[i] as number), Math.abs(r.right[i] as number));
    const peakOf = (r: Rendered): number => peak(r.left, r.right);
    const tp = peakOf(tone);
    const np = peakOf(note);
    const perNoteMs: number[] = [];
    const startGapMs: number[] = [];
    const endGapMs: number[] = [];
    for (const n of notes) {
        const a = Math.max(0, Math.floor((n.t0 - 0.05) * SAMPLE_RATE));
        const b = Math.min(tone.left.length, Math.floor((n.t0 + n.noteS + 0.015 + 0.06) * SAMPLE_RATE));
        let both = 0;
        let toneLastBefore = -1;
        let noteFirst = -1;
        let noteLast = -1;
        let toneFirstAfter = -1;
        for (let i = a; i < b; i++) {
            const t = level(tone, i) / tp > floor;
            const m = level(note, i) / np > floor;
            if (t && m) both++;
            if (m) {
                if (noteFirst < 0) noteFirst = i;
                noteLast = i;
            }
        }
        for (let i = a; i < b; i++) if (level(tone, i) / tp > floor && (noteFirst < 0 || i < noteFirst)) toneLastBefore = i;
        for (let i = b - 1; i >= a; i--) if (level(tone, i) / tp > floor && i > noteLast) toneFirstAfter = i;
        perNoteMs.push(round((1000 * both) / SAMPLE_RATE, 3));
        startGapMs.push(round((1000 * (noteFirst - toneLastBefore)) / SAMPLE_RATE, 3));
        endGapMs.push(round((1000 * (toneFirstAfter - noteLast)) / SAMPLE_RATE, 3));
    }
    return { maxMs: Math.max(0, ...perNoteMs), perNoteMs, startGapMs, endGapMs };
}

async function targetNoteGap(): Promise<ProofResult> {
    const claim = 'a target note from the target (through its HRTF panner, whose response begins about 5.6 ms late) and the height tone never sound together: in every note of a render, no sample has both above -60 dB of their own peaks';
    const run = async (hooks: EngineOptions['testHooks']): Promise<Check> => {
        const { tone, note, notes } = await targetScene(hooks);
        const o = noteToneOverlap(tone, note, notes);
        return { ok: notes.length >= 3 && o.maxMs === 0, measured: { notes: notes.length, overlapMsPerNote: o.perNoteMs, toneOffToNoteOnMs: o.startGapMs, noteOffToToneOnMs: o.endGapMs, thresholdDb: -60 } };
    };
    const shipped = await run({});
    const control = await run({ hrtfTailS: 0 });
    return { name: 'target-note-gap', claim, shipped, control: { ...control, broken: 'the height tone back at the note\'s end, not after the HRTF\'s delay' }, pass: shipped.ok && !control.ok };
}

async function targetNotePan(): Promise<ProofResult> {
    const claim = 'a target note comes from its own direction from its first milliseconds: after the target moves from the left to the right, the next note\'s level difference between the ears over its first 20 ms is within 1 dB of the one over its held part';
    const run = async (hooks: EngineOptions['testHooks']): Promise<Check> => {
        const { note, notes } = await targetScene(hooks);
        const ild = (from: number, to: number): number => db(rms(note.left, from, to)) - db(rms(note.right, from, to));
        // the notes on the left and on the right (behind and ahead the two ears hear alike: no level difference to compare)
        const rows = notes.filter((n) => n.t0 < (TARGET_YAWS[2] as { t: number }).t).map((n) => ({ t0: round(n.t0, 3), onsetLminusRdb: round(ild(n.t0 + 0.006, n.t0 + 0.026)), heldLminusRdb: round(ild(n.t0 + 0.1, n.t0 + n.noteS - 0.02)) }));
        const after = rows.filter((r) => r.t0 > TARGET_TURN_S);
        const before = rows.filter((r) => r.t0 < TARGET_TURN_S);
        const worst = Math.max(...after.map((r) => Math.abs(r.onsetLminusRdb - r.heldLminusRdb)));
        const sides = before.every((r) => r.heldLminusRdb > 3) && after.every((r) => r.heldLminusRdb < -3);
        return { ok: before.length >= 1 && after.length >= 1 && sides && worst <= 1, measured: { notes: rows, worstOnsetFromHeldDb: round(worst), thresholdDb: 1, turnS: TARGET_TURN_S } };
    };
    const shipped = await run({});
    const control = await run({ targetPanLeadS: 0 });
    return { name: 'target-note-pan', claim, shipped, control: { ...control, broken: 'the panner moved at the note\'s start, not 60 ms before it' }, pass: shipped.ok && !control.ok };
}

// ------------------------------------------------------------------ 8. a new lesson: the engine's reset (lane s13-int)

async function engineReset(): Promise<ProofResult> {
    const claim = 'a new lesson hears nothing of the last one: the craft flies at the left wall, then the host opens the next lesson (its frame clock back at 0, the craft at rest 3 m over the floor and 20 m from every wall, where a new engine voices no hazard) and calls engine.reset(); from the new lesson\'s first frame to the end of the sampler\'s hold (300 ms) no hazard of the last lesson is active and no moving voice holds one (the last lesson voiced the left wall up to the switch)';
    const switchK = 60; // frames: the switch at 1 s of audio time
    const switchS = switchK * FRAME_S;
    const near: Vec3 = [-HALL_HALF_W + 0.5, 3, 0];
    const middle: Vec3 = [0, 3, 0];
    const run = async (resetAtSwitch: boolean): Promise<Check> => {
        const hazards = (e: FlyBySoundEngine): { cues: string[]; voices: string[] } => ({
            cues: e.activeCues().map((c) => c.id).filter((id) => /^safety\.(wall|floor|ceiling|object)/.test(id)),
            voices: e.stats().movingKeys.filter((k) => k.startsWith('safety:'))
        });
        let before: { cues: string[]; voices: string[] } = { cues: [], voices: [] };
        const after: { ms: number; cues: string[]; voices: string[] }[] = [];
        // an action at frame k runs before that frame: it reads what frame k - 1 planned and played
        const reads = Array.from({ length: 18 }, (_, k) => ({ t: (switchK + k + 1) * FRAME_S, run: (e: FlyBySoundEngine) => void after.push({ ms: Math.round(k * FRAME_S * 1000), ...hazards(e) }) }));
        await render({
            seconds: 1.5,
            engine: {},
            layers: safetyOnly,
            // the last lesson: at the left wall at 1.5 m/s, 0.5 m from it at the switch; the next: at rest in the middle, its clock from 0
            frame: (t) =>
                t < switchS - 1e-9
                    ? { sample: flight([near[0] + 1.5 * (switchS - t), near[1], near[2]], [-1.5, 0, 0], 0, 60 + t), world: hall, target: null, floorY: 0 }
                    : { sample: flight(middle, [0, 0, 0], 0, t - switchS), world: hall, target: null, floorY: 0 },
            at: [
                {
                    t: switchS,
                    run: (e: FlyBySoundEngine) => {
                        before = hazards(e);
                        if (resetAtSwitch) e.reset();
                    }
                },
                ...reads
            ]
        });
        const held = after.filter((a) => a.cues.length > 0 || a.voices.length > 0);
        // the scene holds: the last lesson voiced the left wall at the switch, and a new engine voices nothing in the middle
        const fresh = createSonicEngine({ speech: null, pump: false });
        fresh.setLayers(safetyOnly);
        fresh.update({ sample: flight(middle, [0, 0, 0], 0, 0), world: hall, target: null, floorY: 0 });
        const freshHazards = (fresh.plan?.cues ?? []).map((c) => c.id).filter((id) => id.startsWith('safety.'));
        const scene = before.cues.includes('safety.wall:left') && freshHazards.length === 0;
        return { ok: scene && held.length === 0, measured: { atSwitch: before, newEngineInTheMiddle: freshHazards, framesOfTheHoldWithTheLastLesson: held.length, of: after.length, first: after[0] ?? null } };
    };
    const shipped = await run(true);
    const control = await run(false);
    return { name: 'engine-reset', claim, shipped, control: { ...control, broken: 'no engine.reset() when the next lesson opens' }, pass: shipped.ok && !control.ok };
}

function round(x: number, digits = 2): number {
    const f = 10 ** digits;
    return Math.round(x * f) / f;
}

// ------------------------------------------------------------------ entry

export interface ProofReport {
    readonly userAgent: string;
    readonly sampleRate: number;
    readonly proofs: readonly ProofResult[];
}

export const PROOFS: Readonly<Record<string, () => Promise<ProofResult>>> = { direction, 'pulse-rate': pulseRate, ceiling, 'fade-in': fadeIn, 'voice-budget': voiceBudget, 'target-note-gap': targetNoteGap, 'target-note-pan': targetNotePan, 'engine-reset': engineReset };

export async function runProofs(names: readonly string[] = Object.keys(PROOFS)): Promise<ProofReport> {
    const proofs: ProofResult[] = [];
    for (const name of names) {
        const proof = PROOFS[name];
        if (proof === undefined) throw new Error(`no proof '${name}'`);
        proofs.push(await proof());
    }
    return { userAgent: navigator.userAgent, sampleRate: SAMPLE_RATE, proofs };
}

/** A short flight rendered for listening (not a proof): returns the samples. */
export async function renderListen(themeId: 'soft' | 'clear' | 'race', seconds = 12): Promise<{ left: number[]; right: number[]; sampleRate: number }> {
    const rings = createAnalyticWorld(makeSpec('rings', { layout: 'line', count: 3, spacingM: 12, aheadM: 10 }, 1));
    const gates = rings.objects();
    const start = rings.start.pos;
    const speed = 4;
    let passed = 0;
    const r = await render({
        seconds,
        engine: { theme: getBuiltinTheme(themeId) },
        frame: (t) => {
            const z = start[2] - speed * Math.max(0, t - 1);
            const x = 1.2 * Math.sin(t * 0.7);
            const target = gates.find((g) => g.pos[2] < z - 0.2) ?? null;
            return { sample: flight([x, start[1] - 0.6 + 0.4 * Math.sin(t), z], [0.84 * Math.cos(t * 0.7), 0.4 * Math.cos(t), t < 1 ? 0 : -speed], 0, t), world: rings, target, floorY: 0 };
        },
        at: gates.map((g, i) => ({
            t: 1 + (start[2] - g.pos[2]) / speed,
            run: (e: FlyBySoundEngine) => {
                e.cue({ kind: 'gate', index: passed++, of: gates.length });
                if (i === gates.length - 1) e.cue({ kind: 'lap' });
            }
        }))
    });
    return { left: Array.from(r.left), right: Array.from(r.right), sampleRate: SAMPLE_RATE };
}

/**
 * Diagnostics (not a proof): renders one scene and reports the level of each ear, overall and above
 * 2 kHz, with the planned voices. `what`: 'hazard-left' (the direction proof's scene), or
 * 'preview-left' (a wall preview from the left, no world).
 */
export async function probe(what: string): Promise<Record<string, unknown>> {
    const scene: Scenario =
        what === 'preview-left'
            ? { seconds: 2.5, engine: {}, layers: safetyOnly, frame: (t) => ({ sample: flight([0, 0, 0], [0, 0, 0], 0, t), world: null, target: null, floorY: 0 }), at: [{ t: 0.05, run: (e) => e.cue({ kind: 'preview', cue: 'safety.wall', dir: [-1, 0, 0] }) }] }
            : { seconds: 2, engine: {}, layers: safetyOnly, frame: (t) => ({ sample: flight([-HALL_HALF_W + 2.5, 3, 0], [0, 0, 0], 0, t), world: hall, target: null, floorY: 0 }) };
    let voices: unknown = null;
    const r = await render({ ...scene, at: [...(scene.at ?? []), { t: 1, run: (e) => { voices = e.planner.plan(scene.frame(1) as SonicFrameInput).voices.map((v) => ({ key: v.key, dir: v.dir.map((x) => round(x, 3)), distance: round(v.distance, 2), gainDb: round(v.gainDb, 1), lowpassHz: Math.round(v.lowpassHz), send: round(v.reverbSend, 2), periodS: v.periodS })); } }] });
    return {
        what,
        broadLminusR: round(db(rms(r.left, 0.3, scene.seconds)) - db(rms(r.right, 0.3, scene.seconds))),
        highLminusR: round(db(rms(highpass(r.left, 2000), 0.3, scene.seconds)) - db(rms(highpass(r.right, 2000), 0.3, scene.seconds))),
        leftRmsDb: round(db(rms(r.left, 0.3, scene.seconds))),
        peakDb: round(db(peak(r.left, r.right))),
        voices
    };
}

(globalThis as unknown as { SonicProofs: unknown }).SonicProofs = { runProofs, renderListen, probe, PROOFS: Object.keys(PROOFS) };
