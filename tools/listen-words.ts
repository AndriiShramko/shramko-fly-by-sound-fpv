// The words check (lane s13-elev E2-2): every line of the four locales said by a local Windows voice of its language,
// transcribed by Whisper large-v3, and its word error rate against the line's text after normalising case and
// punctuation. It is the word check of VL-4 (docs/design/virtual-listener.md) on clean speech, before any mix: does the
// voice a pilot's Windows has say every word so that it can be told? One command runs it:
//
//   pnpm listen:words       (node tools/run-tool.mjs listen-words [--force])
//   node tools/run-tool.mjs listen-words --sim <the simulator's packages/i18n/locales> [--out <file>]
//
// 1. Lines: every key of locales/<lang>.json, a line with parameters filled with what a host says there (the
//    simulator's keys, a lesson's title, small numbers: sampleParams).
// 2. Clips: each line said by its language's voice (VOICES) with tools/listen/tts/sapi-clips.ps1, kept in the cache by
//    voice and text, as the rig keeps its speech clips (<cache>/speech/sapi-<voice>/).
// 3. Transcripts: tools/listen/words.py in the listener's Python environment (SHRAMKO_LISTEN_PY), Whisper on the GPU,
//    one voice and language at a time, each while this process holds the GPU lock (GPU_LOCK); kept in the cache by
//    clip, language and transcriber (<cache>/words/).
// 4. Word error rate per line (wordErrors), with the words a voice is known to say otherwise put back (HEARD); one
//    bound per language (BOUNDS). The control: the Russian lines said by the English voice must fail the Russian bound.
//    And the key rule (review E4 of the lane): a line that names a key is heard with the key's name as a word of its
//    own (keyHeard), whatever its rate; its control: v0.13's lines that name a key (tools/listen/key-lines-v013.json),
//    said by their voices, lose a key in each of Spanish, Polish and Russian.
// 5. Evidence: evidence/listen/VL-4-words.json, keyed by the hash of every input. With nothing changed since the last
//    passing run, nothing runs again (--force runs it anyway).
//
// --sim runs the same on the simulator's Fly by Sound lines (its fly/sonic, sonicentry, sonickeys, sonicrec and soniclook files)
// and writes a report, not evidence: the simulator owns those texts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, type Locale, type SpeechLine } from '../src/contract';
import { DICTS, messageArguments } from '../src/i18n';
import { createTranslator, type Translator } from '../src/i18n/translator';

/** Bump when the lines, the scoring or the evidence's layout change in a way the hashed files do not show. */
export const WORDS_VERSION = 2;

// ------------------------------------------------------------------ words

/**
 * The words of a text for the word error rate: lower case, the letter ё as е (Russian writes either), apostrophes
 * dropped, every other character that is not a letter, a mark or a digit a space (punctuation, hyphens, symbols).
 */
export function words(text: string, locale: string): string[] {
    return text
        .normalize('NFC')
        .toLocaleLowerCase(locale)
        .replace(/ё/g, 'е')
        .replace(/['\u2019\u02bc]/g, '')
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((w) => w !== '');
}

/** How many words of the transcript a number of the line may match: the voices say numbers in their own words. */
export const NUMBER_SPAN = 3;

/** A word with a digit in it is a number: it matches one to NUMBER_SPAN words of the transcript, digits or words. */
export const isNumber = (w: string): boolean => /\p{N}/u.test(w);

export interface WordErrors {
    /** substitutions, deletions and insertions */
    readonly errors: number;
    /** the line's words */
    readonly words: number;
    /** errors over words */
    readonly rate: number;
}

/**
 * The fewest edits from the line's words to the transcript's: a substitution, a deletion or an insertion costs one; two
 * words of the line heard as one ("fly by" as "flyby") or one heard as two costs nothing (a word boundary, not a word);
 * a number of the line matches one to NUMBER_SPAN words of the transcript, whatever they are (Polish "Bramka 2 z 5" is
 * said "Bramka druga z pięciu"), and costs one if it is not heard at all.
 */
export function wordErrors(ref: readonly string[], hyp: readonly string[]): WordErrors {
    const n = ref.length;
    const m = hyp.length;
    const d: number[][] = Array.from({ length: n + 2 }, () => new Array<number>(m + 2).fill(Infinity));
    const relax = (i: number, j: number, c: number): void => {
        if (c < (d[i] as number[])[j]!) (d[i] as number[])[j] = c;
    };
    (d[0] as number[])[0] = 0;
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= m; j++) {
            const c = (d[i] as number[])[j]!;
            if (c === Infinity) continue;
            if (j < m) relax(i, j + 1, c + 1);
            if (i >= n) continue;
            const r = ref[i] as string;
            relax(i + 1, j, c + 1);
            if (isNumber(r)) {
                for (let k = 1; k <= NUMBER_SPAN && j + k <= m; k++) relax(i + 1, j + k, c);
                continue;
            }
            if (j < m) relax(i + 1, j + 1, c + (r === hyp[j] ? 0 : 1));
            const next = ref[i + 1];
            if (j < m && next !== undefined && !isNumber(next) && r + next === hyp[j]) relax(i + 2, j + 1, c);
            if (j + 1 < m && r === `${hyp[j] as string}${hyp[j + 1] as string}`) relax(i + 1, j + 2, c);
        }
    }
    const errors = (d[n] as number[])[m]!;
    return { errors, words: n, rate: n === 0 ? (m === 0 ? 0 : 1) : errors / n };
}

// ------------------------------------------------------------------ what the voices say otherwise

/**
 * A word a voice is known to say otherwise than the text (or that Whisper writes otherwise for a reason that is not the
 * line's), found by this check and recorded with why; the check puts the text's words back before it counts errors.
 * Only for a line whose text is right: a wrong text is fixed in locales/. `key` '*' is every line of the language that
 * has the words (a voice's habit); a record is used only where the line's text has its `said` words.
 */
export interface Heard {
    readonly locale: Locale;
    readonly key: string;
    /** the words of the text */
    readonly said: string;
    /** what the transcript has instead */
    readonly heard: string;
    readonly why: string;
}

const SAME_SOUND = 'the two sound the same';
const ONE_WORD = 'a word alone, with nothing around it to tell it by';

export const HEARD: readonly Heard[] = [
    // English, Microsoft David
    { locale: 'en', key: '*', said: 'height tone', heard: 'high tone', why: 'the t of height runs into tone: "height tone" is heard as "high tone", in all nine lines that say it' },
    { locale: 'en', key: '*', said: 'metres', heard: 'meters', why: 'Whisper writes the American spelling' },
    { locale: 'en', key: '*', said: 'centre', heard: 'center', why: 'Whisper writes the American spelling' },
    { locale: 'en', key: '*', said: 'target hum', heard: 'target hub', why: 'the two words alone (the cue and the layer): hum is heard as hub' },
    { locale: 'en', key: '*', said: 'passed', heard: 'past', why: SAME_SOUND },
    { locale: 'en', key: '*', said: 'passed', heard: 'pest', why: 'passed at the end of a short line is heard as pest' },
    { locale: 'en', key: '*', said: 'gate', heard: 'gay', why: 'the t of gate runs into the number after it: "Gate 2" is heard as "Gay 2" or "Gay too"' },
    { locale: 'en', key: '*', said: 'stopped 3', heard: 'stop 3', why: 'the -ed of stopped runs into the number after it' },
    { locale: 'en', key: '*', said: '20 percent', heard: '20%', why: 'Whisper writes the percent sign' },
    { locale: 'en', key: 'module.0.name', said: 'Ears', heard: 'Gears', why: `${ONE_WORD} (the first run heard "here's")` },
    { locale: 'en', key: 'theme.race.name', said: 'Race', heard: 'Raise', why: ONE_WORD },
    { locale: 'en', key: 'cue.target.off.name', said: 'Off course', heard: 'Of course', why: 'two words alone, heard as the phrase "of course"' },
    { locale: 'en', key: 'menu.setting.calm', said: 'Calm', heard: 'comm', why: 'two words alone: calm without its l is written comm' },
    { locale: 'en', key: 'menu.setting.height-target', said: 'note', heard: 'node', why: 'the last of three words alone' },
    { locale: 'en', key: 'reason.height-low', said: 'Too', heard: 'to', why: SAME_SOUND },
    { locale: 'en', key: 'reason.zone-past', said: 'Past', heard: 'Pass', why: 'the t of past runs into the' },
    // Spanish, Microsoft Helena
    { locale: 'es', key: '*', said: 'aros', heard: 'a los', why: 'aros (rings) alone or first in a title is heard as "a los"' },
    { locale: 'es', key: '*', said: 'dron', heard: 'dran', why: 'the voice says dron with an open o that Whisper writes as a, in every line with the word' },
    { locale: 'es', key: '*', said: '2 de 5', heard: '2D5', why: 'Whisper writes "dos de cinco" as 2D5' },
    { locale: 'es', key: '*', said: '20 por ciento', heard: '20%', why: 'Whisper writes the percent sign' },
    { locale: 'es', key: 'cue.shape.cube.name', said: 'Cubo', heard: 'Cuba', why: ONE_WORD },
    { locale: 'es', key: 'menu.value.heading', said: 'donde', heard: 'dónde', why: 'the value says where you look (donde, no question); Whisper writes it as the question dónde' },
    // Polish, Microsoft Paulina
    { locale: 'pl', key: '*', said: 'węższy', heard: 'wyższy', why: 'the nasal ę of węższy (narrower) is heard as y: wyższy (higher), in every line with the word' },
    { locale: 'pl', key: '*', said: 'najwęższy', heard: 'najwyższy', why: 'as węższy: the narrowest is heard as the highest' },
    { locale: 'pl', key: '*', said: 'sześcianu', heard: '60', why: 'sześcianu (of the cube) is heard as sześćdziesiąt and written 60, or misspelt (the next three)' },
    { locale: 'pl', key: '*', said: 'sześcianu', heard: 'szejsianu', why: 'the same word heard, but misspelt' },
    { locale: 'pl', key: '*', said: 'sześcianu', heard: 'szeisianu', why: 'the same word heard, but misspelt' },
    { locale: 'pl', key: '*', said: 'sześcianu', heard: 'sześianu', why: 'the same word heard, but misspelt' },
    { locale: 'pl', key: '*', said: 'dron', heard: 'dran', why: 'the voice says dron with an open o that Whisper writes as a, in every line with the word' },
    { locale: 'pl', key: '*', said: '20 procent', heard: '20%', why: 'Whisper writes the percent sign' },
    { locale: 'pl', key: 'cue.shape.pillar.name', said: 'Słup', heard: 'Swoop', why: ONE_WORD },
    { locale: 'pl', key: 'menu.main.quit', said: 'Wyjdź', heard: 'Wyjęć', why: ONE_WORD },
    { locale: 'pl', key: 'lesson.rings-line.title', said: 'Obręcze', heard: 'Obręczę', why: 'Whisper writes the plural with the ending of the accusative singular' },
    // Russian, Microsoft Irina
    { locale: 'ru', key: '*', said: 'пролети', heard: 'пролейте', why: 'fly through (пролети) is heard as pour (пролейте); with the other verbs of flying with a prefix (the next four), in 22 of the 23 lines that say one' },
    { locale: 'ru', key: '*', said: 'облети', heard: 'облейте', why: 'the same habit as with пролети' },
    { locale: 'ru', key: '*', said: 'долети', heard: 'далейте', why: 'the same habit as with пролети' },
    { locale: 'ru', key: '*', said: 'долети', heard: 'долейте', why: 'the same habit as with пролети' },
    { locale: 'ru', key: '*', said: 'подлети', heard: 'подлейте', why: 'the same habit as with пролети' },
    { locale: 'ru', key: '*', said: 'гул', heard: 'гол', why: 'the hum (гул) is heard as a goal (гол), in 12 of the 13 lines with the word' },
    { locale: 'ru', key: '*', said: 'гулом', heard: 'голым', why: 'the same habit as with гул' },
    { locale: 'ru', key: '*', said: 'препятствие', heard: 'препятствия', why: 'unstressed, the endings -ие and -ия sound the same' },
    { locale: 'ru', key: '*', said: '20 процентов', heard: '20%', why: 'Whisper writes the percent sign' },
    { locale: 'ru', key: '*', said: 'держись середины', heard: 'держись с середины', why: 'the сь of держись runs into середины and Whisper writes a с between them' },
    { locale: 'ru', key: '*', said: 'коснёшься стены', heard: 'кознёшь со стены', why: 'коснёшься (you touch) before стены is heard as кознёшь со' },
    { locale: 'ru', key: 'cue.target.note.name', said: 'Нота ворот', heard: 'Нотоворот', why: 'two words alone, heard as one with the unstressed a as o' },
    { locale: 'ru', key: 'cue.shape.pillar.name', said: 'Столб', heard: 'Столп', why: `${ONE_WORD}: the final б is said as п` },
    { locale: 'ru', key: 'layer.shape.name', said: 'Звуки форм', heard: 'Звуки и форм', why: 'Whisper hears an и between two words' },
    { locale: 'ru', key: 'theme.soft.name', said: 'Мягкая', heard: 'Мягкое', why: `${ONE_WORD}: the unstressed ending -ая is heard as -ое` },
    { locale: 'ru', key: 'theme.clear.name', said: 'Чёткая', heard: 'Чёткое', why: `${ONE_WORD}: the unstressed ending -ая is heard as -ое` },
    { locale: 'ru', key: 'menu.change.louder', said: 'Громче', heard: 'Громчие', why: `${ONE_WORD}: the unstressed final е is heard as ие` },
    { locale: 'ru', key: 'menu.change.quieter', said: 'Тише', heard: 'Тиши', why: `${ONE_WORD}: the unstressed final е is heard as и` },
    { locale: 'ru', key: 'survey.anchor.very-afraid', said: 'сильное опасение', heard: 'сильные опасения', why: 'unstressed endings, heard as the plural' },
    { locale: 'ru', key: 'lesson.rings-small.goal.1', said: 'самое маленькое', heard: 'самые маленькие', why: 'unstressed endings, heard as the plural' },
    { locale: 'ru', key: 'lesson.hover-height.goal.1', said: 'Держи тон', heard: 'Держит он', why: 'the т of тон is heard as the end of держи: держит он' },
    { locale: 'ru', key: 'lesson.corridor.intro.2', said: 'к той стене', heard: 'кто из тени', why: 'к той стене (to that wall) is heard as кто из тени' },
    { locale: 'ru', key: 'lesson.corridor.intro.2', said: 'Отодвинься', heard: 'Отодвинь', why: 'the reflexive ending is not heard' }
];

const contains = (list: readonly string[], part: readonly string[]): number => {
    for (let i = 0; i + part.length <= list.length && part.length > 0; i++) if (part.every((w, k) => list[i + k] === w)) return i;
    return -1;
};

/** The transcript's words with every recorded `heard` of this line (whose text has the `said` words) replaced by them. */
export function putBack(hyp: readonly string[], ref: readonly string[], locale: Locale, key: string, records: readonly Heard[] = HEARD): string[] {
    let out = [...hyp];
    for (const h of records) {
        if (h.locale !== locale || (h.key !== key && h.key !== '*')) continue;
        const heard = words(h.heard, locale);
        const said = words(h.said, locale);
        if (contains(ref, said) < 0) continue;
        for (let i = 0; i + heard.length <= out.length && heard.length > 0; i++) {
            if (heard.every((w, k) => out[i + k] === w)) {
                out = [...out.slice(0, i), ...said, ...out.slice(i + heard.length)];
                i += said.length - 1;
            }
        }
    }
    return out;
}

// ------------------------------------------------------------------ the bounds and the voices

/**
 * The largest word error rate a line of each language may have (after HEARD): one wrong word in five. Every line meets
 * it; every line that did not was looked at and its wording fixed (K's help) or its misheard word recorded (HEARD).
 */
export const BOUNDS: Readonly<Record<Locale, number>> = { en: 0.2, es: 0.2, pl: 0.2, ru: 0.2 };

/** The local voice of each language: the Windows desktop voices (SAPI), the ones the length fixtures were measured with. */
export const VOICES: Readonly<Record<Locale, string>> = {
    en: 'Microsoft David Desktop',
    es: 'Microsoft Helena Desktop',
    pl: 'Microsoft Paulina Desktop',
    ru: 'Microsoft Irina Desktop'
};

/** The control: the Russian lines said by the English voice (it skips letters it has no sound for). */
export const CONTROL = { locale: 'ru', voice: 'Microsoft David Desktop' } as const;

/** Of the control's lines, at least this share must be over the Russian bound for the check to be valid. */
export const CONTROL_MIN_SHARE = 0.5;

// ------------------------------------------------------------------ the lines

/** The key a line with a key in it names: the simulator's keys in Fly by Sound (ShramkoGSFPV packages/prefs keymap). */
export const KEY_OF: Readonly<Record<string, string>> = {
    'help.record': 'T',
    'help.send': 'U',
    'help.status': 'I',
    'help.repeat': 'Z',
    'help.glossary': 'G',
    'help.reset': 'R',
    'help.next': 'N',
    'rec.ask': 'T',
    'rec.recover': 'T',
    'send.ask': 'U',
    'send.confirm': 'U',
    'fly.offer-next': 'N',
    'glossary.again': 'Z',
    'survey.repeat-hint': 'Z',
    'survey.open-howto': 'Enter'
};

/** The numbers the lines with numbers are said with. */
const NUMBERS: Readonly<Record<string, number>> = { n: 2, total: 5, right: 4, counted: 1, required: 3, lesson: 6, lessons: 28, step: 2, steps: 3, percent: 20, degrees: 30, metres: 3, limit: 2, passed: 3, seconds: 5 };

/** What a host fills a line's parameters with (every argument of locales/; an unknown one throws). */
export function sampleParams(key: string, template: string, tr: Translator): NonNullable<SpeechLine['params']> {
    const params: Record<string, string | number> = {};
    for (const { name } of messageArguments(template)) {
        if (name === 'key') params[name] = KEY_OF[key] ?? 'K';
        else if (name === 'skip') params[name] = 'Escape';
        else if (name === 'title') params[name] = tr.say('lesson.hover-height.title');
        else if (name === 'name') params[name] = tr.say(key === 'status.theme' ? 'theme.soft.name' : 'cue.safety.wall.name');
        else if (name === 'label') params[name] = tr.say(key === 'menu.item' ? 'menu.setting.height-direction' : 'cue.safety.wall.name');
        else if (name === 'layer') params[name] = tr.say('layer.height.name');
        else if (name === 'time') params[name] = tr.duration(65_000);
        else if (NUMBERS[name] !== undefined) params[name] = NUMBERS[name] as number;
        else throw new Error(`${key}: no sample value for the argument '${name}'`);
    }
    return params;
}

export interface Line {
    readonly locale: Locale;
    readonly key: string;
    /** what the voice is given and the transcript is compared with */
    readonly text: string;
    /** the key's name the line says, when it names a key ({key}, {skip}): it must be heard as a word of its own */
    readonly keyName?: string;
}

/** The name of the key a line says (its {key} or {skip} as sampleParams fills it), or undefined when it names none. */
export function keyNameOf(key: string, template: string): string | undefined {
    const names = messageArguments(template).map((a) => a.name);
    if (names.includes('key')) return KEY_OF[key] ?? 'K';
    if (names.includes('skip')) return 'Escape';
    return undefined;
}

/** Every line of the four locales as a host says it. */
export function packageLines(): Line[] {
    const out: Line[] = [];
    for (const locale of LOCALES) {
        const tr = createTranslator(locale, DICTS, (p) => {
            throw new Error(`${p.locale} ${p.key}: ${p.message}`);
        });
        for (const [key, template] of Object.entries(DICTS[locale])) {
            const keyName = keyNameOf(key, template);
            out.push({ locale, key, text: tr.say(key, sampleParams(key, template, tr)), ...(keyName === undefined ? {} : { keyName }) });
        }
    }
    return out;
}

/**
 * The key rule's control (review E4 of lane s13-elev): v0.13's lines that name a key in Spanish, Polish and Russian
 * (16c01a1, tools/listen/key-lines-v013.json), said as a host says them. Said by the local voices, the key's name ran
 * into the verb or was lost in some of each language, so the key rule must find a lost key in each.
 */
export function v013KeyLines(): Line[] {
    const file = JSON.parse(readFileSync(join(ROOT, 'tools', 'listen', 'key-lines-v013.json'), 'utf8')) as { lines: Record<string, Record<string, string>> };
    const out: Line[] = [];
    for (const [locale, lines] of Object.entries(file.lines)) {
        for (const [key, template] of Object.entries(lines)) {
            const keyName = keyNameOf(key, template) as string;
            out.push({ locale: locale as Locale, key, text: template.replace(/\{(key|skip)\}/g, keyName), keyName });
        }
    }
    return out;
}

/** Whether the transcript has the key's name as a word (or words) of its own: "Pulsa la tecla T para", not "Púlsate para". */
export function keyHeard(line: Pick<Line, 'locale' | 'keyName'>, hyp: string): boolean {
    if (line.keyName === undefined) return true;
    return contains(words(hyp, line.locale), words(line.keyName, line.locale)) >= 0;
}

/** The simulator's Fly by Sound files (under its packages/i18n/locales). */
export const SIM_FILES = ['fly/sonic', 'fly/sonicentry', 'fly/sonickeys', 'fly/sonicrec', 'fly/soniclook'] as const;

/**
 * Keys of those files that are not lines a person hears or reads as words: a language tag, the phrases the recogniser listens for, and
 * the line that only carries a text put together elsewhere (sonic.say.text: the start screen's stops, a recorded line in a replay).
 */
export const SIM_NOT_LINES: readonly RegExp[] = [/^sonicrec\.voice\.lang$/, /^sonicrec\.voice\.phrases\./, /^sonic\.say\.text$/];

/** The simulator's lines, their parameters filled with its own words where it has them, else with small numbers. */
export function simulatorLines(root: string): Line[] {
    const out: Line[] = [];
    for (const locale of LOCALES) {
        const dict: Record<string, string> = {};
        for (const f of SIM_FILES) Object.assign(dict, JSON.parse(readFileSync(join(root, f, `${locale}.json`), 'utf8')) as Record<string, string>);
        const pkg = createTranslator(locale, DICTS);
        const own = (k: string): string => {
            const t = dict[k];
            if (t === undefined) throw new Error(`the simulator's ${locale} files have no ${k}`);
            return t;
        };
        const keyOf: Readonly<Record<string, string>> = { 'sonic.say.helpShare': 'L', 'sonic.say.helpPrevious': 'B', 'sonic.say.helpRepeat': 'Z', 'sonicrec.survey.listening': own('sonicrec.key.Enter') };
        const values = (key: string): Record<string, string> => ({
            time: pkg.duration(65_000),
            copy: own('sonic.copyKeys'),
            list: pkg.say('theme.soft.name'),
            key: keyOf[key] ?? 'K',
            menu: own('sonicrec.key.Escape'),
            repeat: 'Z',
            next: 'N',
            lesson: pkg.say('lesson.rings-first.title'),
            title: pkg.say('lesson.rings-first.title'),
            cm: '12',
            id: key === 'sonicrec.transfer.ref' ? '4821' : 'rings-first',
            frames: '1200',
            size: '3',
            when: '8.11',
            length: '2:10',
            problem: own('sonicrec.problem.network'),
            reason: own('sonicrec.reason.locked'),
            name: key === 'sonicrec.msg.saved' ? '2026-11-08' : own('sonicrec.channel.telegram'),
            status: own('sonicrec.channel.status.sent'),
            channels: own('sonicrec.channel.name').replace('{name}', own('sonicrec.channel.telegram')).replace('{status}', own('sonicrec.channel.status.sent')),
            free: '40',
            need: '120',
            detail: '42',
            now: '0:30',
            total: key === 'sonicrec.replay.time' ? '1:05' : '5',
            matched: '18',
            recorded: key === 'sonic.say.replayOlder' ? '1' : '20',
            here: '2',
            cues: '95',
            diffs: '2',
            n: '2',
            done: '1',
            of: '3',
            code: '503',
            // fly/soniclook (the sound panel's and the attitude display's words): a play of a named sound, a height in metres
            k: '1',
            v: '1.5'
        });
        for (const [key, template] of Object.entries(dict)) {
            if (SIM_NOT_LINES.some((r) => r.test(key))) continue;
            const v = values(key);
            const text = template.replace(/\{(\w+)\}/g, (_, name: string) => {
                const x = v[name];
                if (x === undefined) throw new Error(`${locale} ${key}: no sample value for '${name}'`);
                return x;
            });
            out.push({ locale, key, text });
        }
    }
    return out;
}

// ------------------------------------------------------------------ scoring

export interface Scored extends Line {
    readonly voice: string;
    readonly hyp: string;
    /** before HEARD */
    readonly rawRate: number;
    readonly rate: number;
    readonly errors: number;
    readonly words: number;
    /** a line that names a key: whether the key's name was heard as a word of its own (keyHeard); else true */
    readonly keyHeard: boolean;
}

export function score(line: Line, voice: string, hyp: string, records: readonly Heard[] = HEARD): Scored {
    const ref = words(line.text, line.locale);
    const heard = words(hyp, line.locale);
    const raw = wordErrors(ref, heard);
    const e = wordErrors(ref, putBack(heard, ref, line.locale, line.key, records));
    return { ...line, voice, hyp, rawRate: raw.rate, rate: e.rate, errors: e.errors, words: e.words, keyHeard: keyHeard(line, hyp) };
}

export interface LanguageSummary {
    readonly voice: string;
    readonly lines: number;
    readonly words: number;
    readonly bound: number;
    /** lines heard with no error */
    readonly exact: number;
    readonly meanRate: number;
    readonly maxRate: number;
    /** lines over the bound */
    readonly over: readonly string[];
    /** the lines that name a key, and those heard without the key's name as a word of its own */
    readonly keys: { readonly lines: number; readonly lost: readonly string[] };
    readonly heard: readonly Heard[];
}

export function summarise(rows: readonly Scored[], locale: Locale, bound: number, records: readonly Heard[] = HEARD): LanguageSummary {
    const mine = rows.filter((r) => r.locale === locale);
    const rate = (x: number): number => Math.round(x * 10000) / 10000;
    const keyed = mine.filter((r) => r.keyName !== undefined);
    return {
        voice: mine[0]?.voice ?? VOICES[locale],
        lines: mine.length,
        words: mine.reduce((s, r) => s + r.words, 0),
        bound,
        exact: mine.filter((r) => r.errors === 0).length,
        meanRate: rate(mine.reduce((s, r) => s + r.rate, 0) / Math.max(mine.length, 1)),
        maxRate: rate(Math.max(0, ...mine.map((r) => r.rate))),
        over: mine.filter((r) => r.rate > bound).map((r) => r.key),
        keys: { lines: keyed.length, lost: keyed.filter((r) => !r.keyHeard).map((r) => r.key) },
        heard: records.filter((h) => h.locale === locale)
    };
}

/** The languages whose v0.13 key lines the key control holds; it is valid when the key rule finds a lost key in each. */
export const KEY_CONTROL_LOCALES: readonly Locale[] = ['es', 'pl', 'ru'];

// ------------------------------------------------------------------ files, clips, transcripts

// the package's own root, from this file's place (not the working directory: the simulator's vitest runs the package's
// tests from its own root, where tools/listen/ is not)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Every input of the check: the lines (locales and the code that fills them), the clip maker, the transcriber, this driver, the key control's lines. */
const HASHED = ['locales', 'src/i18n', 'src/contract.ts', 'tools/listen-words.ts', 'tools/listen/words.py', 'tools/listen/tts/sapi-clips.ps1', 'tools/listen/requirements.txt', 'tools/listen/key-lines-v013.json'];

function filesUnder(path: string): string[] {
    const abs = join(ROOT, path);
    if (!existsSync(abs)) return [];
    if (statSync(abs).isFile()) return [path];
    return readdirSync(abs)
        .sort()
        .flatMap((name) => filesUnder(`${path}/${name}`));
}

export function inputsHash(): { readonly hash: string; readonly files: number } {
    const files = [...new Set(HASHED.flatMap(filesUnder))].sort();
    const lines = files.map((f) => `${f} ${sha256(readFileSync(join(ROOT, f)))}`);
    return { hash: sha256(`listen-words/${WORDS_VERSION}\n${lines.join('\n')}`), files: files.length };
}

const voiceSlug = (voice: string): string => `sapi-${(voice.split(' ')[1] ?? voice).toLowerCase()}`;
const clipName = (voice: string, text: string): string => `${sha256(`${voice}\n${text}`).slice(0, 24)}.wav`;

/** Says every missing line with `voice` (tools/listen/tts/sapi-clips.ps1); returns the clip of each text. */
function makeClips(cache: string, voice: string, texts: readonly string[], log: (s: string) => void): Map<string, string> {
    const dir = join(cache, 'speech', voiceSlug(voice));
    mkdirSync(dir, { recursive: true });
    const files = new Map(texts.map((t) => [t, join(dir, clipName(voice, t))] as const));
    const missing = [...new Set(texts)].filter((t) => !existsSync(files.get(t) as string));
    if (missing.length > 0) {
        log(`  saying ${missing.length} lines with ${voice}`);
        const list = join(dir, 'lines-words.json');
        writeFileSync(list, JSON.stringify(missing.map((t) => ({ id: clipName(voice, t).slice(0, -4), text: t }))));
        const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'tools', 'listen', 'tts', 'sapi-clips.ps1'), '-Lines', list, '-Out', dir, '-Voice', voice], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (r.status !== 0) throw new Error(`the clip maker failed: ${r.stderr || r.stdout}`);
    }
    return files;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The machine's rule, as tools/listen.ts: the GPU is used while this process holds the lock (mkdir, 20 s between tries, 9 minutes at most). */
async function takeLock(path: string): Promise<() => void> {
    const deadline = Date.now() + 9 * 60 * 1000;
    for (;;) {
        try {
            mkdirSync(path);
            return () => {
                try {
                    rmdirSync(path);
                } catch {
                    // already gone
                }
            };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            if (Date.now() > deadline) throw new Error(`could not take ${path} within 9 minutes`);
            await sleep(20_000);
        }
    }
}

interface Job {
    readonly line: Line;
    readonly voice: string;
    readonly wav: string;
}

/** What Whisper heard in each job's clip: from the cache, the missing ones transcribed now under the GPU lock. */
async function transcribe(cache: string, py: string, lockPath: string, jobs: readonly Job[], log: (s: string) => void): Promise<{ readonly heard: Map<Job, string>; readonly decode: Record<string, unknown>; readonly tools: Record<string, string> }> {
    const transcriber = sha256(readFileSync(join(ROOT, 'tools', 'listen', 'words.py'))).slice(0, 12);
    const dir = join(cache, 'words', transcriber);
    mkdirSync(dir, { recursive: true });
    const stores = new Map<string, Record<string, string>>();
    const storeOf = (job: Job): { readonly path: string; readonly map: Record<string, string> } => {
        const path = join(dir, `${voiceSlug(job.voice)}-${job.line.locale}.json`);
        let map = stores.get(path);
        if (map === undefined) {
            map = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {};
            stores.set(path, map);
        }
        return { path, map };
    };
    const clipOf = (job: Job): string => basename(job.wav);
    // the missing clips by store (a voice in a language), each store transcribed under a lock of its own, so that the
    // GPU is free for others between them (a store is about 500 clips, 4 to 5 minutes)
    const groups = new Map<string, Map<string, { readonly id: string; readonly lang: Locale; readonly wav: string }>>();
    for (const j of jobs) {
        const { path, map } = storeOf(j);
        if (map[clipOf(j)] !== undefined) continue;
        const group = groups.get(path) ?? new Map();
        group.set(clipOf(j), { id: clipOf(j), lang: j.line.locale, wav: j.wav });
        groups.set(path, group);
    }
    let first = true;
    for (const [path, group] of groups) {
        if (!first) await sleep(25_000);
        first = false;
        const items = [...group.values()];
        const itemsPath = join(dir, 'items.json');
        const outPath = join(dir, 'heard.json');
        writeFileSync(itemsPath, JSON.stringify(items));
        log(`  transcribing ${items.length} clips of ${basename(path, '.json')} with Whisper large-v3 (taking the GPU lock ${lockPath})`);
        const release = await takeLock(lockPath);
        try {
            const r = spawnSync(py, ['-X', 'utf8', join(ROOT, 'tools', 'listen', 'words.py'), '--items', itemsPath, '--model', join(cache, 'whisper', 'faster-whisper-large-v3-edaa852'), '--out', outPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
            if (r.status !== 0) throw new Error(`the transcriber failed: ${r.stderr || r.stdout}`);
            log(`  ${r.stdout.trim().split('\n').slice(-1).join('')}`);
        } finally {
            release();
        }
        const got = JSON.parse(readFileSync(outPath, 'utf8')) as { items: { id: string; hyp: string }[] };
        const map = stores.get(path) as Record<string, string>;
        for (const it of got.items) map[it.id] = it.hyp;
        writeFileSync(path, `${JSON.stringify(map, null, 1)}\n`);
    }
    const heard = new Map<Job, string>();
    for (const j of jobs) {
        const h = storeOf(j).map[clipOf(j)];
        if (h === undefined) throw new Error(`no transcript of ${j.line.locale} ${j.line.key}`);
        heard.set(j, h);
    }
    const described = spawnSync(py, ['-X', 'utf8', join(ROOT, 'tools', 'listen', 'words.py'), '--describe'], { encoding: 'utf8' });
    if (described.status !== 0) throw new Error(`the transcriber cannot describe itself: ${described.stderr}`);
    const { decode, tools } = JSON.parse(described.stdout) as { decode: Record<string, unknown>; tools: Record<string, string> };
    return { heard, decode, tools };
}

/** Says and transcribes `lines` (each with its language's voice, and `extra` jobs), and scores them. */
async function roundTrip(lines: readonly Line[], extra: readonly { readonly line: Line; readonly voice: string }[], log: (s: string) => void): Promise<{ readonly rows: Scored[]; readonly extraRows: Scored[]; readonly decode: Record<string, unknown>; readonly tools: Record<string, string> }> {
    const cache = process.env['SHRAMKO_LISTEN_CACHE'] ?? join(ROOT, '.cache', 'listen');
    const py = process.env['SHRAMKO_LISTEN_PY'] ?? 'python';
    const lockPath = process.env['GPU_LOCK'] ?? 'C:/dev/.gpu-lock';
    const check = spawnSync(py, ['-X', 'utf8', '-c', 'import faster_whisper, ctranslate2, soundfile, scipy'], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`the Python environment (${py}) lacks faster-whisper or the packages of tools/listen/requirements.txt; set SHRAMKO_LISTEN_PY to its python`);
    const wanted = [...lines.map((line) => ({ line, voice: VOICES[line.locale] })), ...extra];
    const byVoice = new Map<string, string[]>();
    for (const w of wanted) byVoice.set(w.voice, [...(byVoice.get(w.voice) ?? []), w.line.text]);
    const clips = new Map<string, Map<string, string>>();
    for (const [voice, texts] of byVoice) clips.set(voice, makeClips(cache, voice, texts, log));
    const jobs: Job[] = wanted.map((w) => ({ line: w.line, voice: w.voice, wav: clips.get(w.voice)?.get(w.line.text) as string }));
    const { heard, decode, tools } = await transcribe(cache, py, lockPath, jobs, log);
    const scored = jobs.map((j) => score(j.line, j.voice, heard.get(j) as string));
    return { rows: scored.slice(0, lines.length), extraRows: scored.slice(lines.length), decode, tools };
}

// ------------------------------------------------------------------ the command

const round = (x: number): number => Math.round(x * 10000) / 10000;
const rowOut = (r: Scored): Record<string, unknown> => ({ locale: r.locale, key: r.key, text: r.text, heard: r.hyp, rawRate: round(r.rawRate), rate: round(r.rate), ...(r.keyName === undefined ? {} : { keyName: r.keyName, keyHeard: r.keyHeard }) });

export async function main(argv: readonly string[]): Promise<number> {
    const out = (s: string): void => {
        process.stdout.write(`${s}\n`);
    };
    if (!existsSync(join(ROOT, 'tools', 'listen', 'words.py'))) {
        process.stderr.write('listen-words: run it from the repository root (pnpm listen:words)\n');
        return 2;
    }
    const simAt = argv.indexOf('--sim');
    if (simAt >= 0) {
        const root = argv[simAt + 1];
        if (root === undefined) {
            process.stderr.write('listen-words: --sim needs the simulator\'s packages/i18n/locales\n');
            return 2;
        }
        const outAt = argv.indexOf('--out');
        const cache = process.env['SHRAMKO_LISTEN_CACHE'] ?? join(ROOT, '.cache', 'listen');
        const reportPath = outAt >= 0 && argv[outAt + 1] !== undefined ? (argv[outAt + 1] as string) : join(cache, 'words', 'simulator.json');
        const lines = simulatorLines(root);
        out(`listen-words: ${lines.length} lines of the simulator's Fly by Sound files (${SIM_FILES.join(', ')})`);
        const { rows } = await roundTrip(lines, [], out);
        const languages = Object.fromEntries(LOCALES.map((l) => [l, summarise(rows, l, BOUNDS[l], [])]));
        writeFileSync(reportPath, `${JSON.stringify({ format: 'shramko-listen-words-sim/1', date: new Date().toISOString(), root, files: SIM_FILES, bounds: BOUNDS, languages, rows: rows.filter((r) => r.rate > 0).map(rowOut) }, null, 1)}\n`);
        for (const l of LOCALES) {
            const s = languages[l] as LanguageSummary;
            out(`  ${l} ${s.voice}: ${s.lines} lines, ${s.exact} heard exactly, mean ${s.meanRate}, ${s.over.length} over the bound ${s.bound}`);
            for (const r of rows.filter((x) => x.locale === l && x.rate > BOUNDS[l])) out(`    ${r.key} (${round(r.rate)}): "${r.text}" heard "${r.hyp}"`);
        }
        out(`listen-words: report in ${reportPath}`);
        return 0;
    }

    const force = argv.includes('--force');
    const inputs = inputsHash();
    const evidencePath = join(ROOT, 'evidence', 'listen', 'VL-4-words.json');
    if (!force && existsSync(evidencePath)) {
        const ev = JSON.parse(readFileSync(evidencePath, 'utf8')) as { key?: string; pass?: boolean };
        if (ev.key === inputs.hash && ev.pass === true) {
            out(`listen-words: the evidence is fresh for these inputs (${inputs.hash.slice(0, 12)}): nothing to run (--force runs it again)`);
            return 0;
        }
    }
    const lines = packageLines();
    const control = lines.filter((l) => l.locale === CONTROL.locale).map((line) => ({ line, voice: CONTROL.voice }));
    const keyLines = v013KeyLines().map((line) => ({ line, voice: VOICES[line.locale] }));
    out(`listen-words: ${lines.length} lines in ${LOCALES.length} languages, the control (${control.length} ${CONTROL.locale} lines by ${CONTROL.voice}) and the key control (${keyLines.length} lines of v0.13 that name a key)`);
    const { rows, extraRows: extra, decode, tools } = await roundTrip(lines, [...control, ...keyLines], out);
    const extraRows = extra.slice(0, control.length);
    const keyRows = extra.slice(control.length);
    const languages = Object.fromEntries(LOCALES.map((l) => [l, summarise(rows, l, BOUNDS[l])])) as Record<Locale, LanguageSummary>;
    const ctlOver = extraRows.filter((r) => r.rate > BOUNDS[CONTROL.locale]).length;
    const ctlRates = extraRows.map((r) => r.rate).sort((a, b) => a - b);
    const controlOut = { locale: CONTROL.locale, voice: CONTROL.voice, lines: extraRows.length, overBound: ctlOver, share: round(ctlOver / Math.max(extraRows.length, 1)), medianRate: round(ctlRates[Math.floor(ctlRates.length / 2)] ?? 0), fails: ctlOver / Math.max(extraRows.length, 1) >= CONTROL_MIN_SHARE };
    const keyLost = Object.fromEntries(KEY_CONTROL_LOCALES.map((l) => [l, keyRows.filter((r) => r.locale === l && !r.keyHeard).map((r) => ({ key: r.key, text: r.text, heard: r.hyp, rate: round(r.rate) }))]));
    const keyControlOut = { lines: keyRows.length, source: 'tools/listen/key-lines-v013.json', lost: keyLost, fails: KEY_CONTROL_LOCALES.every((l) => (keyLost[l] ?? []).length > 0) };
    const complete = LOCALES.every((l) => languages[l].lines === Object.keys(DICTS[l]).length);
    const valid = complete && controlOut.fails && keyControlOut.fails;
    const pass = valid && LOCALES.every((l) => languages[l].over.length === 0 && languages[l].keys.lost.length === 0);
    const evidence = {
        format: 'shramko-listen-evidence/1',
        key: inputs.hash,
        inputs: { hash: inputs.hash, files: inputs.files, version: WORDS_VERSION, voices: VOICES, decode, tools },
        date: new Date().toISOString(),
        id: 'VL-4-words',
        claim: 'every line of the four locales, said by the local Windows voice of its language and transcribed by Whisper large-v3, has a word error rate (case and punctuation normalised) at most its language\'s bound, and every line that names a key is heard with the key\'s name as a word of its own; the Russian lines said by the English voice fail the bound, and v0.13\'s lines that name a key, said by their voices, lose a key in each of Spanish, Polish and Russian',
        run: 'pnpm listen:words',
        valid,
        pass,
        normalised: 'lower case; the letter yo as ye; apostrophes dropped; every other character that is not a letter, a mark or a digit a space. Two words of the line heard as one, or one as two, are no error; a word with a digit is a number and matches one to three words of the transcript; a recorded word a voice says otherwise (heard) is put back before counting',
        languages,
        control: controlOut,
        keyControl: keyControlOut,
        // every line heard with an error, and every line that names a key (so the key rule can be checked again)
        rows: rows.filter((r) => r.rawRate > 0 || r.keyName !== undefined).map(rowOut)
    };
    mkdirSync(join(ROOT, 'evidence', 'listen'), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 1)}\n`);
    for (const l of LOCALES) {
        const s = languages[l];
        out(`  ${l} ${s.voice}: ${s.lines} lines (${s.words} words), ${s.exact} heard exactly, mean ${s.meanRate}, max ${s.maxRate}, ${s.over.length} over the bound ${s.bound}; ${s.keys.lines - s.keys.lost.length} of ${s.keys.lines} lines that name a key heard with it`);
        for (const r of rows.filter((x) => x.locale === l && (x.rate > BOUNDS[l] || !x.keyHeard))) out(`    ${r.key} (${round(r.rate)}${r.keyHeard ? '' : `, the key ${r.keyName ?? ''} lost`}): "${r.text}" heard "${r.hyp}"`);
    }
    out(`  control, the ${CONTROL.locale} lines by ${CONTROL.voice}: ${controlOut.overBound} of ${controlOut.lines} over the ${CONTROL.locale} bound, median rate ${controlOut.medianRate}`);
    out(`  key control, v0.13's ${keyControlOut.lines} lines that name a key: the key lost in ${KEY_CONTROL_LOCALES.map((l) => `${(keyLost[l] ?? []).length} ${l}`).join(', ')}`);
    out(`listen-words: ${pass ? 'PASS' : valid ? 'FAIL' : 'INVALID'}; evidence in evidence/listen/VL-4-words.json`);
    return pass ? 0 : 1;
}
