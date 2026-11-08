// Review M2 of the v0.13 merge: a sound a pilot hears while flying is named, and played three times after the line
// that names it (M41-5), in the lesson where his path first meets it or in one before it. The target note
// (height.target, about once a second since lane s13-sound's review M2) sounds wherever there is a height band or a
// gate; the glossary names every sound, but it is lesson 1 of the full path only, so the fast path must name it on its
// own. Held here by flying each lesson of the fast path with the truth bot, the planner given every frame with the
// lesson's layers, and asking of every watched sound it heard: did this lesson's intro, or an earlier one, name it?
import { describe, expect, it } from 'vitest';
import type { CueId, LessonDef } from '../src/contract';
import { CuePlanner } from '../src/cues';
import { getLesson, lessonPaths } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { getBuiltinTheme } from '../src/theme';
import { ScriptedPilot } from './helpers/pilot';
import { playLesson } from './helpers/truth';

/** The sounds whose naming is held here. */
const WATCHED: readonly CueId[] = ['height.target'];

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

describe('a sound heard while flying is named where the pilot first hears it (review M2 of the merge)', () => {
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
        // the test sees each sound where it first sounds: the target note in hover-height, the fast path's first flight
        expect(where).toEqual({ 'height.target': 'hover-height' });
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
});
