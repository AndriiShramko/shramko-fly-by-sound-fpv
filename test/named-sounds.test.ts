// Reviews M2, M3 and m1 of the v0.13 merge: a sound a pilot hears while flying is named, and played three times after
// the line that names it (M41-5), in the lesson where his path first meets it or in one before it. The target note
// (height.target, about once a second since lane s13-sound's review M2) sounds wherever there is a height band or a
// gate; the open-way chime (safety.free) wherever something ahead leaves a way past it, in the corridor about 20 s of
// its minute. The glossary names every sound, but it is lesson 1 of the full path only, so the fast path must name them
// on its own. Held here by flying each lesson of the fast path with the truth bot, the planner given every frame with
// the lesson's layers, and asking of every watched sound it heard: did this lesson's intro, or an earlier one, name it?
// And a line that names a sound plays it: the open-way chime in the corridor and in tunnel-gaps, and what the
// corridor's checkpoints sound like now (the stage figure; the reset after a touch), not the checkpoint chime.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CueId, LessonDef, Locale } from '../src/contract';
import { LOCALES } from '../src/contract';
import { DICTS } from '../src/i18n/dicts';
import { CuePlanner } from '../src/cues';
import { getLesson, lessonPaths } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { getBuiltinTheme } from '../src/theme';
import { ScriptedPilot } from './helpers/pilot';
import { playLesson } from './helpers/truth';

/** The sounds whose naming is held here: the three that sound with no line of speech to tell what they are. The target
 * hum joined them with the beacon (lane sonic-beacon, review R3): it now leads the way in the corridor and the tunnels,
 * lessons 4 and 5 of the fast path, before rings-first. */
const WATCHED: readonly CueId[] = ['height.target', 'safety.free', 'target.hum'];

/** The cue ids a lesson names: the cues of its intro lines (each played three times after its line) and of its name-cues goals. */
function namedBy(l: LessonDef): Set<string> {
    const out = new Set<string>();
    for (const line of l.intro) for (const c of line.cues ?? []) out.add(typeof c === 'string' ? c : c.cue);
    for (const g of l.goals) if (g.kind === 'name-cues') for (const c of g.cues) out.add(c);
    return out;
}

/** The watched sounds that sound in a flying frame while the truth bot flies the lesson to its pass. */
function heard(id: string): Set<string> {
    const lesson = getLesson(id);
    const p = new ScriptedPilot(lesson);
    const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: lesson.layers });
    const out = new Set<string>();
    const tick = p.tick.bind(p);
    let seen = 0;
    p.tick = () => {
        tick();
        for (const a of p.actions.slice(seen)) if (a.kind === 'cue') planner.cue(a.event);
        seen = p.actions.length;
        const plan = planner.plan({ sample: p.sample(false), world: p.world, target: p.run.target(), beacon: p.run.beaconTarget(), floorY: 0 });
        if (p.run.phase !== 'flying') return;
        for (const c of plan.cues) {
            const cue = c.id.split(':')[0] as string;
            if (WATCHED.includes(cue as CueId)) out.add(cue);
        }
    };
    playLesson(p, () => 'truth', 2 * lesson.pass.required);
    expect(p.run.phase, id).toBe('passed');
    return out;
}

const cuesOf = (l: LessonDef, key: string): readonly unknown[] | undefined => l.intro.find((x) => x.key === key)?.cues;

describe('a sound heard while flying is named where the pilot first hears it (reviews M2 and M3 of the merge)', () => {
    it('the fast path names each watched sound in the lesson where it first sounds, or before', () => {
        const named = new Set<string>();
        const where: Record<string, string> = {};
        for (const id of lessonPaths().fast) {
            const l = getLesson(id);
            for (const c of namedBy(l)) named.add(c);
            // module 0 has no flight; free-garden flies a scan, which comes after every lesson that names a watched sound
            if (l.world.kind !== 'analytic') continue;
            for (const c of heard(id)) {
                where[c] ??= id;
                expect(named.has(c), `${c} sounds while flying ${id}, and no lesson so far named it`).toBe(true);
            }
        }
        // the test sees each sound where it first sounds: the target note in hover-height, the fast path's first flight,
        // and the open-way chime and the target hum (the beacon along the track) in the corridor
        expect(where).toEqual({ 'height.target': 'hover-height', 'safety.free': 'corridor', 'target.hum': 'corridor' });
    }, 120000);

    it('the corridor names the beacon hum in its own line, played from the left, before the goal (lane sonic-beacon, review R3)', () => {
        const keys = getLesson('corridor').intro.map((x) => x.key);
        expect(cuesOf(getLesson('corridor'), 'lesson.corridor.intro.5')).toEqual([{ cue: 'target.hum', from: 'left' }]);
        expect(keys.indexOf('lesson.corridor.intro.5')).toBeLessThan(keys.indexOf('lesson.corridor.goal.1'));
        // the corridor comes before every tunnel in both paths, so its line names the hum for them too
        for (const path of [lessonPaths().fast, lessonPaths().full]) {
            const c = path.indexOf('corridor');
            for (const [i, id] of path.entries()) if (id.startsWith('tunnel-')) expect(i, id).toBeGreaterThan(c);
        }
    });

    it('the full path names them all in its second lesson, the glossary', () => {
        const full = lessonPaths().full;
        expect(full[1]).toBe('ears-glossary');
        for (const c of WATCHED) expect(namedBy(getLesson('ears-glossary')).has(c), c).toBe(true);
    });

    it('hover-height names the target note after the height tone and its buzz, in its own line', () => {
        const intro = getLesson('hover-height').intro;
        const at = (cue: string): number => intro.findIndex((x) => (x.cues ?? []).some((c) => (typeof c === 'string' ? c : c.cue) === cue));
        expect(at('height.tone')).toBeGreaterThanOrEqual(0);
        expect(at('height.target')).toBeGreaterThan(at('height.tone'));
        expect(intro[at('height.target')]?.cues).toEqual(['height.target']);
    });

    it('the lines that name the open-way chime play it, from the left: the corridor\'s and tunnel-gaps\' intro.2', () => {
        const free = [{ cue: 'safety.free', from: 'left' }];
        expect(cuesOf(getLesson('corridor'), 'lesson.corridor.intro.3')).toEqual(free);
        expect(cuesOf(getLesson('tunnel-gaps'), 'lesson.tunnel-gaps.intro.2')).toEqual(free);
    });

    it('tunnel-gaps\' intro.3 plays the chime above and below that it describes, and walls-pillar names its chime with a play (lane s13-elev)', () => {
        expect(cuesOf(getLesson('tunnel-gaps'), 'lesson.tunnel-gaps.intro.3')).toEqual([
            { cue: 'safety.free', from: 'up' },
            { cue: 'safety.free', from: 'down' }
        ]);
        const pillar = getLesson('walls-pillar');
        const line = pillar.intro.find((x) => (x.cues ?? []).some((c) => (typeof c === 'string' ? c : c.cue) === 'safety.free'));
        expect(line?.key).toBe('lesson.walls-pillar.intro.3');
        expect(line?.cues).toEqual([{ cue: 'safety.free', from: 'left' }]);
        // after the line that sets the task, before the goal
        expect(pillar.intro.map((x) => x.key)).toEqual(['lesson.walls-pillar.intro.1', 'lesson.walls-pillar.intro.2', 'lesson.walls-pillar.intro.3', 'lesson.walls-pillar.goal.1']);
    });

    // Review E2 of lane s13-elev: with SonicPrefs.heightDirection off the chime of a way above or below comes from ahead
    // (v0.13's placement), with it on from above or below. So a line that names that chime holds either way: the way above
    // is told by its pitch (moving like the height tone in a climb), and wherever the line says the chime comes from above
    // or below, it says so in the sentence that names the setting by its own name; never from ahead. The setting's
    // description says what off does, and that the ceiling and the floor come from above and below either way (they do:
    // test/elevation.test.ts). Control: the lane's lines before the review (test/fixtures/lines-s13-elev-0dd3cd9.json)
    // each fail it.
    const CHIME_LINES = ['cue.safety.free.glossary', 'lesson.corridor.intro.3', 'lesson.tunnel-gaps.intro.3'] as const;
    const DESCRIPTION = 'menu.setting.height-direction-what';
    const WORDS: Readonly<Record<Locale, { readonly climb: RegExp; readonly fromAboveBelow: RegExp; readonly ahead: RegExp; readonly ceiling: RegExp; readonly eitherWay: RegExp }>> = {
        en: { climb: /like your height tone in a climb/i, fromAboveBelow: /from above|from below|come from [^.]*above or below/i, ahead: /from ahead/i, ceiling: /ceiling/i, eitherWay: /either way/i },
        es: { climb: /como tu tono de altura al subir/i, fromAboveBelow: /\b(de|desde) (arriba|abajo)\b|vienen? de[^.]*\b(arriba|abajo)\b/i, ahead: /de frente/i, ceiling: /techo/i, eitherWay: /de todos modos/i },
        pl: { climb: /jak twój dźwięk wysokości przy wznoszeniu/i, fromAboveBelow: /z (góry|dołu)/i, ahead: /z przodu/i, ceiling: /sufit/i, eitherWay: /i tak/i },
        ru: { climb: /как твой тон высоты при подъёме/i, fromAboveBelow: /сверху|снизу/i, ahead: /спереди/i, ceiling: /потолок/i, eitherWay: /в любом случае/i }
    };
    const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);
    const named = (locale: Locale, sentence: string): boolean => sentence.toLocaleLowerCase(locale).includes((DICTS[locale]['menu.setting.height-direction'] as string).toLocaleLowerCase(locale));
    /** what is wrong with a chime line, [] when nothing */
    const chimeProblems = (locale: Locale, text: string): string[] => {
        const w = WORDS[locale];
        const out: string[] = [];
        if (!w.climb.test(text)) out.push('no pitch for the way above');
        if (w.ahead.test(text)) out.push('from ahead');
        for (const s of sentences(text)) if (w.fromAboveBelow.test(s) && !named(locale, s)) out.push(`from above or below without the setting: "${s}"`);
        return out;
    };
    /** what is wrong with the setting's description, [] when nothing */
    const descriptionProblems = (locale: Locale, text: string): string[] => {
        const w = WORDS[locale];
        const off = (DICTS[locale]['menu.value.off'] as string).toLocaleLowerCase(locale);
        const out: string[] = [];
        if (!sentences(text).some((s) => s.toLocaleLowerCase(locale).startsWith(off) && w.ahead.test(s))) out.push('not what off does (from ahead)');
        for (const s of sentences(text)) if (w.ceiling.test(s) && !w.eitherWay.test(s)) out.push(`the ceiling and the floor, not either way: "${s}"`);
        return out;
    };

    it('the lines of the chime above and below hold with the setting on and off: the way by its pitch, from above or below only with the setting\'s name, never from ahead (review E2 of lane s13-elev)', () => {
        for (const locale of LOCALES) {
            for (const key of CHIME_LINES) expect(chimeProblems(locale, DICTS[locale][key] as string), `${locale} ${key}`).toEqual([]);
            // the glossary and tunnel-gaps tell the direction too, with the setting's name; the corridor tells the pitch alone
            for (const key of ['cue.safety.free.glossary', 'lesson.tunnel-gaps.intro.3']) expect(sentences(DICTS[locale][key] as string).some((s) => named(locale, s)), `${locale} ${key}`).toBe(true);
            expect(descriptionProblems(locale, DICTS[locale][DESCRIPTION] as string), locale).toEqual([]);
        }
    });

    it('control: the lane\'s lines before the review fail it, each of them in every language', () => {
        const before = (JSON.parse(readFileSync(new URL('./fixtures/lines-s13-elev-0dd3cd9.json', import.meta.url), 'utf8')) as { lines: Record<Locale, Record<string, string>> }).lines;
        for (const locale of LOCALES) {
            for (const key of CHIME_LINES) expect(chimeProblems(locale, before[locale][key] as string), `${locale} ${key}`).not.toEqual([]);
            expect(descriptionProblems(locale, before[locale][DESCRIPTION] as string), locale).not.toEqual([]);
        }
    });

    it('the corridor names what its checkpoints sound like: the stage figure, and the reset after a touch (review m1)', () => {
        const corridor = getLesson('corridor');
        expect(cuesOf(corridor, 'lesson.corridor.intro.4')).toEqual(['target.stage', 'safety.reset']);
        // its checkpoints end stages or end the track: the checkpoint chime is neither named nor heard there
        expect(namedBy(corridor).has('target.checkpoint')).toBe(false);
        expect(corridor.checkpoints.slice(1, -1).every((cp) => cp.stage !== undefined)).toBe(true);
        expect(corridor.goals.at(-1)?.kind).toBe('track-end');
    });
});
