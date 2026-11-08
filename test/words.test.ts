// The words check (lane s13-elev E2-2, tools/listen-words.ts): how a transcript is compared with a line, and what the
// lines are. The round trip itself (each line said by the local voice of its language, transcribed by Whisper large-v3)
// runs on a machine with the voices and a GPU: pnpm listen:words, evidence/listen/VL-4-words.json.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '../src/contract';
import { DICTS } from '../src/i18n';
import { BOUNDS, CONTROL, CONTROL_MIN_SHARE, HEARD, isNumber, KEY_CONTROL_LOCALES, KEY_OF, keyHeard, packageLines, putBack, score, v013KeyLines, VOICES, wordErrors, words } from '../tools/listen-words';

describe('the words of a line and of a transcript', () => {
    it('are compared without case and punctuation', () => {
        expect(words('Press T to start or stop recording.', 'en')).toEqual(['press', 't', 'to', 'start', 'or', 'stop', 'recording']);
        expect(words('¡Ya! ¿Dónde está?', 'es')).toEqual(['ya', 'dónde', 'está']);
        expect(words('Naciśnij T, aby zacząć: teraz…', 'pl')).toEqual(['naciśnij', 't', 'aby', 'zacząć', 'teraz']);
        expect(words('The pilot’s e-mail, 20 %', 'en')).toEqual(['the', 'pilots', 'e', 'mail', '20']);
    });

    it('read the Russian yo as ye, which Russian writes either way', () => {
        expect(words('Ещё раз!', 'ru')).toEqual(words('еще раз', 'ru'));
    });

    it('take a word with a digit as a number', () => {
        expect(['2', '3d', '28'].every(isNumber)).toBe(true);
        expect(['two', 'dwa'].some(isNumber)).toBe(false);
    });
});

describe('the word errors of a transcript', () => {
    const e = (ref: string, hyp: string): number => wordErrors(words(ref, 'en'), words(hyp, 'en')).errors;

    it('count substitutions, deletions and insertions', () => {
        expect(e('a b c', 'a b c')).toBe(0);
        expect(e('a b c', 'a x c')).toBe(1);
        expect(e('a b c', 'a c')).toBe(1);
        expect(e('a b c', 'a b x c')).toBe(1);
        expect(e('a b c', '')).toBe(3);
        expect(wordErrors(words('a b c d', 'en'), words('a x c d', 'en')).rate).toBe(0.25);
    });

    it('take two words heard as one, or one as two, as no error', () => {
        expect(e('Fly by Sound', 'Flyby sound.')).toBe(0);
        expect(e('an email', 'an e-mail')).toBe(0);
        expect(e('Press T to start', 'Presst to start')).toBe(0);
        // joined into another word, they are a substitution and a deletion: "Pulsa T" heard as the word "Púlsate"
        expect(e('Pulsa T para', 'Púlsate para')).toBe(2);
    });

    it('match a number with one to three words, whatever they are, and count it when nothing is heard for it', () => {
        expect(wordErrors(words('Bramka 2 z 5.', 'pl'), words('Bramka druga z pięciu', 'pl')).errors).toBe(0);
        expect(wordErrors(words('Lekcja 6 z 28.', 'pl'), words('Lekcja szósta z dwudziestu ośmiu', 'pl')).errors).toBe(0);
        expect(e('Gate 2 of 5', 'Gate of')).toBe(2);
        expect(e('a 28 b', 'a x y z w b')).toBe(1);
    });

    it('control: a Russian line said by the English voice, which skips what it cannot say, is mostly errors', () => {
        const line = 'Нажми T, чтобы начать или остановить запись.';
        expect(wordErrors(words(line, 'ru'), words('Т.', 'ru')).rate).toBeGreaterThan(0.8);
    });
});

describe('what a voice is known to say otherwise', () => {
    it('is put back only in its own line and language, and only where the line says those words', () => {
        const ref = words('Fly by Sound', 'ru');
        const records = [{ locale: 'ru', key: 'app.name', said: 'Fly by', heard: 'F.L.Y.B.Y.', why: 'test' }] as const;
        expect(putBack(words('F.L.Y.B.Y. Sound', 'ru'), ref, 'ru', 'app.name', records)).toEqual(['fly', 'by', 'sound']);
        expect(putBack(words('F.L.Y.B.Y. Sound', 'ru'), ref, 'ru', 'menu.title', records)).toEqual(['f', 'l', 'y', 'b', 'y', 'sound']);
        expect(putBack(words('F.L.Y.B.Y. Sound', 'pl'), ref, 'pl', 'app.name', records)).toEqual(['f', 'l', 'y', 'b', 'y', 'sound']);
        expect(score({ locale: 'ru', key: 'app.name', text: 'Fly by Sound' }, 'v', 'F.L.Y.B.Y. Sound', records).rate).toBe(0);
        expect(score({ locale: 'ru', key: 'app.name', text: 'Fly by Sound' }, 'v', 'F.L.Y.B.Y. Sound', []).rate).toBe(1);
        // a habit of the voice ('*') is put back in any line of its language whose text has the words, and no other
        const habit = [{ locale: 'en', key: '*', said: 'height tone', heard: 'high tone', why: 'test' }] as const;
        expect(score({ locale: 'en', key: 'layer.height.name', text: 'Height tone' }, 'v', 'High tone.', habit).rate).toBe(0);
        expect(score({ locale: 'en', key: 'x', text: 'A high tone' }, 'v', 'A high tone', habit).rate).toBe(0);
        expect(score({ locale: 'en', key: 'x', text: 'A low tone' }, 'v', 'A high tone', habit).rate).toBeCloseTo(1 / 3, 6);
    });

    it('names a line that exists, in words the line has, and says why', () => {
        const lines = packageLines();
        for (const h of HEARD) {
            const said = words(h.said, h.locale).join(' ');
            const mine = lines.filter((l) => l.locale === h.locale && (h.key === '*' || l.key === h.key));
            expect(mine.length, `${h.locale} ${h.key}`).toBeGreaterThan(0);
            expect(mine.some((l) => ` ${words(l.text, h.locale).join(' ')} `.includes(` ${said} `)), `${h.locale} ${h.key}: ${h.said}`).toBe(true);
            expect(h.why.length, `${h.locale} ${h.key}`).toBeGreaterThan(10);
        }
    });
});

describe('the lines of the check', () => {
    it('are every line of the four locales, each with its parameters filled as a host fills them', () => {
        const lines = packageLines();
        for (const locale of LOCALES) {
            const mine = lines.filter((l) => l.locale === locale);
            expect(mine.map((l) => l.key), locale).toEqual(Object.keys(DICTS[locale]));
            expect(mine.every((l) => !l.text.includes('{')), locale).toBe(true);
        }
        // the help K says names the simulator's keys
        expect(lines.find((l) => l.locale === 'en' && l.key === 'help.record')?.text).toBe('Press T to start or stop recording.');
        expect(KEY_OF['help.reset']).toBe('R');
        expect(lines.find((l) => l.locale === 'pl' && l.key === 'fly.gate')?.text).toBe('Bramka 2 z 5.');
    });

    it('know the key a line names (review E4 of lane s13-elev): 17 lines a language, the key of the simulator or Escape', () => {
        const lines = packageLines();
        for (const locale of LOCALES) {
            const keyed = lines.filter((l) => l.locale === locale && l.keyName !== undefined);
            expect(keyed.length, locale).toBe(17);
            for (const l of keyed) expect(words(l.text, locale).join(' '), `${locale} ${l.key}`).toContain(words(l.keyName as string, locale).join(' '));
        }
        expect(lines.find((l) => l.locale === 'ru' && l.key === 'help.send')?.keyName).toBe('U');
        expect(lines.find((l) => l.locale === 'pl' && l.key === 'survey.howto')?.keyName).toBe('Escape');
        expect(lines.find((l) => l.locale === 'es' && l.key === 'fly.go')?.keyName).toBeUndefined();
        // the control's lines: v0.13's 17 a language in Spanish, Polish and Russian, filled the same way
        const v013 = v013KeyLines();
        expect(v013).toHaveLength(17 * KEY_CONTROL_LOCALES.length);
        expect(v013.every((l) => l.keyName !== undefined && !l.text.includes('{'))).toBe(true);
        expect(v013.find((l) => l.locale === 'es' && l.key === 'help.record')?.text).toBe('Pulsa T para empezar o parar la grabación.');
    });

    it('hear the key when its name is a word of its own in the transcript, and only then', () => {
        const es = { locale: 'es', keyName: 'T' } as const;
        expect(keyHeard(es, 'Pulsa la tecla T para empezar o parar la grabación.')).toBe(true);
        expect(keyHeard(es, 'Púlsate para empezar o parar la grabación.')).toBe(false);
        expect(keyHeard({ locale: 'ru', keyName: 'U' }, 'Нажми её, чтобы отправить полёт автору')).toBe(false);
        expect(keyHeard({ locale: 'ru', keyName: 'U' }, 'Нажми клавишу U, чтобы отправить полёт автору')).toBe(true);
        expect(keyHeard({ locale: 'pl', keyName: 'I' }, 'Naciśnij, aby usłyszeć, gdzie jesteś.')).toBe(false);
        expect(keyHeard({ locale: 'ru', keyName: 'Escape' }, 'Нажми клавишу Escape, чтобы пропустить вопрос.')).toBe(true);
        expect(keyHeard({ locale: 'en', keyName: 'Enter' }, 'Press enter when you are done.')).toBe(true);
        // a line that names no key has nothing to lose
        expect(keyHeard({ locale: 'en' }, 'Go.')).toBe(true);
    });

    it('have one bound per language, a word error rate under one', () => {
        for (const locale of LOCALES) {
            expect(BOUNDS[locale], locale).toBeGreaterThanOrEqual(0);
            expect(BOUNDS[locale], locale).toBeLessThan(1);
        }
    });
});

describe('the last run of the words check (evidence/listen/VL-4-words.json)', () => {
    interface Row {
        readonly locale: Locale;
        readonly key: string;
        readonly text: string;
        readonly heard: string;
        readonly rate: number;
        readonly keyName?: string;
        readonly keyHeard?: boolean;
    }
    interface Language {
        readonly lines: number;
        readonly bound: number;
        readonly over: readonly string[];
        readonly voice: string;
        readonly keys: { readonly lines: number; readonly lost: readonly string[] };
    }
    interface Lost {
        readonly key: string;
        readonly text: string;
        readonly heard: string;
    }
    const ev = JSON.parse(readFileSync(new URL('../evidence/listen/VL-4-words.json', import.meta.url), 'utf8')) as {
        valid: boolean;
        pass: boolean;
        languages: Record<Locale, Language>;
        control: { locale: string; voice: string; share: number; fails: boolean };
        keyControl: { lines: number; lost: Record<string, Lost[]>; fails: boolean };
        rows: Row[];
    };

    it('heard every line of every language with its own voice, each within its language\'s bound, the bounds those of the check', () => {
        expect(ev.valid).toBe(true);
        expect(ev.pass).toBe(true);
        for (const locale of LOCALES) {
            const l = ev.languages[locale];
            expect(l.lines, locale).toBe(Object.keys(DICTS[locale]).length);
            expect(l.bound, locale).toBe(BOUNDS[locale]);
            expect(l.voice, locale).toBe(VOICES[locale]);
            expect(l.over, locale).toEqual([]);
        }
    });

    it('scored again here, every line it heard with an error is within its bound, and scores as it did', () => {
        expect(ev.rows.length).toBeGreaterThan(0);
        for (const r of ev.rows) {
            const s = score({ locale: r.locale, key: r.key, text: r.text }, VOICES[r.locale], r.heard);
            expect(s.rate, `${r.locale} ${r.key}`).toBeCloseTo(r.rate, 4);
            expect(s.rate, `${r.locale} ${r.key}: "${r.text}" heard "${r.heard}"`).toBeLessThanOrEqual(BOUNDS[r.locale]);
        }
    });

    it('control: the Russian lines said by the English voice fail the Russian bound', () => {
        expect(ev.control.locale).toBe(CONTROL.locale);
        expect(ev.control.voice).toBe(CONTROL.voice);
        expect(ev.control.fails).toBe(true);
        expect(ev.control.share).toBeGreaterThanOrEqual(CONTROL_MIN_SHARE);
    });

    it("heard every line that names a key with the key's name as a word of its own, in every language; checked again here (review E4 of lane s13-elev)", () => {
        for (const locale of LOCALES) {
            expect(ev.languages[locale].keys.lines, locale).toBe(17);
            expect(ev.languages[locale].keys.lost, locale).toEqual([]);
            const keyed = ev.rows.filter((r) => r.locale === locale && r.keyName !== undefined);
            expect(keyed.length, locale).toBe(17);
            for (const r of keyed) expect(keyHeard({ locale, keyName: r.keyName as string }, r.heard), `${locale} ${r.key}: "${r.heard}"`).toBe(true);
        }
    });

    it("control: v0.13's lines that name a key, said by their voices, lose a key in each of Spanish, Polish and Russian; checked again here", () => {
        expect(ev.keyControl.lines).toBe(17 * KEY_CONTROL_LOCALES.length);
        expect(ev.keyControl.fails).toBe(true);
        const lines = v013KeyLines();
        for (const locale of KEY_CONTROL_LOCALES) {
            const lost = ev.keyControl.lost[locale] ?? [];
            expect(lost.length, locale).toBeGreaterThan(0);
            for (const l of lost) {
                const line = lines.find((x) => x.locale === locale && x.key === l.key);
                expect(line?.text, `${locale} ${l.key}`).toBe(l.text);
                expect(keyHeard({ locale, keyName: line?.keyName as string }, l.heard), `${locale} ${l.key}: "${l.heard}"`).toBe(false);
            }
        }
    });
});
