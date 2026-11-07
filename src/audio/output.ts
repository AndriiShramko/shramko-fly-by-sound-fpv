// The end of the chain (spec section 2, research 01 section 8): master gain, a compressor that
// rounds peaks, a soft clipper that holds the ceiling (-6 dBFS in every shipped theme) whatever
// comes in, and a fade that brings the sound in over a second on start, resume and device change.
import { compressorMakeupDb, dbToGain, fadeCurve, softClipCurve } from '../cues/rules';

export interface OutputChain {
    /** everything goes in here */
    readonly master: GainNode;
    readonly fade: GainNode;
    setMasterDb(db: number, at: number): void;
    setCeilingDb(db: number): void;
    /** silence now, then a raised-cosine rise to full over `seconds` */
    fadeIn(seconds: number): void;
    disconnect(): void;
}

/** Below the ceiling by this much the compressor starts to work, dB. */
const COMPRESSOR_HEADROOM_DB = 4;
const COMPRESSOR_KNEE_DB = 4;
const COMPRESSOR_RATIO = 12;
/** Ramp points of the fade; linear between them (never throws on overlap, unlike a value curve). */
const FADE_POINTS = 24;

export interface OutputOptions {
    /** false: no compressor and no clipper (only for the proofs' negative control) */
    readonly limiter?: boolean;
    /** false: the fade jumps to full at once (only for the proofs' negative control) */
    readonly fade?: boolean;
}

export function createOutputChain(ctx: BaseAudioContext, ceilingDb: number, options: OutputOptions = {}): OutputChain {
    const master = ctx.createGain();
    const fade = ctx.createGain();
    fade.gain.value = 0;
    const nodes: AudioNode[] = [master, fade];
    let setCeiling: ((db: number) => void) | null = null;
    if (options.limiter === false) {
        master.connect(fade);
    } else {
        const comp = ctx.createDynamicsCompressor();
        comp.knee.value = COMPRESSOR_KNEE_DB;
        comp.ratio.value = COMPRESSOR_RATIO;
        comp.attack.value = 0.002;
        comp.release.value = 0.25;
        const trim = ctx.createGain();
        const clip = ctx.createWaveShaper();
        clip.oversample = 'none';
        setCeiling = (db: number): void => {
            const threshold = db - COMPRESSOR_HEADROOM_DB;
            comp.threshold.value = threshold;
            trim.gain.value = dbToGain(-compressorMakeupDb(threshold, COMPRESSOR_KNEE_DB, COMPRESSOR_RATIO));
            clip.curve = softClipCurve(db) as Float32Array<ArrayBuffer>;
        };
        setCeiling(ceilingDb);
        master.connect(comp);
        comp.connect(trim);
        trim.connect(clip);
        clip.connect(fade);
        nodes.push(comp, trim, clip);
    }
    fade.connect(ctx.destination);

    return {
        master,
        fade,
        setMasterDb(db, at) {
            master.gain.setTargetAtTime(dbToGain(db), at, 0.05);
        },
        setCeilingDb(db) {
            if (setCeiling !== null) setCeiling(db);
        },
        fadeIn(seconds) {
            const now = ctx.currentTime;
            const g = fade.gain;
            g.cancelScheduledValues(now);
            if (options.fade === false) {
                g.setValueAtTime(1, now);
                return;
            }
            g.setValueAtTime(0, now);
            const curve = fadeCurve(FADE_POINTS + 1);
            const start = now + 0.002;
            g.setValueAtTime(0, start);
            for (let k = 1; k <= FADE_POINTS; k++) g.linearRampToValueAtTime(curve[k] as number, start + (seconds * k) / FADE_POINTS);
        },
        disconnect() {
            for (const n of nodes) n.disconnect();
        }
    };
}
