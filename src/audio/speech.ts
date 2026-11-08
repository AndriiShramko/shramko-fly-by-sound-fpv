// Speech behind the contract's SpeechOut, so pre-rendered clips can replace speechSynthesis later
// (spec section 2). This one uses the browser's speechSynthesis: a voice of the pilot's language
// when the system has one, else the default voice with the language tag set (the captions carry
// the text either way). A voice on the machine comes before a network voice of the same language
// (review M4): the themes' voice volume is measured on the local Windows voices (tools/listen), and a
// network voice's loudness is unknown (Chrome offers Google's when it is online), so an English pilot
// on a machine with only en-US local voices hears one of those, not a network en-GB voice (src/audio/voice-choice.ts).
// A promise per line resolves when the line ends, fails or is cancelled, and never later than a safety timeout, so a
// missing 'end' event cannot hold a lesson.
import type { Locale, SpeechOut } from '../contract';
import { chooseVoice, SPEECH_LANG } from './voice-choice';

export { chooseVoice, SPEECH_LANG, type VoiceLike } from './voice-choice';

export interface SpeakOptions {
    readonly lang: Locale;
    readonly rate: number;
    readonly interrupt: boolean;
    /** speechSynthesis pitch, 0.5 to 1.5 (theme voice.pitch) */
    readonly pitch?: number;
    /** 0 to 1 (theme voice.volume and the pilot's voice gain) */
    readonly volume?: number;
}

/** About how long a line takes to say, s: for ducking when nothing reports the end, and for the safety timeout. */
export function estimateSpeechS(text: string, rate: number): number {
    return 0.4 + (text.length * 0.065) / Math.max(rate, 0.25);
}

interface SynthLike {
    speak(u: SpeechSynthesisUtterance): void;
    cancel(): void;
    getVoices(): SpeechSynthesisVoice[];
    readonly speaking: boolean;
}

/** The browser's speechSynthesis as a SpeechOut; null when the browser has none (captions still work). */
export function createBrowserSpeech(synth: SynthLike | null = typeof speechSynthesis === 'undefined' ? null : speechSynthesis): SpeechOut & { speak(text: string, o: SpeakOptions): Promise<void> } {
    let active = 0;
    // Chrome drops an utterance that nothing references before it ends: keep them
    const live = new Set<SpeechSynthesisUtterance>();

    const pickVoice = (lang: Locale): SpeechSynthesisVoice | null => (synth === null ? null : chooseVoice(synth.getVoices(), lang));

    return {
        get speaking(): boolean {
            return active > 0 || (synth !== null && synth.speaking);
        },
        speak(text: string, o: SpeakOptions): Promise<void> {
            if (synth === null || text.trim() === '') return Promise.resolve();
            if (o.interrupt) synth.cancel();
            return new Promise<void>((resolve) => {
                const u = new SpeechSynthesisUtterance(text);
                u.lang = SPEECH_LANG[o.lang];
                const voice = pickVoice(o.lang);
                if (voice !== null) u.voice = voice;
                u.rate = Math.min(Math.max(o.rate, 0.5), 2);
                if (o.pitch !== undefined) u.pitch = Math.min(Math.max(o.pitch, 0.5), 1.5);
                if (o.volume !== undefined) u.volume = Math.min(Math.max(o.volume, 0), 1);
                let done = false;
                active++;
                live.add(u);
                const finish = (): void => {
                    if (done) return;
                    done = true;
                    active--;
                    live.delete(u);
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(finish, (estimateSpeechS(text, u.rate) * 2 + 4) * 1000);
                u.onend = finish;
                u.onerror = finish;
                synth.speak(u);
            });
        },
        cancel(): void {
            if (synth !== null) synth.cancel();
        }
    };
}

/** A SpeechOut that says nothing: captions only (no speech in the browser, a test, "my screen reader speaks"). */
export function createSilentSpeech(): SpeechOut {
    return {
        speaking: false,
        speak: () => Promise.resolve(),
        cancel: () => undefined
    };
}
