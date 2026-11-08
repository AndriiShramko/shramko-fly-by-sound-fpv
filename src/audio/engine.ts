// The Fly by Sound engine (contract SonicEngine; spec section 2): it builds the sound graph on an
// AudioContext the host made inside a user activation, takes one SonicFrameInput per frame, plans
// it with the pure CuePlanner (src/cues) and renders the plan:
//
//   moving voices (8)   notes / tone -> roughness -> low-pass -> level -> HRTF panner -> ILD -> layer bus
//                                                                       \-> reverb send
//   static voices (24)  one-off notes from a fixed direction (touch ping), HRTF panner -> layer bus
//   centre              height tone and its target tone, speed ticks, room bed and drone, gate notes, chimes
//   layer buses         theme gain + pilot gain -> duck (speech, urgent hazard) -> master
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
import { clamp, dbToGain, pannerDirection } from '../cues/rules';
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
import { createSynthKit, makeReverbImpulse, playNote, Roughness, ToneVoice, type SynthKit } from './synth';

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
/** How fast the target tone moves to the next gate's note, s (a change of target, never a step of the height). */
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
/** The engine's own wake-up, ms: keeps rhythms placed between frames. */
const PUMP_MS = 25;
/** With no frame for this long, the engine plans on from the last one (previews, menus), s. */
const STALE_S = 0.1;
/** Step of the shape trace's position automation, s. */
const TRACE_STEP_S = 0.02;

/** For the audio proofs' negative controls only: each one breaks a property a proof must catch. */
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
    /** PannerNodes this engine made: 8 moving + 24 static */
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
    // height: the glide (through the roughness) and the steady target tone (not roughened)
    readonly heightRough: Roughness;
    readonly heightOut: GainNode;
    heightTone: ToneVoice | null;
    readonly heightTarget: ToneVoice;
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
            maxMovingVoices: this.hooks.maxMovingVoices ?? MAX_MOVING_VOICES
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
            g.heightTarget.stop(now);
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
        const kit = createSynthKit(ctx);
        const output = createOutputChain(ctx, theme.master.ceilingDb, { limiter: this.hooks.limiter !== false, fade: this.hooks.fade !== false });
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
        reverbOut.connect(output.master);

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
            duckDry.connect(output.master);
            wet.connect(duckWet);
            duckWet.connect(reverbIn);
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
        aux.connect(output.master);

        // height: tone -> roughness -> out
        const heightRough = new Roughness(ctx, now);
        const heightOut = ctx.createGain();
        heightOut.gain.value = 0;
        heightRough.output.connect(heightOut);
        heightOut.connect(layers.height.dry);
        const heightSend = ctx.createGain();
        heightSend.gain.value = 0.1;
        heightOut.connect(heightSend);
        heightSend.connect(layers.height.wet);
        // the target tone: one pure partial (no sub-octave), so it beats against the height tone's
        // fundamental alone; past the roughness, so it stays steady when the craft leaves the band
        const heightTarget = new ToneVoice(ctx, 'sine', now, 0, null, { family: 'sine', sub: false });
        heightTarget.output.connect(layers.height.dry);

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
            heightRough,
            heightOut,
            heightTone: null,
            heightTarget,
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
     * The height glide and its target tone (M41-12). Both are soft sines in every theme, whatever the
     * theme's height timbre: two tones that are to beat must be pure (a pad's own 0.3 Hz swirl would beat
     * too), and a gliding tone rich in partials roughens against the rest of the mix.
     */
    private renderHeight(h: HeightPlan | null, now: number): void {
        const g = this.g as Graph;
        if (h === null) {
            g.heightOut.gain.setTargetAtTime(0, now, 0.08);
            g.heightTarget.setLevel(0, now, 0.08);
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
        if (h.target === null) g.heightTarget.setLevel(0, now, 0.08);
        else {
            g.heightTarget.setNote(h.target.hz, now, Math.max(TARGET_GLIDE_S, h.glideS));
            g.heightTarget.setLevel(HEIGHT_GAIN * dbToGain(h.target.gainDb), now, 0.1);
        }
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
                for (const t0 of duePulses(slot.train, now, horizon, period)) {
                    playNote(g.kit, slot.input, { timbre: v.timbre, hz: v.hz, t0, durS: v.noteS, gain, cents: v.dopplerCents, beatHz: v.beatHz, beatDepth: v.beatDepth, maxS: Math.max(0.9 * period, 0.03) });
                    // the open-way chime: its upper note with every pulse, a little softer
                    if (v.harmonyHz !== undefined && v.harmonyHz !== null) playNote(g.kit, slot.input, { timbre: v.timbre, hz: v.harmonyHz, t0: t0 + HARMONY_DELAY_S, durS: v.noteS, gain: gain * HARMONY_GAIN, maxS: Math.max(0.9 * period - HARMONY_DELAY_S, 0.03) });
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
        // a preview starts sounding with the next plan: make it now
        if (e.kind === 'preview' && this.lastInput !== null) {
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
