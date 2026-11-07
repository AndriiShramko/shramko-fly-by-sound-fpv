import { describe, expect, it } from 'vitest';
import type { Locale } from '../src/contract';
import { createTranslator, formatMessage, messageArguments, MessageParamError, MessageSyntaxError, parseMessage, pluralCategoriesOf, pluralCategory } from '../src/i18n';
import { REQUIRED_PLURAL } from '../tools/locale-lint';

const SECONDS: Record<Locale, string> = {
    en: '{n, plural, one {# second} other {# seconds}}',
    es: '{n, plural, one {# segundo} other {# segundos}}',
    pl: '{n, plural, one {# sekunda} few {# sekundy} many {# sekund} other {# sekundy}}',
    ru: '{n, plural, one {# секунда} few {# секунды} many {# секунд} other {# секунды}}'
};

describe('formatMessage', () => {
    it('inserts parameters, numbers without grouping', () => {
        expect(formatMessage('en', 'Gate {n} of {total}.', { n: 3, total: 8 })).toBe('Gate 3 of 8.');
        expect(formatMessage('en', '{a}', { a: 12345 })).toBe('12345');
        expect(formatMessage('en', 'Hello {name}.', { name: 'World' })).toBe('Hello World.');
    });

    it('uses the decimal comma of the language', () => {
        expect(formatMessage('ru', '{x}', { x: 42.3 })).toBe('42,3');
        expect(formatMessage('en', '{x}', { x: 42.3 })).toBe('42.3');
    });

    it('chooses the plural form of the language', () => {
        const cases: [Locale, number, string][] = [
            ['en', 1, '1 second'],
            ['en', 2, '2 seconds'],
            ['en', 0, '0 seconds'],
            ['en', 1.5, '1.5 seconds'],
            ['es', 1, '1 segundo'],
            ['es', 30, '30 segundos'],
            ['pl', 1, '1 sekunda'],
            ['pl', 2, '2 sekundy'],
            ['pl', 5, '5 sekund'],
            ['pl', 12, '12 sekund'],
            ['pl', 22, '22 sekundy'],
            ['pl', 1.5, '1,5 sekundy'],
            ['ru', 1, '1 секунда'],
            ['ru', 2, '2 секунды'],
            ['ru', 5, '5 секунд'],
            ['ru', 11, '11 секунд'],
            ['ru', 21, '21 секунда'],
            ['ru', 22, '22 секунды'],
            ['ru', 25, '25 секунд'],
            ['ru', 0.5, '0,5 секунды']
        ];
        for (const [locale, n, expected] of cases) {
            expect(formatMessage(locale, SECONDS[locale], { n }), `${locale} ${n}`).toBe(expected);
        }
    });

    it('an exact branch wins over the category', () => {
        const t = '{n, plural, =0 {none} one {one} other {many}}';
        expect(formatMessage('en', t, { n: 0 })).toBe('none');
        expect(formatMessage('en', t, { n: 1 })).toBe('one');
        expect(formatMessage('en', t, { n: 7 })).toBe('many');
    });

    it('lets a plural branch use other parameters', () => {
        expect(formatMessage('en', '{n, plural, one {# gate of {total}} other {# gates of {total}}}', { n: 2, total: 5 })).toBe('2 gates of 5');
    });

    it('treats # outside a plural as text', () => {
        expect(formatMessage('en', 'Item # one')).toBe('Item # one');
    });
});

describe('formatMessage refuses broken input (negative controls)', () => {
    it('a missing parameter', () => {
        expect(() => formatMessage('en', 'Gate {n}.', {})).toThrow(MessageParamError);
    });

    it('a plural over a non-number', () => {
        expect(() => formatMessage('en', '{n, plural, other {x}}', { n: 'two' })).toThrow(MessageParamError);
    });

    it.each([
        ['an unclosed brace', 'Hello {name'],
        ['a stray closing brace', 'Hello }'],
        ['an empty argument', 'Hello {}'],
        ['a plural without other', '{n, plural, one {a}}'],
        ['an unknown type', '{n, select, other {a}}'],
        ['an unknown category', '{n, plural, some {a} other {b}}'],
        ['a repeated branch', '{n, plural, one {a} one {b} other {c}}'],
        ['an unclosed branch', '{n, plural, other {a}'],
        ['digits missing after =', '{n, plural, = {a} other {b}}']
    ])('%s', (_name, template) => {
        expect(() => parseMessage(template)).toThrow(MessageSyntaxError);
    });
});

describe('messageArguments', () => {
    it('lists names once, sorted, with plural use', () => {
        expect(messageArguments('{b} {a} {b}')).toEqual([
            { name: 'a', plural: false },
            { name: 'b', plural: false }
        ]);
        expect(messageArguments('{n, plural, one {# of {total}} other {# of {total}}}')).toEqual([
            { name: 'n', plural: true },
            { name: 'total', plural: false }
        ]);
        expect(messageArguments('no arguments')).toEqual([]);
    });
});

describe('plural categories', () => {
    it('the categories the lint requires are the ones CLDR gives (negative control: es many is optional)', () => {
        for (const locale of ['en', 'es', 'pl', 'ru'] as const) {
            const cldr = pluralCategoriesOf(locale);
            for (const c of REQUIRED_PLURAL[locale]) expect(cldr, `${locale} ${c}`).toContain(c);
        }
        expect(pluralCategory('ru', 2)).toBe('few');
        expect(pluralCategory('en', 2)).toBe('other');
    });
});

describe('Translator', () => {
    const dicts = {
        en: { hello: 'Hello {name}.', only_en: 'Only English.', plural: SECONDS.en, bad: 'Broken {', time_s: SECONDS.en },
        es: { hello: 'Hola {name}.' },
        pl: {},
        ru: {}
    } as unknown as Parameters<typeof createTranslator>[1];

    it('speaks a line in its language', () => {
        const t = createTranslator('es', dicts);
        expect(t.text({ key: 'hello', params: { name: 'Ana' } })).toBe('Hola Ana.');
        expect(t.has('hello')).toBe(true);
        expect(t.template('hello')).toBe('Hola {name}.');
    });

    it('falls back to English, then to the key, and reports it, never throwing', () => {
        const problems: string[] = [];
        const t = createTranslator('es', dicts, (p) => problems.push(`${p.kind}:${p.key}`));
        expect(t.say('only_en')).toBe('Only English.');
        expect(t.say('nowhere')).toBe('nowhere');
        expect(t.has('only_en')).toBe(false);
        expect(problems).toEqual(['missing-key:only_en', 'missing-key:nowhere']);
    });

    it('answers a broken template or a missing parameter with the key', () => {
        const problems: string[] = [];
        const t = createTranslator('en', dicts, (p) => problems.push(`${p.kind}:${p.key}`));
        expect(t.say('bad')).toBe('bad');
        expect(t.say('hello')).toBe('hello');
        expect(problems).toEqual(['syntax:bad', 'param:hello']);
    });

    it('speaks durations', () => {
        const real = {
            en: { 'time.seconds': SECONDS.en, 'time.minutes': '{n, plural, one {# minute} other {# minutes}}' },
            es: {},
            pl: {},
            ru: {}
        } as unknown as Parameters<typeof createTranslator>[1];
        const t = createTranslator('en', real);
        expect(t.duration(42300)).toBe('42.3 seconds');
        expect(t.duration(1000)).toBe('1 second');
        expect(t.duration(65000)).toBe('1 minute 5 seconds');
        expect(t.duration(120000)).toBe('2 minutes');
        expect(t.duration(119600)).toBe('2 minutes');
        expect(t.duration(59960)).toBe('1 minute');
        expect(t.duration(-5)).toBe('0 seconds');
    });
});
