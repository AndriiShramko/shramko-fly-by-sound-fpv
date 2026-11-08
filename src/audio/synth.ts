// The instruments of the engine, synthesised with Web Audio nodes (spec section 2: no sample files).
// One function plays one note of a timbre at an exact audio time; persistent voices (a tone that
// glides, a roughness modulator) serve the continuous layers. Every envelope starts and ends at
// zero with a ramp, so nothing clicks. Every note carries a soft sub-octave, so every beacon has
// low-frequency energy (research 01 section 2: the motion cue works best below 500 Hz), and a
// quiet contact transient or breath of air between 2 and 6 kHz, so the HRTF has something to work
// with: level differences between the ears and the pinna cues of front, back and height live
// there (research 01 section 4). The pitch is the note; the transient is only its colour.
import type { Timbre } from '../contract';
import { createRng } from '../util/rng';

/** Shared material of the instruments: the context, a noise buffer, a seeded dice for noise offsets. */
export interface SynthKit {
    readonly ctx: BaseAudioContext;
    readonly noise: AudioBuffer;
    rand(): number;
}

export function createSynthKit(ctx: BaseAudioContext, seed = 1): SynthKit {
    const rng = createRng(seed);
    const seconds = 2;
    const noise = ctx.createBuffer(2, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = noise.getChannelData(ch);
        for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
    }
    return { ctx, noise, rand: () => rng.next() };
}

interface Partial {
    /** frequency over the note */
    readonly ratio: number;
    readonly amp: number;
    readonly type: OscillatorType;
    /** how much faster than the body this partial decays (1 = with the body) */
    readonly decay: number;
    /** detune in cents (a pad's chorus) */
    readonly cents?: number;
}

interface Recipe {
    readonly partials: readonly Partial[];
    /** amplitude of the sine an octave below (two octaves below a high note): low-frequency energy */
    readonly sub: number;
    readonly attackS: number;
    /** body decay to -60 dB for a note of length d, s; ignored when `sustain` */
    readonly decayS: (d: number) => number;
    /** hold for the note's length, then release over releaseS(d) */
    readonly sustain?: boolean;
    readonly releaseS?: (d: number) => number;
    /**
     * filtered noise: a contact transient, or (sustain) a breath that follows the note's envelope.
     * `centre` in Hz, or a multiple of the note when below 50. It bypasses the note's low-pass.
     */
    readonly noise?: { readonly amp: number; readonly centre: number; readonly q: number; readonly type: BiquadFilterType; readonly decayS: (d: number) => number; readonly sustain?: boolean };
    /** the pitch starts this many times higher and falls to the note in `timeS` (a knock, a thud) */
    readonly drop?: { readonly from: number; readonly timeS: number };
    /** low-pass over the note: a cutoff in Hz, or a multiple of the note when below 50 */
    readonly lowpass?: number;
    /** the low-pass falls from `from` times the note to the cutoff over the body (a pluck) */
    readonly sweepFrom?: number;
    /** overall level so the timbres sound about equally loud */
    readonly level: number;
}

const RECIPES: Readonly<Record<Timbre, Recipe>> = {
    // a soft marimba bar: the fundamental, a quiet double octave that fades first
    mallet: {
        partials: [
            { ratio: 1, amp: 1, type: 'sine', decay: 1 },
            { ratio: 4, amp: 0.14, type: 'sine', decay: 3 },
            { ratio: 2, amp: 0.05, type: 'sine', decay: 2 }
        ],
        sub: 0.3,
        attackS: 0.005,
        decayS: (d) => 0.18 + 4 * d,
        noise: { amp: 0.35, centre: 4500, q: 0.7, type: 'bandpass', decayS: () => 0.016 },
        level: 0.8
    },
    // a soft wooden knock: a short pitch fall and a breath of filtered noise
    wood: {
        partials: [
            { ratio: 1, amp: 1, type: 'sine', decay: 1 },
            { ratio: 2, amp: 0.12, type: 'triangle', decay: 2.5 }
        ],
        sub: 0.28,
        attackS: 0.003,
        decayS: (d) => 0.12 + 1.6 * d,
        drop: { from: 1.12, timeS: 0.014 },
        noise: { amp: 0.8, centre: 3000, q: 0.7, type: 'bandpass', decayS: () => 0.026 },
        lowpass: 4500,
        level: 0.85
    },
    // a low, padded thud: the floor
    thud: {
        partials: [{ ratio: 1, amp: 1, type: 'sine', decay: 1 }],
        sub: 0.55,
        attackS: 0.006,
        decayS: (d) => 0.2 + 2 * d,
        drop: { from: 1.6, timeS: 0.04 },
        lowpass: 700,
        noise: { amp: 0.3, centre: 2000, q: 0.8, type: 'bandpass', decayS: () => 0.022 },
        level: 0.9
    },
    // a puff of air: the ceiling, the speed ticks of the soft theme
    air: {
        partials: [{ ratio: 1, amp: 0.25, type: 'sine', decay: 1 }],
        sub: 0.16,
        attackS: 0.014,
        decayS: (d) => 0.12 + 3 * d,
        noise: { amp: 1, centre: 4, q: 1.1, type: 'bandpass', decayS: (d) => 0.1 + 2.5 * d },
        level: 0.8
    },
    // a small bell: pillars and bars; bright but filtered, so it never stings
    metal: {
        partials: [
            { ratio: 1, amp: 1, type: 'sine', decay: 1 },
            { ratio: 2.76, amp: 0.26, type: 'sine', decay: 1.7 },
            { ratio: 5.4, amp: 0.08, type: 'sine', decay: 3 }
        ],
        sub: 0.22,
        attackS: 0.002,
        decayS: (d) => 0.3 + 4 * d,
        lowpass: 6000,
        noise: { amp: 0.3, centre: 6000, q: 0.8, type: 'bandpass', decayS: () => 0.02 },
        level: 0.7
    },
    // a crisp, short beep an octave up: the parking-sensor theme
    click: {
        partials: [
            { ratio: 2, amp: 0.75, type: 'sine', decay: 1 },
            { ratio: 1, amp: 0.4, type: 'sine', decay: 0.8 }
        ],
        sub: 0.15,
        attackS: 0.0015,
        decayS: (d) => 0.03 + 1.2 * d,
        noise: { amp: 0.3, centre: 5000, q: 0.8, type: 'bandpass', decayS: () => 0.008 },
        level: 0.8
    },
    // a plucked string: a low-pass that closes as the note dies
    pluck: {
        partials: [
            { ratio: 1, amp: 1, type: 'triangle', decay: 1 },
            { ratio: 2, amp: 0.2, type: 'sine', decay: 1.6 }
        ],
        sub: 0.25,
        attackS: 0.003,
        decayS: (d) => 0.25 + 3 * d,
        lowpass: 2,
        sweepFrom: 8,
        noise: { amp: 0.3, centre: 3500, q: 0.8, type: 'bandpass', decayS: () => 0.015 },
        level: 0.85
    },
    // a warm pad: two triangles a few cents apart over a sub-octave, swelling in and out
    pad: {
        partials: [
            { ratio: 1, amp: 0.55, type: 'triangle', decay: 1, cents: -3 },
            { ratio: 1, amp: 0.55, type: 'triangle', decay: 1, cents: 3 },
            { ratio: 2, amp: 0.06, type: 'sine', decay: 1 }
        ],
        sub: 0.35,
        attackS: 0.04,
        decayS: () => 0,
        sustain: true,
        releaseS: (d) => Math.min(0.35, 0.15 + 0.5 * d),
        lowpass: 4,
        noise: { amp: 0.2, centre: 3200, q: 0.6, type: 'bandpass', decayS: () => 0, sustain: true },
        level: 0.75
    },
    // a plain sine with a rounded envelope
    sine: {
        partials: [{ ratio: 1, amp: 1, type: 'sine', decay: 1 }],
        sub: 0.2,
        attackS: 0.006,
        decayS: () => 0,
        sustain: true,
        releaseS: (d) => Math.min(0.25, 0.03 + 0.6 * d),
        noise: { amp: 0.15, centre: 4000, q: 0.7, type: 'bandpass', decayS: () => 0.014 },
        level: 0.8
    },
    // a short, hard noise burst: the race theme's ceiling
    noise: {
        partials: [],
        sub: 0.2,
        attackS: 0.002,
        decayS: (d) => 0.05 + 1.5 * d,
        noise: { amp: 1, centre: 1, q: 0.7, type: 'highpass', decayS: (d) => 0.05 + 1.5 * d },
        level: 0.6
    }
};

export interface NoteSpec {
    readonly timbre: Timbre;
    readonly hz: number;
    /** audio time of the start */
    readonly t0: number;
    /** the note's own length, s (a pulse, a melody note) */
    readonly durS: number;
    /** peak level, linear */
    readonly gain: number;
    /** detune of every partial, cents (Doppler) */
    readonly cents?: number;
    /** beating: a partner this many Hz above the fundamental at this depth (0..1) */
    readonly beatHz?: number;
    readonly beatDepth?: number;
    /** the whole note, tail included, ends by then (a pulse never runs into the next one), s after t0 */
    readonly maxS?: number;
}

const FLOOR = 0.001; // -60 dB: where an exponential envelope stops before its last short ramp to zero

/** Plays one note into `dest`; returns the audio time it is silent by. */
export function playNote(kit: SynthKit, dest: AudioNode, spec: NoteSpec): number {
    const { ctx } = kit;
    const r = RECIPES[spec.timbre];
    const t0 = Math.max(spec.t0, ctx.currentTime);
    const attack = r.attackS;
    const d = Math.max(spec.durS, 0.005);
    let body: number;
    let hold = 0;
    if (r.sustain === true) {
        hold = Math.max(0, d - attack);
        body = (r.releaseS ?? (() => 0.1))(d);
    } else body = r.decayS(d);
    let total = attack + hold + body;
    if (spec.maxS !== undefined && total > spec.maxS) {
        const room = Math.max(spec.maxS - attack, 0.02);
        if (r.sustain === true) {
            hold = Math.min(hold, room * 0.6);
            body = Math.max(room - hold, 0.015);
        } else body = room;
        total = attack + hold + body;
    }
    const end = t0 + total + 0.006;
    const peak = spec.gain * r.level;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (hold > 0) env.gain.setValueAtTime(peak, t0 + attack + hold);
    env.gain.exponentialRampToValueAtTime(Math.max(peak * FLOOR, 1e-7), t0 + attack + hold + body);
    env.gain.linearRampToValueAtTime(0, end);

    // the voice goes through a low-pass when the recipe has one
    let into: AudioNode = env;
    if (r.lowpass !== undefined) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 0.5;
        const cutoff = Math.min(r.lowpass < 50 ? r.lowpass * spec.hz : r.lowpass, 18000);
        if (r.sweepFrom !== undefined) {
            lp.frequency.setValueAtTime(Math.min(r.sweepFrom * spec.hz, 18000), t0);
            lp.frequency.exponentialRampToValueAtTime(Math.max(cutoff, 60), t0 + attack + body * 0.6);
        } else lp.frequency.value = cutoff;
        lp.connect(env);
        into = lp;
    }
    env.connect(dest);

    const cents = spec.cents ?? 0;
    const partials: Partial[] = [...r.partials];
    if (spec.beatDepth !== undefined && spec.beatDepth > 0 && spec.beatHz !== undefined && spec.beatHz > 0 && partials.length > 0) {
        // the beating partner rides the fundamental's own amplitude
        partials.push({ ratio: 1 + spec.beatHz / spec.hz, amp: (partials[0] as Partial).amp * Math.min(spec.beatDepth, 1), type: 'sine', decay: 1 });
    }
    if (r.sub > 0) partials.push({ ratio: spec.hz > 700 ? 0.25 : 0.5, amp: r.sub, type: 'sine', decay: 0.8 });

    for (const p of partials) {
        const hz = spec.hz * p.ratio;
        if (hz >= ctx.sampleRate / 2 - 100) continue;
        const osc = ctx.createOscillator();
        osc.type = p.type;
        if (r.drop !== undefined && p.ratio >= 0.9) {
            osc.frequency.setValueAtTime(hz * r.drop.from, t0);
            osc.frequency.exponentialRampToValueAtTime(hz, t0 + r.drop.timeS);
        } else osc.frequency.value = hz;
        osc.detune.value = cents + (p.cents ?? 0);
        const g = ctx.createGain();
        if (p.decay === 1 || r.sustain === true) g.gain.value = p.amp;
        else {
            g.gain.setValueAtTime(p.amp, t0);
            g.gain.exponentialRampToValueAtTime(p.amp * FLOOR, t0 + attack + hold + Math.max(body / p.decay, 0.01));
        }
        osc.connect(g);
        g.connect(into);
        osc.start(t0);
        osc.stop(end);
    }

    if (r.noise !== undefined) {
        const n = r.noise;
        const src = ctx.createBufferSource();
        src.buffer = kit.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = n.type;
        bp.frequency.value = Math.min(n.centre < 50 ? n.centre * spec.hz : n.centre, 16000);
        bp.Q.value = n.q;
        const g = ctx.createGain();
        if (n.sustain === true) g.gain.value = n.amp;
        else {
            const nd = Math.min(n.decayS(d), total);
            g.gain.setValueAtTime(n.amp, t0);
            g.gain.exponentialRampToValueAtTime(n.amp * FLOOR, t0 + attack + Math.max(nd, 0.005));
        }
        src.connect(bp);
        bp.connect(g);
        g.connect(env);
        const offset = kit.rand() * (kit.noise.duration - total - 0.05);
        src.start(t0, Math.max(0, offset));
        src.stop(end);
    }
    return end;
}

// ------------------------------------------------------------------ continuous voices

/** How a ToneVoice is built beyond its timbre. */
export interface ToneOptions {
    /** 'pad' or 'sine' family whatever the timbre says (the height tones are always 'sine', M41-12) */
    readonly family?: 'pad' | 'sine';
    /** false: no sub-octave (the target tone: one partial that beats against the height tone and nothing else) */
    readonly sub?: boolean;
}

/**
 * A tone that holds and glides: the height tone and its target tone, the shape trace, the room's
 * drone. A pad is two triangles over a sub-octave through a low-pass, the second 0.3 Hz above the
 * first: a slow swirl at every pitch, never a beating that could pass for the off-course cue; the
 * other timbres are a rounder sine over a sub-octave. The level is set by the caller (with ramps,
 * never jumps).
 */
export class ToneVoice {
    readonly output: GainNode;
    private readonly oscs: { osc: OscillatorNode; ratio: number; cents: number; offsetHz: number }[] = [];
    private readonly beat: OscillatorNode;
    private readonly beatGain: GainNode;
    private readonly lp: BiquadFilterNode;
    private hz = 0;
    private beatHzValue = 0;
    private airSource: AudioBufferSourceNode | null = null;

    /**
     * `air`: level of a breath of filtered noise (around 3.5 kHz) under the tone, for a voice that
     * must be placed in space (the shape trace); 0 for the centred tones. Needs the kit's noise.
     */
    constructor(private readonly ctx: BaseAudioContext, timbre: Timbre, startAt: number, air = 0, noise: AudioBuffer | null = null, options: ToneOptions = {}) {
        this.output = ctx.createGain();
        this.output.gain.value = 0;
        if (air > 0 && noise !== null) {
            const src = ctx.createBufferSource();
            src.buffer = noise;
            src.loop = true;
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 3500;
            bp.Q.value = 0.8;
            const g = ctx.createGain();
            g.gain.value = air;
            src.connect(bp);
            bp.connect(g);
            g.connect(this.output);
            src.start(startAt);
            this.airSource = src;
        }
        this.lp = ctx.createBiquadFilter();
        this.lp.type = 'lowpass';
        this.lp.Q.value = 0.4;
        this.lp.frequency.value = 3000;
        this.lp.connect(this.output);
        const pad = options.family === undefined ? timbre === 'pad' || timbre === 'air' || timbre === 'mallet' || timbre === 'pluck' || timbre === 'wood' || timbre === 'thud' : options.family === 'pad';
        const all: { type: OscillatorType; ratio: number; amp: number; offsetHz: number }[] = pad
            ? [
                  { type: 'triangle', ratio: 1, amp: 0.5, offsetHz: 0 },
                  { type: 'triangle', ratio: 1, amp: 0.5, offsetHz: 0.3 },
                  { type: 'sine', ratio: 0.5, amp: 0.35, offsetHz: 0 }
              ]
            : [
                  { type: 'sine', ratio: 1, amp: 0.85, offsetHz: 0 },
                  { type: 'sine', ratio: 2, amp: 0.06, offsetHz: 0 },
                  { type: 'sine', ratio: 0.5, amp: 0.25, offsetHz: 0 }
              ];
        const layers = options.sub === false ? all.filter((l) => l.ratio !== 0.5) : all;
        for (const l of layers) {
            const osc = ctx.createOscillator();
            osc.type = l.type;
            const g = ctx.createGain();
            g.gain.value = l.amp;
            osc.connect(g);
            g.connect(this.lp);
            osc.start(startAt);
            this.oscs.push({ osc, ratio: l.ratio, cents: 0, offsetHz: l.offsetHz });
        }
        this.beat = ctx.createOscillator();
        this.beatGain = ctx.createGain();
        this.beatGain.gain.value = 0;
        this.beat.connect(this.beatGain);
        this.beatGain.connect(this.lp);
        this.beat.start(startAt);
    }

    /** Glides to `hz` over about `glideS` from `at`; the low-pass follows (four times the note, at most 3 kHz). */
    setNote(hz: number, at: number, glideS: number): void {
        if (Math.abs(hz - this.hz) < 1e-6) return;
        const tc = Math.max(glideS, 0.001) / 3;
        for (const o of this.oscs) o.osc.frequency.setTargetAtTime(hz * o.ratio + o.offsetHz, at, tc);
        this.beat.frequency.setTargetAtTime(hz + this.beatHzValue, at, tc);
        this.lp.frequency.setTargetAtTime(Math.min(4 * hz, 3000), at, tc);
        this.hz = hz;
    }

    /** Doppler and other momentary bends, cents. */
    setCents(cents: number, at: number): void {
        for (const o of this.oscs) o.osc.detune.setTargetAtTime(cents + o.cents, at, 0.05);
        this.beat.detune.setTargetAtTime(cents, at, 0.05);
    }

    /** Beating: a partner `hz` above the note at `depth` (0..1). */
    setBeat(hz: number, depth: number, at: number): void {
        this.beatHzValue = hz;
        this.beat.frequency.setTargetAtTime(this.hz + hz, at, 0.05);
        this.beatGain.gain.setTargetAtTime(depth > 0 && hz > 0 ? 0.5 * Math.min(depth, 1) : 0, at, 0.08);
    }

    setLevel(gain: number, at: number, timeConstant = 0.05): void {
        this.output.gain.setTargetAtTime(gain, at, timeConstant);
    }

    stop(at: number): void {
        this.output.gain.setTargetAtTime(0, at, 0.03);
        for (const o of this.oscs) o.osc.stop(at + 0.3);
        this.beat.stop(at + 0.3);
        if (this.airSource !== null) this.airSource.stop(at + 0.3);
    }
}

/**
 * Amplitude-modulation roughness (spec principle 3: off course is roughness on a consonant tone):
 * the gain swings by `depth` at `hz` around 1 - depth / 2, so at depth 0 the signal passes untouched.
 */
export class Roughness {
    readonly input: GainNode;
    private readonly lfo: OscillatorNode;
    private readonly depthGain: GainNode;

    constructor(ctx: BaseAudioContext, startAt: number) {
        this.input = ctx.createGain();
        this.input.gain.value = 1;
        this.lfo = ctx.createOscillator();
        this.lfo.frequency.value = 38;
        this.depthGain = ctx.createGain();
        this.depthGain.gain.value = 0;
        this.lfo.connect(this.depthGain);
        this.depthGain.connect(this.input.gain);
        this.lfo.start(startAt);
    }

    get output(): AudioNode {
        return this.input;
    }

    set(depth: number, hz: number, at: number): void {
        const d = Math.min(Math.max(depth, 0), 1);
        this.lfo.frequency.setTargetAtTime(Math.max(hz, 1), at, 0.05);
        this.depthGain.gain.setTargetAtTime(d / 2, at, 0.06);
        this.input.gain.setTargetAtTime(1 - d / 2, at, 0.06);
    }

    stop(at: number): void {
        this.lfo.stop(at);
    }
}

/**
 * A warm synthetic hall for the reverb send: stereo decaying noise, darker as it fades (high
 * frequencies die first), after a short pre-delay. Seeded, so every run sounds the same.
 */
export function makeReverbImpulse(ctx: BaseAudioContext, rt60S = 1.8, seed = 7): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.round(rate * (rt60S + 0.3));
    const pre = Math.round(rate * 0.012);
    const buffer = ctx.createBuffer(2, length, rate);
    const rng = createRng(seed);
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let lp = 0;
        let energy = 0;
        for (let i = pre; i < length; i++) {
            const t = (i - pre) / rate;
            const decay = Math.exp((-6.91 * t) / rt60S);
            // one-pole low-pass whose cutoff falls from about 7 kHz to 900 Hz over the tail
            const cutoff = 7000 * Math.exp(-t * 1.2) + 900;
            const a = Math.exp((-2 * Math.PI * cutoff) / rate);
            lp = a * lp + (1 - a) * (rng.next() * 2 - 1);
            const v = lp * decay;
            data[i] = v;
            energy += v * v;
        }
        const norm = 1 / Math.sqrt(Math.max(energy, 1e-9));
        for (let i = 0; i < length; i++) (data as Float32Array)[i] = (data[i] as number) * norm * 0.5;
    }
    return buffer;
}
