// Checks of the four locale files (locales/*.json), used by test/locales.test.ts and usable on any
// dictionary: parity of keys and arguments between languages, and lints that keep every text fit
// to be spoken aloud to a child or an adult by a speech synthesiser. Pure: dictionaries in,
// problems out. Node only (it is compiled by tsconfig.node.json), though nothing here needs Node.
import { LOCALES, type Locale } from '../src/contract';
import { messageArguments, messageTexts, parseMessage, type MessagePart } from '../src/i18n/format';
import type { Dict } from '../src/i18n/translator';

export interface LocaleProblem {
    /** stable rule name */
    readonly rule: string;
    readonly locale: Locale | 'all';
    /** the dictionary key, or '' for a problem of the whole file */
    readonly key: string;
    readonly detail: string;
}

/** The plural categories every plural block of a language must spell out (CLDR also has 'many' for Spanish, which only large round numbers use). */
export const REQUIRED_PLURAL: Readonly<Record<Locale, readonly string[]>> = {
    en: ['one', 'other'],
    es: ['one', 'other'],
    pl: ['few', 'many', 'one', 'other'],
    ru: ['few', 'many', 'one', 'other']
};

/** Latin words that may stand in a Russian text: names and key caps. */
export const ALLOWED_LATIN_RU: ReadonlySet<string> = new Set([
    'Fly',
    'by',
    'Sound',
    'Enter',
    'Escape',
    'L',
    'Windows',
    'Sonic',
    'Atmos',
    'Bluetooth',
    'Telegram',
    'D'
]);

/** Keys whose text is the same in every language on purpose (the product name). */
export const SAME_AS_ENGLISH_OK: ReadonlySet<string> = new Set(['app.name']);

/** Characters a speech synthesiser stumbles over or reads aloud as symbols. */
const FORBIDDEN = /[*_<>|~`[\]\\/@^&%$=+();#"]/;

export const MAX_TEXT_LENGTH = 240;

function pluralBlocks(parts: readonly MessagePart[], into: { name: string; categories: string[] }[] = []): { name: string; categories: string[] }[] {
    for (const p of parts) {
        if (p.kind === 'plural') {
            into.push({ name: p.name, categories: Object.keys(p.branches) });
            for (const b of Object.values(p.branches)) pluralBlocks(b, into);
        }
    }
    return into;
}

/** Problems of one language's dictionary, judged alone and against the English one. */
export function lintDict(locale: Locale, dict: Dict, english: Dict): LocaleProblem[] {
    const problems: LocaleProblem[] = [];
    for (const [key, text] of Object.entries(dict)) {
        const add = (rule: string, detail: string): void => {
            problems.push({ rule, locale, key, detail });
        };
        if (typeof text !== 'string') {
            add('not-a-string', typeof text);
            continue;
        }
        if (text.trim() === '') {
            add('empty', 'the text is empty');
            continue;
        }
        if (text !== text.trim() || /\s{2,}|[\t\r\n]/.test(text)) add('whitespace', 'leading, trailing or repeated space, or a tab or line break');
        if (text.length > MAX_TEXT_LENGTH) add('length', `${text.length} characters, the limit is ${MAX_TEXT_LENGTH}`);

        let parts: MessagePart[];
        let texts: string[];
        try {
            parts = parseMessage(text);
            texts = messageTexts(text);
        } catch (e) {
            add('syntax', e instanceof Error ? e.message : String(e));
            continue;
        }

        for (const block of pluralBlocks(parts)) {
            const need = REQUIRED_PLURAL[locale];
            const missing = need.filter((c) => !block.categories.includes(c));
            if (missing.length > 0) add('plural-categories', `plural '${block.name}' lacks ${missing.join(', ')}`);
        }

        const joined = texts.join(' ');
        const bad = FORBIDDEN.exec(joined);
        if (bad !== null) add('forbidden-character', `'${bad[0]}' is not spoken well`);
        if (/\p{Extended_Pictographic}/u.test(joined)) add('forbidden-character', 'an emoji or pictograph');

        const words = joined.split(/[^\p{L}\p{M}]+/u).filter((w) => w !== '');
        if (locale === 'ru') {
            const stray = words.filter((w) => /[A-Za-z]/.test(w) && !ALLOWED_LATIN_RU.has(w));
            if (stray.length > 0) add('script', `Latin words in a Russian text: ${stray.join(', ')}`);
            const hasCyrillic = words.some((w) => /[Ѐ-ӿ]/.test(w));
            const onlyNames = words.every((w) => ALLOWED_LATIN_RU.has(w));
            if (!hasCyrillic && !onlyNames) add('script', 'no Cyrillic letters in a Russian text');
        } else if (/[Ѐ-ӿ]/.test(joined)) {
            add('script', 'Cyrillic letters in a non-Russian text');
        }

        if (locale !== 'en' && !SAME_AS_ENGLISH_OK.has(key) && text.length > 3 && english[key] === text) {
            add('copied-english', 'the text is the English one, unchanged');
        }
    }
    return problems;
}

/**
 * Parity of all languages against the list of keys that must exist: no key missing or extra, the
 * same order, and the same arguments (names) in every language. English is the reference.
 */
export function checkParity(dicts: Readonly<Record<Locale, Dict>>, expectedKeys: readonly string[]): LocaleProblem[] {
    const problems: LocaleProblem[] = [];
    const expected = new Set(expectedKeys);
    for (const locale of LOCALES) {
        const dict = dicts[locale];
        const keys = Object.keys(dict);
        const have = new Set(keys);
        for (const k of expectedKeys) if (!have.has(k)) problems.push({ rule: 'missing-key', locale, key: k, detail: 'not in the file' });
        for (const k of keys) if (!expected.has(k)) problems.push({ rule: 'extra-key', locale, key: k, detail: 'not in the catalogue' });
        const common = keys.filter((k) => expected.has(k));
        const wanted = expectedKeys.filter((k) => have.has(k));
        if (common.join('\n') !== wanted.join('\n')) problems.push({ rule: 'key-order', locale, key: '', detail: 'the keys are not in the catalogue order' });
    }
    const en = dicts.en;
    for (const key of Object.keys(en)) {
        let reference: string;
        try {
            reference = messageArguments(en[key] as string)
                .map((a) => a.name)
                .join(',');
        } catch {
            continue; // reported by lintDict as a syntax problem
        }
        for (const locale of LOCALES) {
            const text = dicts[locale][key];
            if (text === undefined) continue;
            let args: string;
            try {
                args = messageArguments(text)
                    .map((a) => a.name)
                    .join(',');
            } catch {
                continue;
            }
            if (args !== reference) problems.push({ rule: 'arguments', locale, key, detail: `arguments (${args}) differ from English (${reference})` });
        }
    }
    return problems;
}

/**
 * `node tools/run-tool.mjs locale-lint`: the parity of the four locale files with the catalogue, and the speech lint of
 * each language (the same checks as test/locales.test.ts). Prints every problem; exit code 0 when there is none.
 */
export async function main(_argv: readonly string[] = []): Promise<number> {
    const { DICTS } = await import('../src/i18n/dicts');
    const { requiredKeys } = await import('../src/i18n/catalog');
    const problems = [...checkParity(DICTS, requiredKeys()), ...LOCALES.flatMap((l) => lintDict(l, DICTS[l], DICTS.en))];
    for (const p of problems) process.stdout.write(`${p.locale} ${p.key || '(file)'}: ${p.rule}: ${p.detail}\n`);
    process.stdout.write(`locale lint: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${LOCALES.length} languages, ${requiredKeys().length} keys\n`);
    return problems.length === 0 ? 0 : 1;
}
