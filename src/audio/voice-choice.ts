// Which speechSynthesis voice speaks a language (review M4). DOM-free, so the Node tests can hold it: a voice is
// anything with a language tag and a local-or-network flag (SpeechSynthesisVoice is one).
import type { Locale } from '../contract';

/** BCP 47 tags of the four languages, for the utterance and the voice choice. */
export const SPEECH_LANG: Readonly<Record<Locale, string>> = { en: 'en-GB', es: 'es-ES', pl: 'pl-PL', ru: 'ru-RU' };

/** What chooseVoice needs of a voice. */
export interface VoiceLike {
    readonly lang: string;
    readonly localService: boolean;
}

/**
 * The voice for a language: a local voice of its exact tag, then a local voice of the language (en-US for en-GB),
 * then a network voice of the exact tag, then any of the language; null when there is none (the browser's default
 * voice then reads with the language tag set).
 */
export function chooseVoice<V extends VoiceLike>(voices: readonly V[], lang: Locale): V | null {
    const tag = SPEECH_LANG[lang].toLowerCase();
    const exact = (v: V): boolean => v.lang.toLowerCase().replace('_', '-') === tag;
    const family = (v: V): boolean => {
        const l = v.lang.toLowerCase().replace('_', '-');
        return l === lang || l.startsWith(`${lang}-`);
    };
    return voices.find((v) => exact(v) && v.localService) ?? voices.find((v) => family(v) && v.localService) ?? voices.find(exact) ?? voices.find(family) ?? null;
}

