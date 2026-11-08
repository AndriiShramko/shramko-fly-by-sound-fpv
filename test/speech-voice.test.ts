// Which voice speaks (review M4): the themes' voice volume is measured on the local Windows voices (the rig's
// clips, tools/listen), and Chrome online also offers Google's network voices, whose loudness nobody measured.
// A local voice of the pilot's language comes first, so an English pilot on a machine with only en-US local
// voices (the build machine, the owner's) hears one of them, not a network en-GB voice. Control: the v0.13 rule
// before the review (the exact tag first, network or not) takes the network voice.
import { describe, expect, it } from 'vitest';
import { chooseVoice, SPEECH_LANG, type VoiceLike } from '../src/audio/voice-choice';
import type { Locale } from '../src/contract';

interface Voice extends VoiceLike {
    readonly name: string;
}
const v = (name: string, lang: string, localService: boolean): Voice => ({ name, lang, localService });

/** What Chrome lists on a Windows machine with the en-US voices only, online (local first, as Chrome lists them). */
const WINDOWS_ONLINE: readonly Voice[] = [
    v('Microsoft David - English (United States)', 'en-US', true),
    v('Microsoft Mark - English (United States)', 'en-US', true),
    v('Microsoft Zira - English (United States)', 'en-US', true),
    v('Google US English', 'en-US', false),
    v('Google UK English Female', 'en-GB', false),
    v('Google UK English Male', 'en-GB', false),
    v('Google español', 'es-ES', false),
    v('Google polski', 'pl-PL', false),
    v('Google русский', 'ru-RU', false)
];

/** The rule before the review: the exact tag (local first), then any voice of the language. */
function firstRule(voices: readonly Voice[], lang: Locale): Voice | null {
    const tag = SPEECH_LANG[lang].toLowerCase();
    return voices.find((x) => x.lang.toLowerCase() === tag && x.localService) ?? voices.find((x) => x.lang.toLowerCase() === tag) ?? voices.find((x) => x.lang.toLowerCase().startsWith(`${lang}-`) || x.lang.toLowerCase() === lang) ?? null;
}

describe('the voice that speaks', () => {
    it('English on a machine with en-US local voices, online: a local voice, not a network one', () => {
        const chosen = chooseVoice(WINDOWS_ONLINE, 'en');
        expect(chosen?.localService).toBe(true);
        expect(chosen?.name).toBe('Microsoft David - English (United States)');
    });

    it('control: the first rule takes the network en-GB voice there', () => {
        expect(firstRule(WINDOWS_ONLINE, 'en')?.name).toBe('Google UK English Female');
    });

    it('a local voice of the exact tag comes first; with none of the language at all, nothing', () => {
        const withGb = [...WINDOWS_ONLINE, v('Microsoft Hazel - English (United Kingdom)', 'en-GB', true)];
        expect(chooseVoice(withGb, 'en')?.name).toBe('Microsoft Hazel - English (United Kingdom)');
        expect(chooseVoice(WINDOWS_ONLINE.filter((x) => !x.lang.startsWith('ru')), 'ru')).toBeNull();
        expect(chooseVoice([v('Microsoft Irina - Russian (Russia)', 'ru_RU', true)], 'ru')?.name).toBe('Microsoft Irina - Russian (Russia)');
    });

    it('a language with no local voice takes its network voice (not measured: M41-17 stays open there)', () => {
        for (const lang of ['es', 'pl', 'ru'] as const) {
            const chosen = chooseVoice(WINDOWS_ONLINE, lang);
            expect(chosen?.localService, lang).toBe(false);
            expect(chosen?.lang.toLowerCase(), lang).toBe(SPEECH_LANG[lang].toLowerCase());
        }
    });

    it('offline or headless (local voices only): English is the local voice', () => {
        expect(chooseVoice(WINDOWS_ONLINE.filter((x) => x.localService), 'en')?.name).toBe('Microsoft David - English (United States)');
    });
});
