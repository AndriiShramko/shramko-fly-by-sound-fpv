// Turns a SpeechLine (a key of locales/<lang>.json and its parameters) into text. Never throws on
// the speech path: a missing key falls back to English, then to the key itself, and a broken
// template or parameter is reported to `onProblem` and answered with the key, so the pilot hears
// something and the test suite (locales.test.ts) is where such a problem must be caught.
import type { Locale, SpeechLine } from '../contract';
import { formatMessage, MessageParamError, MessageSyntaxError } from './format';

export type Dict = Readonly<Record<string, string>>;
export type Dicts = Readonly<Record<Locale, Dict>>;

export interface TranslatorProblem {
    readonly key: string;
    readonly locale: Locale;
    readonly kind: 'missing-key' | 'syntax' | 'param';
    readonly message: string;
}

export interface Translator {
    readonly locale: Locale;
    /** the key exists in this language (not through the English fallback) */
    has(key: string): boolean;
    /** the raw template of a key in this language, or undefined */
    template(key: string): string | undefined;
    /** the spoken text of a line */
    text(line: SpeechLine): string;
    /** the spoken text of a key with parameters */
    say(key: string, params?: SpeechLine['params']): string;
    /** a duration as words: "42.3 seconds", "1 minute 5 seconds" */
    duration(ms: number): string;
}

export function createTranslator(locale: Locale, dicts: Dicts, onProblem?: (p: TranslatorProblem) => void): Translator {
    const own = dicts[locale];
    const english = dicts.en;
    const report = (key: string, kind: TranslatorProblem['kind'], message: string): void => {
        if (onProblem !== undefined) onProblem({ key, locale, kind, message });
    };

    const say = (key: string, params: SpeechLine['params'] = {}): string => {
        let source = locale;
        let template = own[key];
        if (template === undefined) {
            report(key, 'missing-key', `no text for '${key}' in ${locale}`);
            template = english[key];
            source = 'en';
        }
        if (template === undefined) return key;
        try {
            return formatMessage(source, template, params);
        } catch (e) {
            if (e instanceof MessageSyntaxError) report(key, 'syntax', e.message);
            else if (e instanceof MessageParamError) report(key, 'param', e.message);
            else throw e;
            return key;
        }
    };

    return {
        locale,
        has: (key) => own[key] !== undefined,
        template: (key) => own[key],
        text: (line) => say(line.key, line.params),
        say,
        duration(ms) {
            const tenths = Math.max(0, Math.round(ms / 100));
            if (tenths < 600) return say('time.seconds', { n: tenths / 10 });
            const whole = Math.round(tenths / 10);
            const minutes = Math.floor(whole / 60);
            const seconds = whole % 60;
            return seconds === 0 ? say('time.minutes', { n: minutes }) : `${say('time.minutes', { n: minutes })} ${say('time.seconds', { n: seconds })}`;
        }
    };
}
