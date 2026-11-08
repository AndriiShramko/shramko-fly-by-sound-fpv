// The Fly by Sound engine (contract SonicEngine; spec section 2): it builds the sound graph on an
// AudioContext the host made inside a user activation, takes one SonicFrameInput per frame, plans
// it with the pure CuePlanner (src/cues) and renders the plan:
//
//   moving voices (8)   notes / tone -> roughness -> low-pass -> level -> HRTF panner -> ILD -> layer bus
//                                                                       \-> reverb send
//   static voices (24)  one-off notes from a fixed direction (touch ping), HRTF panner -> layer bus
//   centre              height tone and its target notes, speed ticks, room bed and drone, gate notes, chimes
//   target panner       the target notes from the target's direction (lane s13-elev, SonicPrefs.heightDirection)
//   layer buses         theme gain + pilot gain -> duck (speech, urgent hazard) -> master
//   motor bus           the simulator's motor (motorInput) -> band-pass -> leveller -> level, pilot gain -> duck -> master (M41-16)
//   reverb              synthetic warm hall, return follows the room's openness
//   output              master -> compressor -> soft clipper at the ceiling -> fade -> destination
//
// Rhythm lives on the audio clock: pulses, hum repetitions, ticks and shape accents are placed with
// lookahead (src/cues/schedule.ts) whenever a frame or the engine's own 25 ms pump wakes it, never
// on timers alone. Panners use panningModel 'HRTF', set explicitly, with positions in the heading
// frame and the elevation raised 7.5 degrees (research 01 section 9); distance is coded by the
// engine itself (level slope, reverb send, low-pass, repetition, ILD boost, own Doppler), so the
// panners do no distance attenuation.
import type { ActiveCue, AudioContextLike, CueEvent, LayerId, LessonLayers, Locale, SonicEngine, SonicFrameInput, SonicPrefs, SpeechLine, SpeechOut, ThemeDef, Timbre } from '../contract';
import { LAYER_IDS } from '../contract';
import { CuePlanner, duckDb, layerGainDb, tracePosition, type FramePlan, type HeightPlan, type NotePlan, type VoicePlan } from '../cues/planner';
import { clamp, compressorMakeupDb, dbToGain, pannerDirection, URGENT_DUCK_DB } from '../cues/rules';
import { createPulseTrain, duePulses, LOOKAHEAD_S, type PulseTrain } from '../cues/schedule';
import { shapeAccents } from '../cues/shape';
import { MAX_MOVING_VOICES, MAX_STATIC_VOICES } from '../cues/voices';
import { DICTS } from '../i18n/dicts';
import { createTranslator, type Dicts, type Translator } from '../i18n/translator';
import { defaultPrefs } from '../prefs/prefs';
import type { SamplerOptions } from '../sense/sampler';
import { getBuiltinTheme } from '../theme/builtin';
import { createOutputChain, type OutputChain } from './output';
import { createBrowserSpeech, estimateSpeechS, type SpeakOptions } from './speech';
import { addAir, createSynthKit, makeReverbImpulse, playNote, Roughness, ToneVoice, type SynthKit } from './synth';

// Levels inside a layer, linear. With the shipped layer gains (-6 to -22 dB) and the master at -9 dB
// a busy moment peaks near -20 dBFS: generous headroom under the -6 dBFS ceiling.
const PULSE_GAIN = 0.55;
const HUM_GAIN = 0.5;
const SHAPE_TONE_GAIN = 0.26;
/** The breath of air under the shape tone, so the HRTF can place it (see synth.ts). */
const SHAPE_AIR = 0.18;
const ACCENT_GAIN = 0.42;
const NOTE_GAIN = 0.55;
const HEIGHT_GAIN = 0.34;
/** The target note's peak gain: its fundamental as loud as the height tone's (0.85 of the tone's voice), before the theme's height.targetDb. */
const TARGET_NOTE_GAIN = HEIGHT_GAIN * 0.85;
/** The height tone fades out over this before a target note and back in over it after the note's release, s. */
const TARGET_SWAP_S = 0.02;
/** A target note's attack and release, s: the two never overlap (at the same pitch they could cancel). */
const TARGET_ATTACK_S = 0.008;
const TARGET_RELEASE_S = 0.015;
/** A target note's soft octave over its fundamental: a touch brighter than the glide, so it is heard as the target's own. */
const TARGET_OCTAVE = 0.12;
/**
 * Lane s13-elev: a target note with a direction goes through the HRTF panner, whose impulse responses begin about
 * 5.6 ms late (Chrome's onset at sample 268 of 48 kHz, docs/design/virtual-listener.md 2.7) and ring on after it: the
 * note's sound at the ears stays above -60 dB of its peak until 8.5 to 9.2 ms after its end (measured from the left, the
 * right, behind and ahead: the target-note-gap proof). The height tone comes back this much later after such a note, so
 * the two never sound together, s. Review E6 of the lane: 6.5 ms, the delay alone, left 2.3 to 2.8 ms of overlap.
 */
const HRTF_TAIL_S = 0.012;
/**
 * Lane s13-elev: the target panner moves to the next note's direction this long before it, while it is silent, so
 * Chrome's crossfade between two directions (2048 frames, 43 ms at 48 kHz) is over when the note begins, s.
 */
const TARGET_PAN_LEAD_S = 0.06;
/** The constant input that keeps the target panner running between notes: 140 dB under full scale (review E6). */
const TARGET_KEEP_ALIVE = 1e-7;
/** The control's steady target tone (before review M2): 6 dB under the height tone. */
const STEADY_TARGET_DB = -6;
/** How fast the control's steady target tone moves to the next gate's note, s. */
const TARGET_GLIDE_S = 0.12;
const TICK_GAIN = 0.4;
const BED_GAIN = 0.5;
const DRONE_GAIN = 0.1;
const CENTRE_SEND = 0.12;
/** How strongly the room's openness feeds the reverb return. */
const REVERB_RETURN = 1.1;
/** The open-way chime's upper note: this much after the lower one (a quick two-note figure, not a chord), s, and this much softer. */
const HARMONY_DELAY_S = 0.07;
const HARMONY_GAIN = 0.8;
// The motor bus (M41-16; review M3): the simulator's motor sound under the cues. Its band is the propellers' whine
// (the blade-pass harmonics of a micro drone, 1.3 to 2.6 kHz at the micro presets' rotor speeds): it leaves the cues'
// notes (their own bands end at about 630 Hz; a micro rotor's own turning note, 450 to 900 Hz, sits right on them
// and goes) and keeps 12 dB or more off the cues' highs over 4 kHz, where the ear's pinna cues of direction live. The leveller holds a motor played
// at any volume of the simulator's slider within a few dB, so one level sits it under the cues; the pilot's own
// motor level (SonicPrefs.motorGainDb) comes after it; it ducks under speech by the theme's duckDb and under an
// urgent hazard as the other layers do.
/** Low-pass cutoff of the motor, Hz (second order). */
export const MOTOR_LOWPASS_HZ = 2000;
/** High-pass cutoff of the motor, Hz (fourth order, two second-order sections): a micro rotor's turning note goes, its whine stays. */
export const MOTOR_HIGHPASS_HZ = 1100;
/** The two sections of a fourth-order Butterworth high-pass. */
const BUTTERWORTH_4_Q = [0.5411961, 1.3065630] as const;
/** The leveller: threshold, knee and ratio of the motor's compressor (its make-up gain is taken back out). */
export const MOTOR_LEVELLER = { thresholdDb: -50, kneeDb: 6, ratio: 4, attackS: 0.03, releaseS: 0.3 } as const;
/**
 * Gain after the leveller, dB. Calibrated by the virtual listener's rig (pnpm listen, evidence/listen/VL-2-motor.json,
 * the numbers there) with the motors of the simulator's default craft, the micro presets and a 5-inch quad at the
 * slider's default 15 %: the motor sits about 11 LU under the cues of a ring flight (the plan: about 10) and every
 * cue stays more than 10 dB over it in its own third-octave bands (the rule: 6). With the first band (400 Hz to
 * 1.5 kHz, review M3) the same level left the shape trace 3.2 dB under the Air65's rotor note.
 */
export const MOTOR_LEVEL_DB = 14;
/** The engine's own wake-up, ms: keeps rhythms placed between frames. */
const PUMP_MS = 25;
/** With no frame for this long, the engine plans on from the last one (previews, menus), s. */
const STALE_S = 0.1;
/** Step of the shape trace's position automation, s. */
const TRACE_STEP_S = 0.02;

/** What a solo render of the virtual listener's rig keeps: layers, the motor bus, the raw aux input. */
export type SoloPart = Exclude<LayerId, 'voice'> | 'motor' | 'aux';

/**
 * For the audio proofs and the virtual listener's rig only (outside the contract, so the simulator is
 * unaffected): the negative controls break a property a check must catch; the taps let the rig record.
 */
export interface EngineTestHooks {
    /** no HRTF panner: every voice reaches both ears alike */
    readonly bypassPanner?: boolean;
    /** false: no compressor and no clipper */
    readonly limiter?: boolean;
    /** false: no fade-in */
    readonly fade?: boolean;
    /** pulse periods times this */
    readonly periodScale?: number;
    /** moving voices allowed at once */
    readonly maxMovingVoices?: number;
    /** the rig's stems: only these parts reach the master (dry and reverb send); the engine plays the same notes either way */
    readonly solo?: readonly SoloPart[];
    /** where the output chain ends (the rig's channel merger) instead of the context's destination */
    readonly destination?: AudioNode;
    /** fed with the master's output before the compressor (the rig's pre-chain stems) */
    readonly tap?: AudioNode;
    /** seed of the synth kit's noise (1): another seed is the rig's determinism control */
    readonly noiseSeed?: number;
    /** the height tone rounded to whole notes, as v0.12 (the rig's continuity control) */
    readonly steppedHeight?: boolean;
    /** 'raw': the motor input goes straight to the master as v0.12's auxInput did (the rig's motor control) */
    readonly motorBus?: 'shipped' | 'raw';
    /**
     * 'steady': the target height as a second, steady tone 6 dB under the height tone, both sounding together, as
     * before review M2 (the rig's control: the pair beats); default 'note': a short note about once a second, the
     * height tone giving way to it
     */
    readonly targetTone?: 'note' | 'steady';
    /** told the audio time of every target note the engine places (the rig's truth) */
    readonly onTargetNote?: (t0: number, hz: number, noteS: number) => void;
    /**
     * false: the reverb return leaves the mix (lane s13-elev's elevation check: the direct sound alone, so a render over
     * its dry twin is the HRTF's response; the return is the same with the panner and without it)
     */
    readonly reverb?: boolean;
    /**
     * The height layer keeps only the height tone ('tone') or only the target notes ('target'); the other part runs into a
     * silent node, so the engine plays the same notes either way (lane s13-elev's target-gap proof, review E6)
     */
    readonly heightPart?: 'tone' | 'target';
    /** how much later than a placed target note's end the height tone comes back, s (default HRTF_TAIL_S; the proof's control: 0) */
    readonly hrtfTailS?: number;
    /** how long before a placed target note its panner moves, s (default TARGET_PAN_LEAD_S; the proof's control: 0) */
    readonly targetPanLeadS?: number;
    /** false: no constant input keeps the target panner running between notes (the first engine of lane s13-elev) */
    readonly targetKeepAlive?: boolean;
}

export interface EngineOptions {
    readonly theme?: ThemeDef;
    readonly prefs?: SonicPrefs;
    readonly layers?: LessonLayers;
    readonly locale?: Locale;
    readonly dicts?: Dicts;
    /** default: the browser's speechSynthesis; null: captions only */
    readonly speech?: SpeechOut | null;
    /** every spoken line's text, for the host's caption region */
    readonly caption?: (text: string, line: SpeechLine) => void;
    readonly sampler?: SamplerOptions;
    /** the engine's own 25 ms wake-up; default on for a live AudioContext, off for an OfflineAudioContext */
    readonly pump?: boolean;
    readonly testHooks?: EngineTestHooks;
}

export interface EngineStats {
    /** moving voices sounding now */
    readonly moving: number;
    readonly movingKeys: readonly string[];
    /** moving voices asked for and refused in the last frame */
    readonly dropped: readonly string[];
    /** static voices playing a note now */
    readonly staticBusy: number;
    /** PannerNodes this engine made: 8 moving + 24 static + 1 for the target notes (lane s13-elev) */
    readonly panners: number;
    /** the most moving voices that ever sounded at once */
    readonly movingPeak: number;
}

interface LayerBus {
    readonly dry: GainNode;
    readonly wet: GainNode;
    /** centred one-off notes: into dry, and a little into the reverb */
    readonly centre: GainNode;
    readonly duckDry: GainNode;
    readonly duckWet: GainNode;
    duckTarget: number;
}

interface MovingSlot {
    readonly input: GainNode;
    readonly rough: Roughness;
    readonly lowpass: BiquadFilterNode;
    readonly level: GainNode;
    readonly panner: PannerNode | null;
    readonly spread: AudioNode;
    readonly left: GainNode;
    readonly right: GainNode;
    readonly out: ChannelMergerNode;
    readonly send: GainNode;
    layer: LayerId | null;
    key: string | null;
    plan: VoicePlan | null;
    train: PulseTrain;
    tone: ToneVoice | null;
    toneFamily: 'pad' | 'sine' | null;
    /** audio time up to which shape accents were placed */
    accentT: number;
    /** audio time up to which the trace's positions were placed */
    posT: number;
}

interface StaticSlot {
    readonly input: GainNode;
    readonly panner: PannerNode | null;
    readonly out: AudioNode;
    layer: LayerId | null;
    busyUntil: number;
}

interface Graph {
    readonly ctx: BaseAudioContext;
    readonly kit: SynthKit;
    readonly output: OutputChain;
    readonly reverbIn: GainNode;
    readonly reverbOut: GainNode;
    readonly layers: Record<LayerId, LayerBus>;
    readonly moving: MovingSlot[];
    readonly statics: StaticSlot[];
    readonly aux: GainNode;
    readonly motor: { readonly input: GainNode; readonly gate: GainNode; readonly duck: GainNode; duckTarget: number };
    // height: the glide (through the roughness and the gate that lets the target notes through alone) and the
    // target notes (not roughened)
    readonly heightRough: Roughness;
    readonly heightSwap: GainNode;
    readonly heightOut: GainNode;
    heightTone: ToneVoice | null;
    readonly targetOut: GainNode;
    /** lane s13-elev: the target notes with a direction, into their own HRTF panner (null without panners) */
    readonly targetPanned: GainNode;
    readonly targetPanner: PannerNode | null;
    readonly targetTrain: PulseTrain;
    /** the control's steady target tone (EngineTestHooks.targetTone 'steady'), made on first use */
    steadyTarget: ToneVoice | null;
    // speed
    readonly speedOut: GainNode;
    readonly speedTrain: PulseTrain;
    // room
    readonly bed: AudioBufferSourceNode;
    readonly bedLowpass: BiquadFilterNode;
    readonly bedGain: GainNode;
    readonly drone: ToneVoice;
    pannersMade: number;
}

const toneFamily = (t: Timbre): 'pad' | 'sine' => (t === 'sine' || t === 'click' || t === 'noise' ? 'sine' : 'pad');

function isOffline(ctx: BaseAudioContext): boolean {
    return typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
}

function setPannerDefaults(p: PannerNode): void {
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.refDistance = 1;
    p.maxDistance = 10000;
    p.rolloffFactor = 0;
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    p.coneOuterGain = 1;
    p.positionX.value = 0;
    p.positionY.value = 0;
    p.positionZ.value = -1;
}

/** The motor bus's gate: shut while the motor sound is off, else the pilot's own motor level (review m3). */
function motorGateGain(prefs: SonicPrefs): number {
    return prefs.motorSound ? dbToGain(prefs.motorGainDb ?? 0) : 0;
}

/** The Fly by Sound engine, plus what the demo, the Sound Lab and the proofs need beside the contract. */
export class FlyBySoundEngine implements SonicEngine {
    readonly planner: CuePlanner;
    onSpeech: ((line: SpeechLine, text: string) => void) | null = null;
    private stateValue: SonicEngine['state'] = 'idle';
    private g: Graph | null = null;
    private translator: Translator;
    private localeValue: Locale;
    private readonly dicts: Dicts;
    private readonly speech: SpeechOut | null;
    private readonly hooks: EngineTestHooks;
    private lastInput: SonicFrameInput | null = null;
    private lastInputAudio = 0;
    private lastPlan: FramePlan | null = null;
    private speakingCount = 0;
    private pumpTimer: ReturnType<typeof setInterval> | null = null;
    private movingPeak = 0;
    private removeListeners: (() => void)[] = [];

    constructor(private readonly options: EngineOptions = {}) {
        this.hooks = options.testHooks ?? {};
        this.planner = new CuePlanner({
            theme: options.theme ?? getBuiltinTheme('soft'),
            prefs: options.prefs ?? defaultPrefs(),
            ...(options.layers === undefined ? {} : { layers: options.layers }),
            ...(options.sampler === undefined ? {} : { sampler: options.sampler }),
            maxMovingVoices: this.hooks.maxMovingVoices ?? MAX_MOVING_VOICES,
            ...(this.hooks.steppedHeight === true ? { steppedHeight: true } : {})
        });
        this.localeValue = options.locale ?? 'en';
        this.dicts = options.dicts ?? DICTS;
        this.translator = createTranslator(this.localeValue, this.dicts);
        this.speech = options.speech === undefined ? createBrowserSpeech() : options.speech;
    }

    get state(): SonicEngine['state'] {
        return this.stateValue;
    }

    get auxInput(): object | null {
        return this.g === null ? null : this.g.aux;
    }

    /** The node for the simulator's motor sound (M41-16): low-passed, levelled, under the cues, ducked; silent while motorSound is off. */
    get motorInput(): object | null {
        return this.g === null ? null : this.g.motor.input;
    }

    get locale(): Locale {
        return this.localeValue;
    }

    /** The AudioContext the engine plays on, null before start. */
    get context(): BaseAudioContext | null {
        return this.g === null ? null : this.g.ctx;
    }

    setLocale(locale: Locale): void {
        this.localeValue = locale;
        this.translator = createTranslator(locale, this.dicts);
    }

    // -------------------------------------------------------------- life cycle

    async start(ac: AudioContextLike): Promise<void> {
        if (this.stateValue === 'running' || this.stateValue === 'closed') return;
        const ctx = ac as unknown as BaseAudioContext;
        if (this.g === null) this.g = this.build(ctx);
        if (!isOffline(ctx) && ctx.state === 'suspended') await (ctx as AudioContext).resume();
        this.stateValue = 'running';
        this.applyLayerGains();
        this.g.output.fadeIn(this.planner.theme.master.fadeInS);
        if (this.options.pump ?? !isOffline(ctx)) this.pumpTimer = setInterval(() => this.pump(), PUMP_MS);
        if (!isOffline(ctx)) this.watchDevice(ctx as AudioContext);
        if (this.lastInput !== null) this.update(this.lastInput);
    }

    async suspend(): Promise<void> {
        if (this.g === null || this.stateValue !== 'running') return;
        this.stateValue = 'suspended';
        if (!isOffline(this.g.ctx)) await (this.g.ctx as AudioContext).suspend();
    }

    async resume(): Promise<void> {
        if (this.g === null || this.stateValue !== 'suspended') return;
        if (!isOffline(this.g.ctx)) await (this.g.ctx as AudioContext).resume();
        this.stateValue = 'running';
        this.fadeIn();
    }

    async close(): Promise<void> {
        if (this.pumpTimer !== null) clearInterval(this.pumpTimer);
        this.pumpTimer = null;
        for (const off of this.removeListeners) off();
        this.removeListeners = [];
        if (this.speech !== null) this.speech.cancel();
        if (this.g !== null) {
            const g = this.g;
            const now = g.ctx.currentTime;
            try {
                g.bed.stop(now + 0.05);
            } catch {
                // already stopped
            }
            g.drone.stop(now);
            if (g.heightTone !== null) g.heightTone.stop(now);
            if (g.steadyTarget !== null) g.steadyTarget.stop(now);
            for (const s of g.moving) if (s.tone !== null) s.tone.stop(now);
            g.output.disconnect();
        }
        this.g = null;
        this.stateValue = 'closed';
    }

    /** Silence, then the theme's fade-in: on resume and on an output device change (also for the Sound Lab). */
    fadeIn(): void {
        if (this.g !== null) this.g.output.fadeIn(this.planner.theme.master.fadeInS);
    }

    private watchDevice(ctx: AudioContext): void {
        let wasRunning = ctx.state === 'running';
        const onState = (): void => {
            const running = ctx.state === 'running';
            if (running && !wasRunning && this.stateValue === 'running') this.fadeIn();
            wasRunning = running;
        };
        ctx.addEventListener('statechange', onState);
        this.removeListeners.push(() => ctx.removeEventListener('statechange', onState));
        const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
        if (media !== undefined && typeof media.addEventListener === 'function') {
            const onDevice = (): void => this.fadeIn();
            media.addEventListener('devicechange', onDevice);
            this.removeListeners.push(() => media.removeEventListener('devicechange', onDevice));
        }
    }

    // -------------------------------------------------------------- settings

    setTheme(theme: ThemeDef): void {
        this.planner.setTheme(theme);
        if (this.g !== null) {
            this.g.output.setCeilingDb(this.planner.theme.master.ceilingDb);
            this.applyLayerGains();
        }
    }

    setPrefs(prefs: SonicPrefs): void {
        this.planner.setPrefs(prefs);
        this.applyLayerGains();
    }

    setLayers(layers: LessonLayers): void {
        this.planner.setLayers(layers);
    }

    // -------------------------------------------------------------- the graph

    private build(ctx: BaseAudioContext): Graph {
        const theme = this.planner.theme;
        const kit = createSynthKit(ctx, this.hooks.noiseSeed ?? 1);
        const output = createOutputChain(ctx, theme.master.ceilingDb, { limiter: this.hooks.limiter !== false, fade: this.hooks.fade !== false, ...(this.hooks.destination === undefined ? {} : { destination: this.hooks.destination }) });
        if (this.hooks.tap !== undefined) output.master.connect(this.hooks.tap);
        const solo = this.hooks.solo;
        const heard = (part: SoloPart | 'voice'): boolean => solo === undefined || (part !== 'voice' && solo.includes(part));
        // a part a solo render leaves out still runs into a silent node, so every voice is processed as in the full
        // mix (a node no output pulls is not processed, and its filters and HRTF state would differ when it is heard again)
        const mute = ctx.createGain();
        mute.gain.value = 0;
        mute.connect(output.master);
        output.setMasterDb(theme.master.gainDb, ctx.currentTime);
        output.master.gain.value = dbToGain(theme.master.gainDb);

        const listener = ctx.listener;
        listener.positionX.value = 0;
        listener.positionY.value = 0;
        listener.positionZ.value = 0;
        listener.forwardX.value = 0;
        listener.forwardY.value = 0;
        listener.forwardZ.value = -1;
        listener.upX.value = 0;
        listener.upY.value = 1;
        listener.upZ.value = 0;

        const reverbIn = ctx.createGain();
        const convolver = ctx.createConvolver();
        convolver.normalize = false;
        convolver.buffer = makeReverbImpulse(ctx);
        const reverbOut = ctx.createGain();
        reverbOut.gain.value = 0.25;
        reverbIn.connect(convolver);
        convolver.connect(reverbOut);
        reverbOut.connect(this.hooks.reverb === false ? mute : output.master);

        const layers = {} as Record<LayerId, LayerBus>;
        for (const id of LAYER_IDS) {
            const dry = ctx.createGain();
            const wet = ctx.createGain();
            const duckDry = ctx.createGain();
            const duckWet = ctx.createGain();
            const centre = ctx.createGain();
            const centreSend = ctx.createGain();
            centreSend.gain.value = CENTRE_SEND;
            centre.connect(dry);
            centre.connect(centreSend);
            centreSend.connect(wet);
            dry.connect(duckDry);
            duckDry.connect(heard(id) ? output.master : mute);
            wet.connect(duckWet);
            duckWet.connect(heard(id) ? reverbIn : mute);
            layers[id] = { dry, wet, centre, duckDry, duckWet, duckTarget: 1 };
        }

        let panners = 0;
        const makePanner = (): PannerNode | null => {
            if (this.hooks.bypassPanner === true) return null;
            const p = ctx.createPanner();
            setPannerDefaults(p);
            panners++;
            return p;
        };
        const now = ctx.currentTime;

        const makeSlot = (): MovingSlot => {
            const input = ctx.createGain();
            const rough = new Roughness(ctx, now);
            const lowpass = ctx.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.Q.value = 0.5;
            lowpass.frequency.value = 12000;
            const level = ctx.createGain();
            level.gain.value = 0;
            const panner = makePanner();
            // without a panner (a negative control only), the mono voice is spread to both ears alike
            const spread: AudioNode = panner ?? ctx.createGain();
            if (panner === null) {
                spread.channelCount = 2;
                spread.channelCountMode = 'explicit';
                spread.channelInterpretation = 'speakers';
            }
            const split = ctx.createChannelSplitter(2);
            const left = ctx.createGain();
            const right = ctx.createGain();
            const out = ctx.createChannelMerger(2);
            const send = ctx.createGain();
            send.gain.value = 0;
            input.connect(rough.input);
            rough.output.connect(lowpass);
            lowpass.connect(level);
            level.connect(spread);
            level.connect(send);
            spread.connect(split);
            split.connect(left, 0);
            split.connect(right, 1);
            left.connect(out, 0, 0);
            right.connect(out, 0, 1);
            return { input, rough, lowpass, level, panner, spread, left, right, out, send, layer: null, key: null, plan: null, train: createPulseTrain(), tone: null, toneFamily: null, accentT: 0, posT: 0 };
        };
        // the slots beyond MAX_MOVING_VOICES exist only for the proofs' negative control
        const moving: MovingSlot[] = [];
        const slots = Math.max(MAX_MOVING_VOICES, this.hooks.maxMovingVoices ?? MAX_MOVING_VOICES);
        for (let i = 0; i < slots; i++) moving.push(makeSlot());

        const statics: StaticSlot[] = [];
        for (let i = 0; i < MAX_STATIC_VOICES; i++) {
            const input = ctx.createGain();
            const panner = makePanner();
            if (panner !== null) input.connect(panner);
            statics.push({ input, panner, out: panner ?? input, layer: null, busyUntil: 0 });
        }

        const aux = ctx.createGain();
        aux.connect(heard('aux') ? output.master : mute);

        // the motor bus
        const motorIn = ctx.createGain();
        const [motorHp, motorHp2] = BUTTERWORTH_4_Q.map((q) => {
            const f = ctx.createBiquadFilter();
            f.type = 'highpass';
            f.frequency.value = MOTOR_HIGHPASS_HZ;
            f.Q.value = q;
            return f;
        }) as [BiquadFilterNode, BiquadFilterNode];
        const motorLp = ctx.createBiquadFilter();
        motorLp.type = 'lowpass';
        motorLp.frequency.value = MOTOR_LOWPASS_HZ;
        motorLp.Q.value = Math.SQRT1_2;
        const leveller = ctx.createDynamicsCompressor();
        leveller.threshold.value = MOTOR_LEVELLER.thresholdDb;
        leveller.knee.value = MOTOR_LEVELLER.kneeDb;
        leveller.ratio.value = MOTOR_LEVELLER.ratio;
        leveller.attack.value = MOTOR_LEVELLER.attackS;
        leveller.release.value = MOTOR_LEVELLER.releaseS;
        const motorLevel = ctx.createGain();
        motorLevel.gain.value = dbToGain(MOTOR_LEVEL_DB - compressorMakeupDb(MOTOR_LEVELLER.thresholdDb, MOTOR_LEVELLER.kneeDb, MOTOR_LEVELLER.ratio));
        const motorGate = ctx.createGain();
        motorGate.gain.value = motorGateGain(this.planner.prefs);
        const motorDuck = ctx.createGain();
        if (this.hooks.motorBus === 'raw') motorIn.connect(motorGate);
        else motorIn.connect(motorHp);
        motorHp.connect(motorHp2);
        motorHp2.connect(motorLp);
        motorLp.connect(leveller);
        leveller.connect(motorLevel);
        motorLevel.connect(motorGate);
        motorGate.connect(motorDuck);
        motorDuck.connect(heard('motor') ? output.master : mute);
        const motor = { input: motorIn, gate: motorGate, duck: motorDuck, duckTarget: 1 };

        // height: tone -> roughness -> swap (it gives way to each target note) -> out
        // the proofs' parts of the height layer (EngineTestHooks.heightPart): the part left out runs into the silent node
        const tonePart = this.hooks.heightPart === 'target' ? null : layers.height;
        const notePart = this.hooks.heightPart === 'tone' ? null : layers.height;
        const heightRough = new Roughness(ctx, now);
        const heightSwap = ctx.createGain();
        heightSwap.gain.value = 1;
        const heightOut = ctx.createGain();
        heightOut.gain.value = 0;
        heightRough.output.connect(heightSwap);
        heightSwap.connect(heightOut);
        heightOut.connect(tonePart?.dry ?? mute);
        const heightSend = ctx.createGain();
        heightSend.gain.value = 0.1;
        heightOut.connect(heightSend);
        heightSend.connect(tonePart?.wet ?? mute);
        // the target notes: past the roughness, so a note is clean even when the craft is out of the band
        const targetOut = ctx.createGain();
        targetOut.connect(notePart?.dry ?? mute);
        const targetSend = ctx.createGain();
        targetSend.gain.value = 0.1;
        targetOut.connect(targetSend);
        targetSend.connect(notePart?.wet ?? mute);
        // lane s13-elev: the target notes that come from the target, through their own panner (as dry as the others)
        const targetPanned = ctx.createGain();
        const targetPanner = makePanner();
        if (targetPanner !== null) {
            targetPanned.connect(targetPanner);
            targetPanner.connect(notePart?.dry ?? mute);
            // review E6 of lane s13-elev: Chrome stops processing a panner whose input has been silent past its tail, and a
            // stopped panner takes a new direction only when sound comes again, crossfading from the old one over the next
            // note's onset; a constant input TARGET_KEEP_ALIVE keeps this one running between the notes, so it has turned
            // before the next note begins (the target-note-pan proof)
            if (this.hooks.targetKeepAlive !== false) {
                const keep = ctx.createConstantSource();
                keep.offset.value = TARGET_KEEP_ALIVE;
                keep.connect(targetPanner);
                keep.start();
            }
        } else targetPanned.connect(notePart?.dry ?? mute);
        targetPanned.connect(targetSend);

        const speedOut = ctx.createGain();
        speedOut.gain.value = 1;
        speedOut.connect(layers.speed.dry);

        // room: a stereo bed of filtered noise and a quiet drone on the bed note
        const bed = ctx.createBufferSource();
        bed.buffer = kit.noise;
        bed.loop = true;
        const bedLowpass = ctx.createBiquadFilter();
        bedLowpass.type = 'lowpass';
        bedLowpass.Q.value = 0.3;
        bedLowpass.frequency.value = 900;
        const bedGain = ctx.createGain();
        bedGain.gain.value = 0;
        bed.connect(bedLowpass);
        bedLowpass.connect(bedGain);
        bedGain.connect(layers.room.dry);
        bed.start(now);
        const drone = new ToneVoice(ctx, 'sine', now);
        drone.output.connect(layers.room.dry);

        return {
            ctx,
            kit,
            output,
            reverbIn,
            reverbOut,
            layers,
            moving,
            statics,
            aux,
            motor,
            heightRough,
            heightSwap,
            heightOut,
            heightTone: null,
            targetOut,
            targetPanned,
            targetPanner,
            targetTrain: createPulseTrain(),
            steadyTarget: null,
            speedOut,
            speedTrain: createPulseTrain(),
            bed,
            bedLowpass,
            bedGain,
            drone,
            pannersMade: panners
        };
    }

    private applyLayerGains(): void {
        if (this.g === null) return;
        const theme = this.planner.theme;
        const prefs = this.planner.prefs;
        const at = this.g.ctx.currentTime;
        this.g.output.setMasterDb(theme.master.gainDb, at);
        for (const id of LAYER_IDS) {
            const gain = dbToGain(layerGainDb(theme, prefs, id));
            this.g.layers[id].dry.gain.setTargetAtTime(gain, at, 0.05);
            this.g.layers[id].wet.gain.setTargetAtTime(gain, at, 0.05);
        }
        this.g.motor.gate.gain.setTargetAtTime(motorGateGain(prefs), at, 0.05);
    }

    private applyDucks(): void {
        if (this.g === null) return;
        const d = duckDb(this.speakingCount > 0, this.lastPlan?.urgent ?? false, this.planner.theme);
        const at = this.g.ctx.currentTime;
        for (const id of LAYER_IDS) {
            const bus = this.g.layers[id];
            const target = dbToGain(d[id]);
            if (Math.abs(target - bus.duckTarget) < 1e-6) continue;
            const tc = target < bus.duckTarget ? 0.02 : 0.15;
            bus.duckDry.gain.setTargetAtTime(target, at, tc);
            bus.duckWet.gain.setTargetAtTime(target, at, tc);
            bus.duckTarget = target;
        }
        // the motor ducks as any layer but the safety layer does
        const m = this.g.motor;
        const speaking = this.speakingCount > 0;
        const urgent = this.lastPlan?.urgent ?? false;
        const motorDb = Math.min(speaking ? -this.planner.theme.duckDb : 0, urgent ? -URGENT_DUCK_DB : 0);
        const mt = dbToGain(motorDb);
        if (Math.abs(mt - m.duckTarget) >= 1e-6) {
            m.duck.gain.setTargetAtTime(mt, at, mt < m.duckTarget ? 0.02 : 0.15);
            m.duckTarget = mt;
        }
    }

    // -------------------------------------------------------------- frames

    update(input: SonicFrameInput): void {
        this.lastInput = input;
        const plan = this.planner.plan(input);
        this.lastPlan = plan;
        if (this.g === null || this.stateValue !== 'running') return;
        this.lastInputAudio = this.g.ctx.currentTime;
        this.render(plan);
        this.pump();
    }

    /** The plan of the last frame the engine took (the virtual listener's rig reads its truth from it), null before the first. */
    get plan(): FramePlan | null {
        return this.lastPlan;
    }

    activeCues(): readonly ActiveCue[] {
        return this.stateValue === 'running' && this.lastPlan !== null ? this.lastPlan.cues : [];
    }

    stats(): EngineStats {
        const g = this.g;
        const now = g === null ? 0 : g.ctx.currentTime;
        const keys = g === null ? [] : g.moving.filter((s) => s.key !== null).map((s) => s.key as string);
        return {
            moving: keys.length,
            movingKeys: keys,
            dropped: this.lastPlan?.dropped ?? [],
            staticBusy: g === null ? 0 : g.statics.filter((s) => s.busyUntil > now).length,
            panners: g === null ? 0 : g.pannersMade,
            movingPeak: this.movingPeak
        };
    }

    private render(plan: FramePlan): void {
        const g = this.g as Graph;
        const now = g.ctx.currentTime;
        const bySlot = new Map<number, VoicePlan>();
        for (const v of plan.voices) bySlot.set(v.slot, v);
        let sounding = 0;
        g.moving.forEach((slot, i) => {
            const v = bySlot.get(i) ?? null;
            if (v === null) {
                if (slot.key !== null) this.releaseSlot(slot, now);
                return;
            }
            sounding++;
            this.renderSlot(slot, v, now);
        });
        this.movingPeak = Math.max(this.movingPeak, sounding);
        this.renderHeight(plan.height, now);
        this.renderRoom(plan, now);
        if (plan.speed === null || plan.speed.tempoHz <= 0) g.speedTrain.last = null;
        this.applyDucks();
    }

    private releaseSlot(slot: MovingSlot, now: number): void {
        slot.level.gain.setTargetAtTime(0, now, 0.02);
        slot.send.gain.setTargetAtTime(0, now, 0.02);
        if (slot.tone !== null) slot.tone.setLevel(0, now, 0.02);
        slot.key = null;
        slot.plan = null;
        slot.train = createPulseTrain();
    }

    private renderSlot(slot: MovingSlot, v: VoicePlan, now: number): void {
        const g = this.g as Graph;
        const fresh = slot.key !== v.key;
        if (fresh) {
            if (slot.layer !== v.layer) {
                if (slot.layer !== null) {
                    slot.out.disconnect();
                    slot.send.disconnect();
                }
                slot.out.connect(g.layers[v.layer].dry);
                slot.send.connect(g.layers[v.layer].wet);
                slot.layer = v.layer;
            }
            slot.key = v.key;
            slot.train = createPulseTrain();
            slot.accentT = now;
            slot.posT = now;
            if (slot.panner !== null) {
                const [x, y, z] = pannerDirection(v.dir);
                slot.panner.positionX.cancelScheduledValues(now);
                slot.panner.positionY.cancelScheduledValues(now);
                slot.panner.positionZ.cancelScheduledValues(now);
                slot.panner.positionX.setValueAtTime(x, now);
                slot.panner.positionY.setValueAtTime(y, now);
                slot.panner.positionZ.setValueAtTime(z, now);
            }
        } else if (slot.panner !== null && v.trace === null) {
            const [x, y, z] = pannerDirection(v.dir);
            slot.panner.positionX.setTargetAtTime(x, now, 0.03);
            slot.panner.positionY.setTargetAtTime(y, now, 0.03);
            slot.panner.positionZ.setTargetAtTime(z, now, 0.03);
        }
        slot.plan = v;
        const tc = fresh ? 0.005 : 0.05;
        slot.level.gain.setTargetAtTime(dbToGain(v.gainDb), now, tc);
        slot.send.gain.setTargetAtTime(v.reverbSend, now, tc);
        slot.lowpass.frequency.setTargetAtTime(clamp(v.lowpassHz, 200, 18000), now, tc);
        slot.rough.set(v.rough, v.roughHz > 0 ? v.roughHz : 38, now);
        // ILD boost: the near ear up and the far ear down by half the boost each, by the side the source is on
        const side = pannerDirection(v.dir)[0];
        const half = (v.ildDb * Math.abs(side)) / 2;
        const nearG = dbToGain(half);
        const farG = dbToGain(-half);
        slot.left.gain.setTargetAtTime(side < 0 ? nearG : farG, now, tc);
        slot.right.gain.setTargetAtTime(side < 0 ? farG : nearG, now, tc);
        // a continuous voice (the shape trace) holds a tone
        if (v.periodS === null) {
            const family = toneFamily(v.timbre);
            if (slot.tone === null || slot.toneFamily !== family) {
                if (slot.tone !== null) slot.tone.stop(now);
                slot.tone = new ToneVoice(g.ctx, v.timbre, now, SHAPE_AIR, g.kit.noise);
                slot.tone.output.connect(slot.input);
                slot.toneFamily = family;
            }
            slot.tone.setNote(v.hz, now, fresh ? 0.001 : 0.06);
            slot.tone.setCents(v.dopplerCents, now);
            slot.tone.setBeat(v.beatHz, v.beatDepth, now);
            slot.tone.setLevel(SHAPE_TONE_GAIN, now, fresh ? 0.03 : 0.05);
        } else if (slot.tone !== null) slot.tone.setLevel(0, now, 0.03);
    }

    /**
     * The height glide and its target notes (M41-12, review M2). The glide is a soft sine in every theme,
     * whatever the theme's height timbre (a pad's own 0.3 Hz swirl and a tone rich in partials roughen against
     * the mix). The target notes are placed by the pump; while one sounds the glide gives way to it, so the
     * two are never heard together and never beat.
     */
    private renderHeight(h: HeightPlan | null, now: number): void {
        const g = this.g as Graph;
        if (h === null || h.target === null) this.stopTargetNotes(now);
        if (g.steadyTarget !== null && (h === null || h.target === null)) g.steadyTarget.setLevel(0, now, 0.08);
        if (h === null) {
            g.heightOut.gain.setTargetAtTime(0, now, 0.08);
            return;
        }
        if (g.heightTone === null) {
            g.heightTone = new ToneVoice(g.ctx, 'sine', now, 0, null, { family: 'sine' });
            g.heightTone.output.connect(g.heightRough.input);
            g.heightTone.setLevel(1, now, 0.01);
        }
        g.heightTone.setNote(h.hz, now, h.glideS);
        g.heightRough.set(h.rough, h.roughHz, now);
        g.heightOut.gain.setTargetAtTime(HEIGHT_GAIN, now, 0.1);
        if (h.target !== null && this.hooks.targetTone === 'steady') {
            // the control: the first design, a second tone held under the height tone, both at once
            if (g.steadyTarget === null) {
                g.steadyTarget = new ToneVoice(g.ctx, 'sine', now, 0, null, { family: 'sine', sub: false });
                g.steadyTarget.output.connect(g.layers.height.dry);
            }
            g.steadyTarget.setNote(h.target.hz, now, Math.max(TARGET_GLIDE_S, h.glideS));
            g.steadyTarget.setLevel(HEIGHT_GAIN * dbToGain(STEADY_TARGET_DB), now, 0.1);
        }
    }

    /** No target height: no more notes, and the glide back at once if it was giving way. */
    private stopTargetNotes(now: number): void {
        const g = this.g as Graph;
        if (g.targetTrain.last === null) return;
        g.targetTrain.last = null;
        const swap = g.heightSwap.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
        if (typeof swap.cancelAndHoldAtTime === 'function') swap.cancelAndHoldAtTime(now);
        else swap.cancelScheduledValues(now);
        swap.setTargetAtTime(1, now, TARGET_SWAP_S / 3);
    }

    /**
     * One target note at `t0` (audio time): a held sine with a soft octave, `noteS` long. The glide fades out just
     * before it and comes back just after its release, so the two never sound at once (no beat, and no cancelling
     * at the same pitch): at the target the tone seems to go on through the note, a little brighter. Lane s13-elev:
     * with a direction the note comes from the target through its own panner, with a breath of air.
     */
    private playTargetNote(target: NonNullable<HeightPlan['target']>, t0: number, now: number): void {
        const g = this.g as Graph;
        const ctx = g.ctx;
        const peak = TARGET_NOTE_GAIN * dbToGain(target.gainDb);
        const held = t0 + target.noteS;
        const end = held + TARGET_RELEASE_S;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(peak, t0 + TARGET_ATTACK_S);
        env.gain.setValueAtTime(peak, held);
        env.gain.linearRampToValueAtTime(0, end);
        const placed = target.dir !== undefined;
        if (placed) {
            env.connect(g.targetPanned);
            const p = g.targetPanner;
            if (p !== null) {
                const [x, y, z] = pannerDirection(target.dir as NonNullable<typeof target.dir>);
                const at = Math.max(now, t0 - (this.hooks.targetPanLeadS ?? TARGET_PAN_LEAD_S));
                p.positionX.setValueAtTime(x, at);
                p.positionY.setValueAtTime(y, at);
                p.positionZ.setValueAtTime(z, at);
            }
            if (target.airDb !== undefined) addAir(g.kit, env, dbToGain(target.airDb), t0, held, end + 0.01);
        } else env.connect(g.targetOut);
        for (const [ratio, amp] of [
            [1, 1],
            [2, TARGET_OCTAVE]
        ] as const) {
            const osc = ctx.createOscillator();
            osc.frequency.value = target.hz * ratio;
            const gain = ctx.createGain();
            gain.gain.value = amp;
            osc.connect(gain);
            gain.connect(env);
            osc.start(t0);
            osc.stop(end + 0.01);
        }
        const swap = g.heightSwap.gain;
        const back = placed && g.targetPanner !== null ? end + (this.hooks.hrtfTailS ?? HRTF_TAIL_S) : end;
        swap.setValueAtTime(1, Math.max(t0 - TARGET_SWAP_S, now));
        swap.linearRampToValueAtTime(0, t0);
        swap.setValueAtTime(0, back);
        swap.linearRampToValueAtTime(1, back + TARGET_SWAP_S);
        if (this.hooks.onTargetNote !== undefined) this.hooks.onTargetNote(t0, target.hz, target.noteS);
    }

    private renderRoom(plan: FramePlan, now: number): void {
        const g = this.g as Graph;
        const r = plan.room;
        if (r === null) {
            g.bedGain.gain.setTargetAtTime(0, now, 0.3);
            g.drone.setLevel(0, now, 0.3);
            g.reverbOut.gain.setTargetAtTime(0.25, now, 0.5);
            return;
        }
        g.bedGain.gain.setTargetAtTime(BED_GAIN * (0.7 + 0.3 * r.open), now, 0.4);
        g.bedLowpass.frequency.setTargetAtTime(r.bedLowpassHz, now, 0.4);
        g.drone.setNote(r.hz, now, 0.5);
        g.drone.setLevel(DRONE_GAIN, now, 0.5);
        g.reverbOut.gain.setTargetAtTime(REVERB_RETURN * r.reverb, now, 0.5);
    }

    /** Places every pulse, tick, accent and trace position that falls before now + lookahead. */
    pump(): void {
        const g = this.g;
        if (g === null || this.stateValue !== 'running') return;
        const now = g.ctx.currentTime;
        // no frame for a while (menus, a paused host): plan on from the last frame
        if (this.lastInput !== null && this.lastPlan !== null && now - this.lastInputAudio > STALE_S) {
            const dt = (now - this.lastInputAudio) * 1000;
            const s = this.lastInput.sample;
            const plan = this.planner.plan({ ...this.lastInput, sample: { ...s, t: s.t + dt } });
            this.lastPlan = plan;
            this.lastInput = { ...this.lastInput, sample: { ...s, t: s.t + dt } };
            this.lastInputAudio = now;
            this.render(plan);
        }
        const horizon = now + LOOKAHEAD_S;
        const scaleP = this.hooks.periodScale ?? 1;
        for (const slot of g.moving) {
            const v = slot.plan;
            if (v === null) continue;
            if (v.periodS !== null) {
                const period = v.periodS * scaleP;
                const gain = v.layer === 'target' ? HUM_GAIN : PULSE_GAIN;
                // lane s13-elev: a cue of up or down carries a breath of air for the HRTF (none in v0.13)
                const air = v.airDb === undefined ? {} : { air: dbToGain(v.airDb) };
                for (const t0 of duePulses(slot.train, now, horizon, period)) {
                    playNote(g.kit, slot.input, { timbre: v.timbre, hz: v.hz, t0, durS: v.noteS, gain, cents: v.dopplerCents, beatHz: v.beatHz, beatDepth: v.beatDepth, maxS: Math.max(0.9 * period, 0.03), ...air });
                    // the open-way chime: its upper note with every pulse, a little softer
                    if (v.harmonyHz !== undefined && v.harmonyHz !== null) playNote(g.kit, slot.input, { timbre: v.timbre, hz: v.harmonyHz, t0: t0 + HARMONY_DELAY_S, durS: v.noteS, gain: gain * HARMONY_GAIN, maxS: Math.max(0.9 * period - HARMONY_DELAY_S, 0.03), ...air });
                }
            }
            if (v.trace !== null) {
                // the point runs along the outline on the audio clock
                if (slot.panner !== null) {
                    let t = Math.max(slot.posT, now);
                    while (t < horizon) {
                        t += TRACE_STEP_S;
                        const at = tracePosition(v.trace, t);
                        if (at === null) break;
                        const [x, y, z] = pannerDirection(at.dir);
                        slot.panner.positionX.linearRampToValueAtTime(x, t);
                        slot.panner.positionY.linearRampToValueAtTime(y, t);
                        slot.panner.positionZ.linearRampToValueAtTime(z, t);
                    }
                    slot.posT = t;
                }
                const from = Math.max(slot.accentT, now);
                for (const t0 of shapeAccents(v.trace.shape, v.trace.rule, from, horizon)) {
                    playNote(g.kit, slot.input, { timbre: v.timbre, hz: v.hz, t0, durS: v.noteS, gain: ACCENT_GAIN, cents: v.dopplerCents });
                }
                slot.accentT = Math.max(from, horizon);
            }
        }
        // the target notes (M41-12, review M2): one every periodS while there is a target height
        const target = this.lastPlan?.height?.target ?? null;
        if (target !== null && this.hooks.targetTone !== 'steady') {
            for (const t0 of duePulses(g.targetTrain, now, horizon, target.periodS * scaleP)) this.playTargetNote(target, t0, now);
        }
        // speed ticks: a tone and a breath of air, mixed by the theme
        const sp = this.lastPlan?.speed ?? null;
        if (sp !== null && sp.tempoHz > 0) {
            for (const t0 of duePulses(g.speedTrain, now, horizon, 1 / sp.tempoHz)) {
                const toneTimbre: Timbre = sp.timbre === 'air' || sp.timbre === 'noise' ? 'sine' : sp.timbre;
                if (sp.noiseMix < 1) playNote(g.kit, g.speedOut, { timbre: toneTimbre, hz: sp.hz, t0, durS: sp.noteS, gain: TICK_GAIN * (1 - sp.noiseMix), maxS: 0.9 / sp.tempoHz });
                if (sp.noiseMix > 0) playNote(g.kit, g.speedOut, { timbre: 'air', hz: sp.hz, t0, durS: sp.noteS, gain: TICK_GAIN * sp.noiseMix * 1.4, maxS: 0.9 / sp.tempoHz });
            }
        }
    }

    // -------------------------------------------------------------- one-off cues and speech

    cue(e: CueEvent): void {
        const t = this.lastInput?.sample.t ?? 0;
        const notes = this.planner.cue(e, t);
        if (this.g === null || this.stateValue !== 'running') return;
        const now = this.g.ctx.currentTime;
        for (const n of notes) this.playOneOff(n, now + 0.01 + n.atS);
        // a preview (and a play of a 'repeat-cue', M41-5) starts sounding with the next plan: make it now
        if ((e.kind === 'preview' || e.kind === 'repeat-cue') && this.lastInput !== null) {
            const plan = this.planner.plan(this.lastInput);
            this.lastPlan = plan;
            this.render(plan);
            this.pump();
        }
    }

    private playOneOff(n: NotePlan, at: number): void {
        const g = this.g as Graph;
        const gain = NOTE_GAIN * dbToGain(n.gainDb);
        if (n.dir !== null && n.slot !== null) {
            const slot = g.statics[n.slot] as StaticSlot;
            if (slot.layer !== n.layer) {
                if (slot.layer !== null) slot.out.disconnect();
                slot.out.connect(g.layers[n.layer].dry);
                slot.layer = n.layer;
            }
            if (slot.panner !== null) {
                const [x, y, z] = pannerDirection(n.dir);
                slot.panner.positionX.setValueAtTime(x, at);
                slot.panner.positionY.setValueAtTime(y, at);
                slot.panner.positionZ.setValueAtTime(z, at);
            }
            slot.busyUntil = playNote(g.kit, slot.input, { timbre: n.timbre, hz: n.hz, t0: at, durS: n.durS, gain });
            return;
        }
        playNote(g.kit, g.layers[n.layer].centre, { timbre: n.timbre, hz: n.hz, t0: at, durS: n.durS, gain });
    }

    async say(line: SpeechLine, o: { readonly interrupt?: boolean } = {}): Promise<void> {
        const text = this.translator.text(line);
        if (this.onSpeech !== null) this.onSpeech(line, text);
        if (this.options.caption !== undefined) this.options.caption(text, line);
        const prefs = this.planner.prefs;
        const voice = this.planner.theme.layers.voice.params;
        this.speakingCount++;
        this.applyDucks();
        try {
            if (prefs.selfVoice && this.speech !== null) {
                const opts: SpeakOptions = {
                    lang: this.localeValue,
                    rate: prefs.speechRate,
                    interrupt: o.interrupt ?? false,
                    pitch: voice['pitch'] as number,
                    volume: clamp((voice['volume'] as number) * dbToGain(prefs.layerGainDb.voice ?? 0), 0, 1)
                };
                await this.speech.speak(text, opts);
            } else {
                // the screen reader (or nobody) speaks: duck for about as long as the line takes
                await new Promise<void>((resolve) => setTimeout(resolve, estimateSpeechS(text, prefs.speechRate) * 1000));
            }
        } finally {
            this.speakingCount--;
            this.applyDucks();
        }
    }

    /** Someone is speaking through the engine now. */
    get speaking(): boolean {
        return this.speakingCount > 0;
    }
}

/** A new engine (contract SonicEngine) with this package's planner, instruments and speech. */
export function createSonicEngine(options: EngineOptions = {}): FlyBySoundEngine {
    return new FlyBySoundEngine(options);
}
