import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LAYER_IDS, LOCALES, MODULES, type Locale } from '../src/contract';
import { CUE_IDS, DICTS, FREE_KEYS, LESSONS, lessonKeys, messageArguments, requiredKeys } from '../src/i18n';
import { SURVEYS } from '../src/survey';
import { checkParity, lintDict } from '../tools/locale-lint';

const LOCALE_DIR = fileURLToPath(new URL('../locales/', import.meta.url));

/** The arguments each text takes: the interface between the lesson and menu code and the strings. */
const ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
    'lesson.hover-height.goal.1': ['seconds'],
    'lesson.move-stop.intro.1': ['metres'],
    'glossary.again': ['key'],
    'quiz.score': ['right', 'total'],
    'quiz.option': ['label', 'n'],
    'narrate.coming': ['name'],
    'menu.item': ['label', 'n', 'total'],
    'menu.setting.volume': ['layer'],
    'menu.setting.pitch': ['layer'],
    'help.record': ['key'],
    'help.send': ['key'],
    'help.status': ['key'],
    'help.repeat': ['key'],
    'help.glossary': ['key'],
    'help.reset': ['key'],
    'help.next': ['key'],
    'rec.ask': ['key'],
    'rec.recover': ['key'],
    'send.ask': ['key'],
    'send.confirm': ['key'],
    'status.lesson': ['n', 'title'],
    'status.progress': ['counted', 'lesson', 'lessons', 'n', 'required', 'step', 'steps', 'title'],
    'status.progress-step': ['lesson', 'lessons', 'step', 'steps', 'title'],
    'status.theme': ['name'],
    'fly.gate': ['n', 'total'],
    'fly.next-step': ['title'],
    'fly.attempt': ['n'],
    'fly.time': ['time'],
    'fly.best-time': ['time'],
    'fly.touches': ['n'],
    'fly.progress': ['counted', 'n', 'required'],
    'fly.offer-next': ['key'],
    'reason.height-high': ['percent'],
    'reason.height-low': ['percent'],
    'reason.turn-left': ['degrees'],
    'reason.turn-right': ['degrees'],
    'reason.zone-past': ['metres'],
    'reason.zone-short': ['metres'],
    'reason.stop-far': ['limit', 'metres'],
    'reason.around': ['degrees'],
    'reason.distance': ['metres', 'total'],
    'reason.gate-missed': ['n'],
    'reason.gates': ['passed', 'total'],
    'reason.touches': ['limit', 'n'],
    'time.minutes': ['n'],
    'time.seconds': ['n'],
    'survey.howto': ['skip'],
    'survey.howto-voice': ['skip'],
    'survey.question-of': ['n', 'total'],
    'survey.repeat-hint': ['key'],
    'survey.open-howto': ['key']
};

describe('the catalogue', () => {
    const keys = requiredKeys();

    it('lists every key once', () => {
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('covers every layer, sector-independent group, module and the lessons of every module', () => {
        for (const id of LAYER_IDS) expect(keys).toContain(`layer.${id}.name`);
        for (const m of MODULES) {
            expect(keys).toContain(`module.${m}.name`);
            expect(LESSONS.some((l) => l.module === m), `module ${m} has a lesson`).toBe(true);
        }
        for (const cue of CUE_IDS) {
            const layer = cue.split('.')[0];
            expect((LAYER_IDS as readonly string[]).includes(layer as string), `${cue} is under a layer`).toBe(true);
        }
    });

    it('has unique lesson ids, each lesson with title, intro, goal, pass and retry', () => {
        expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
        for (const l of LESSONS) {
            const lk = lessonKeys(l);
            expect(lk.some((k) => k.endsWith('.title'))).toBe(true);
            expect(l.intro).toBeGreaterThanOrEqual(1);
            expect(l.goals).toBeGreaterThanOrEqual(1);
            expect(lk).toContain(`lesson.${l.id}.pass`);
            expect(lk).toContain(`lesson.${l.id}.retry`);
        }
        // the modules appear in order
        const modules = LESSONS.map((l) => l.module);
        expect([...modules].sort((a, b) => a - b)).toEqual(modules);
    });

    it('contains the free keys without repeats', () => {
        expect(new Set(FREE_KEYS).size).toBe(FREE_KEYS.length);
    });
});

describe('the surveys', () => {
    it('have unique ids, single-key answers and every text in the catalogue', () => {
        const keys = new Set(requiredKeys());
        expect(new Set(SURVEYS.map((s) => s.id)).size).toBe(SURVEYS.length);
        expect(SURVEYS.map((s) => s.variant).sort()).toEqual(['child', 'first', 'returning']);
        for (const s of SURVEYS) {
            expect(s.items.length, s.id).toBeLessThanOrEqual(10);
            expect(new Set(s.items.map((i) => i.id)).size, s.id).toBe(s.items.length);
            for (const item of s.items) {
                expect(keys.has(item.prompt.key), item.prompt.key).toBe(true);
                if (item.kind === 'scale') {
                    expect(item.max - item.min, item.id).toBeGreaterThanOrEqual(2);
                    expect(item.max, item.id).toBeLessThanOrEqual(9);
                    expect(item.min, item.id).toBeGreaterThanOrEqual(0);
                    for (const a of item.anchors) expect(keys.has(a.key), a.key).toBe(true);
                } else if (item.kind === 'choice') {
                    expect(item.options.length, item.id).toBeGreaterThanOrEqual(2);
                    expect(item.options.length, item.id).toBeLessThanOrEqual(9);
                    for (const o of item.options) expect(keys.has(o.key), o.key).toBe(true);
                } else {
                    expect(item.maxSeconds, item.id).toBeGreaterThanOrEqual(5);
                    expect(item.maxSeconds, item.id).toBeLessThanOrEqual(120);
                }
            }
        }
    });
});

describe('locale files', () => {
    it('are valid UTF-8 JSON with LF endings, one key per line and no repeated key', () => {
        for (const locale of LOCALES) {
            const raw = readFileSync(`${LOCALE_DIR}${locale}.json`, 'utf8');
            expect(raw.charCodeAt(0), `${locale} BOM`).not.toBe(0xfeff);
            expect(raw.includes('\r'), `${locale} CR`).toBe(false);
            expect(raw.endsWith('}\n'), `${locale} ends with a newline`).toBe(true);
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const lines = raw.split('\n').filter((l) => /^ {4}"/.test(l));
            expect(lines.length, `${locale} one key per line`).toBe(Object.keys(parsed).length);
            const names = lines.map((l) => (/^ {4}"([^"]+)":/.exec(l) as RegExpExecArray)[1]);
            expect(new Set(names).size, `${locale} repeated key`).toBe(names.length);
            expect(Object.keys(DICTS[locale]).length).toBe(Object.keys(parsed).length);
        }
    });

    it('hold exactly the catalogue keys, in the catalogue order, with the same arguments', () => {
        expect(checkParity(DICTS, requiredKeys())).toEqual([]);
    });

    it('take the documented arguments', () => {
        const withArgs = Object.keys(DICTS.en).filter((k) => messageArguments(DICTS.en[k] as string).length > 0);
        expect(withArgs.sort()).toEqual(Object.keys(ARGUMENTS).sort());
        for (const [key, names] of Object.entries(ARGUMENTS)) {
            for (const locale of LOCALES) {
                expect(
                    messageArguments(DICTS[locale][key] as string).map((a) => a.name),
                    `${locale} ${key}`
                ).toEqual([...names]);
            }
        }
    });

    it.each(LOCALES)('%s passes the speech lint', (locale: Locale) => {
        expect(lintDict(locale, DICTS[locale], DICTS.en)).toEqual([]);
    });

    it('have no text copied from English into another language', () => {
        for (const locale of ['es', 'pl', 'ru'] as const) {
            const same = Object.keys(DICTS.en).filter((k) => (DICTS[locale][k] as string) === (DICTS.en[k] as string) && (DICTS.en[k] as string).length > 3);
            expect(same, locale).toEqual(['app.name']);
        }
    });
});

describe('the parity and lint rules refuse bad dictionaries (negative controls)', () => {
    const base = {
        'a.one': 'Hello {name}.',
        'a.two': '{n, plural, one {# gate} other {# gates}}'
    };
    const good = { en: base, es: { 'a.one': 'Hola {name}.', 'a.two': '{n, plural, one {# puerta} other {# puertas}}' }, pl: { 'a.one': 'Cześć {name}.', 'a.two': '{n, plural, one {# bramka} few {# bramki} many {# bramek} other {# bramki}}' }, ru: { 'a.one': 'Привет, {name}.', 'a.two': '{n, plural, one {# ворота} few {# ворот} many {# ворот} other {# ворот}}' } };
    const keys = ['a.one', 'a.two'];

    it('accepts a good set', () => {
        expect(checkParity(good, keys)).toEqual([]);
        expect(lintDict('ru', good.ru, good.en)).toEqual([]);
        expect(lintDict('pl', good.pl, good.en)).toEqual([]);
    });

    it('finds a missing key, an extra key and a wrong order', () => {
        const rules = (d: Record<string, Record<string, string>>): string[] => checkParity(d as never, keys).map((p) => `${p.locale}:${p.rule}`);
        expect(rules({ ...good, es: { 'a.one': 'Hola {name}.' } })).toEqual(['es:missing-key']);
        expect(rules({ ...good, es: { ...good.es, 'a.three': 'x' } })).toEqual(['es:extra-key']);
        expect(rules({ ...good, es: { 'a.two': good.es['a.two'], 'a.one': good.es['a.one'] } })).toEqual(['es:key-order']);
    });

    it('finds a renamed or missing argument', () => {
        const wrong = { ...good, pl: { ...good.pl, 'a.one': 'Cześć {imie}.' } };
        expect(checkParity(wrong as never, keys).map((p) => `${p.locale}:${p.rule}`)).toEqual(['pl:arguments']);
        const none = { ...good, ru: { ...good.ru, 'a.one': 'Привет.' } };
        expect(checkParity(none as never, keys).map((p) => `${p.locale}:${p.rule}`)).toEqual(['ru:arguments']);
    });

    it('finds each lint problem', () => {
        const rules = (locale: Locale, dict: Record<string, string>): string[] => lintDict(locale, dict, good.en as never).map((p) => p.rule);
        expect(rules('en', { x: '' })).toEqual(['empty']);
        expect(rules('en', { x: ' leading space' })).toContain('whitespace');
        expect(rules('en', { x: 'double  space' })).toContain('whitespace');
        expect(rules('en', { x: 'a'.repeat(300) })).toContain('length');
        expect(rules('en', { x: 'Broken {name' })).toEqual(['syntax']);
        expect(rules('ru', { x: '{n, plural, one {# секунда} other {# секунд}}' })).toContain('plural-categories');
        expect(rules('en', { x: 'Use *bold* text' })).toContain('forbidden-character');
        expect(rules('en', { x: 'Press (1) now' })).toContain('forbidden-character');
        expect(rules('en', { x: 'A happy \u{1F600} face' })).toContain('forbidden-character');
        expect(rules('ru', { x: 'Это hello мир' })).toContain('script');
        expect(rules('ru', { x: 'Only Latin words here' })).toContain('script');
        expect(rules('pl', { x: 'Привет' })).toContain('script');
        expect(rules('es', { 'a.one': 'Hello {name}.' })).toContain('copied-english');
    });
});

describe('every lesson and cue text exists in every language', () => {
    it('names and describes each cue, and each lesson has all its lines', () => {
        for (const locale of LOCALES) {
            for (const cue of CUE_IDS) {
                expect(DICTS[locale][`cue.${cue}.name`], `${locale} ${cue}`).toBeTruthy();
                expect(DICTS[locale][`cue.${cue}.glossary`], `${locale} ${cue}`).toBeTruthy();
            }
            for (const lesson of LESSONS) for (const k of lessonKeys(lesson)) expect(DICTS[locale][k], `${locale} ${k}`).toBeTruthy();
        }
    });
});
