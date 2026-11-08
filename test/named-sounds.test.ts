// Reviews M2, M3 and m1 of the v0.13 merge: a sound a pilot hears while flying is named, and played three times after
// the line that names it (M41-5), in the lesson where his path first meets it or in one before it. The target note
// (height.target, about once a second since lane s13-sound's review M2) sounds wherever there is a height band or a
// gate; the open-way chime (safety.free) wherever something ahead leaves a way past it, in the corridor about 20 s of
// its minute. The glossary names every sound, but it is lesson 1 of the full path only, so the fast path must name them
// on its own. Held here by flying each lesson of the fast path with the truth bot, the planner given every frame with
// the lesson's layers, and asking of every watched sound it heard: did this lesson's intro, or an earlier one, name it?
// And a line that names a sound plays it: the open-way chime in the corridor and in tunnel-gaps, and what the
// corridor's checkpoints sound like now (the stage figure; the reset after a touch), not the checkpoint chime.
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

/** The sounds whose naming is held here: the two that sound with no line of speech to tell what they are. */
const WATCHED: readonly CueId[] = ['height.target', 'safety.free'];

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
        const plan = planner.plan({ sample: p.sample(false), world: p.world, target: p.run.target(), floorY: 0 });
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
        // and the open-way chime in the corridor
        expect(where).toEqual({ 'height.target': 'hover-height', 'safety.free': 'corridor' });
    }, 120000);

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

    it('the glossary and the corridor say the chime of a way above or below comes from above or below, in every language, never from ahead (lane s13-elev)', () => {
        const WORDS: Readonly<Record<Locale, { readonly above: RegExp; readonly below: RegExp; readonly corridor: RegExp; readonly ahead: RegExp }>> = {
            en: { above: /From above, notes moving like your height tone in a climb/, below: /From below, the other way/, corridor: /left, right, above or below/, ahead: /from ahead|ahead if it goes up or down/i },
            es: { above: /Desde arriba, notas que se mueven como tu tono de altura al subir/, below: /Desde abajo, al rev/, corridor: /izquierda, derecha, arriba o abajo/, ahead: /de frente/i },
            pl: { above: /Z góry nuty idące jak twój dźwięk wysokości przy wznoszeniu/, below: /Z dołu, w drugą stronę/, corridor: /z góry albo z dołu/, ahead: /z przodu/i },
            ru: { above: /Сверху ноты идут/, below: /Снизу и наоборот/, corridor: /сверху или снизу/, ahead: /спереди/i }
        };
        for (const locale of LOCALES) {
            const glossary = DICTS[locale]['cue.safety.free.glossary'] as string;
            const corridor = DICTS[locale]['lesson.corridor.intro.3'] as string;
            const w = WORDS[locale];
            expect(glossary, locale).toMatch(w.above);
            expect(glossary, locale).toMatch(w.below);
            expect(glossary, locale).not.toMatch(w.ahead);
            expect(corridor, locale).toMatch(w.corridor);
            // its first sentence says what blocks the way ahead; the rest must not place the way above or below there
            expect(corridor.replace(/^[^.]*\./, ''), locale).not.toMatch(w.ahead);
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
