// Review R2: the runner and the cue planner must agree how long a play of a named sound lasts. The runner
// (M41-5) sends a 'repeat-cue' per play and the next one REPEAT_GAP_S after this one's `durS` has run out; the
// schedule check (test/lesson-schedule.test.ts) models a play as `durS`, so it stays green whatever the planner
// does. This check feeds every 'repeat-cue' the runner sends to the real CuePlanner at the time it was sent and
// reads, frame by frame, whether the planner sounds that cue: a continuous cue's preview (previewsAt) or a one-off
// cue's notes (its id among the frame's cues). A continuous play must sound through its whole slot and the cue be
// silent in the gap before the next play; a one-off play sounds at once and is over within its slot.
// Control: a planner that plays every repeat-cue for 0.9 s whatever `durS` says (lane s13-sound's planner before
// its review fix B2: REPEAT_CUE_S) fails it, with 2.6 s of silence between plays. The planner now honours `durS`
// (REPEAT_PLAY_DEFAULT_S, 2.5 s, only when it is absent). That default is the runner's continuous play, so the
// main check alone would not notice a planner that ignored `durS`: with `durS` ignored on purpose (merge
// s13-merge) the control fails (the 0.9 s plays it asks for are no longer short), and so does test/events.test.ts
// (a fanfare given a 0.5 s play is not cut).
// What this cannot show: how the plays sound at the ear (lane s13-sound's rig renders the audio) or how they feel.
import { describe, expect, it } from 'vitest';
import type { CueEvent, FlightSample, LessonDef } from '../src/contract';
import { CuePlanner, REPEAT_PLAY_RANGE_S } from '../src/cues';
import { CUE_IDS } from '../src/i18n';
import { createLessonRunner, getLesson, ONE_OFF_CUES, ONE_OFF_PLAY_S, REPEAT_GAP_S, REPEAT_PLAYS, SHIPPED_LESSON_IDS } from '../src/lesson';
import { defaultPrefs } from '../src/prefs';
import { BUILTIN_THEME_IDS, getBuiltinTheme, type BuiltinThemeId } from '../src/theme';

const FRAME_MS = 20;

interface Rendered {
    readonly cue: string;
    readonly index: number;
    readonly of: number;
    /** the slot the runner gave the play, ms */
    readonly start: number;
    readonly slotEnd: number;
    /** frames of the slot in which the planner sounded the cue, and all frames of the slot */
    heard: number;
    frames: number;
    /** the first and the last frame at which it sounded, ms (null: never) */
    first: number | null;
    last: number | null;
}

const rest = (lesson: LessonDef, t: number): FlightSample => ({ t, tick: t, pos: lesson.start.pos, vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false });

/**
 * Every play of a named sound in `id` (the ears lessons whole, a flying lesson's task), as the planner sounds it.
 * Lines are said at once, questions answered with 1; `planned` turns the runner's event into what the planner gets.
 */
function renderPlays(id: string, theme: BuiltinThemeId = 'soft', planned: (e: Extract<CueEvent, { kind: 'repeat-cue' }>) => CueEvent = (e) => e): Rendered[] {
    const lesson = getLesson(id);
    const run = createLessonRunner(lesson, { seed: 3 });
    const planner = new CuePlanner({ theme: getBuiltinTheme(theme), layers: lesson.layers });
    const plays: Rendered[] = [];
    run.begin(0);
    for (let t = 0; t < 1_200_000; t += FRAME_MS) {
        run.step(rest(lesson, t), null);
        for (let guard = 0; guard < 64; guard++) {
            const actions = run.takeActions();
            if (actions.length === 0) break;
            for (const a of actions) {
                if (a.kind === 'ask') run.answer(1, 'key', t);
                // the plays of the first attempt only (a failed headphone check begins its second at once)
                if (a.kind === 'cue' && a.event.kind === 'repeat-cue' && run.attempt <= 1) {
                    const e = a.event;
                    planner.cue(planned(e), t);
                    plays.push({ cue: e.cue, index: e.index ?? 0, of: e.of ?? 0, start: t, slotEnd: t + (e.durS ?? 0) * 1000, heard: 0, frames: 0, first: null, last: null });
                }
            }
            if (actions.some((a) => a.kind === 'say')) run.spoken(t);
        }
        const input = run.demoFrame(t) ?? { sample: rest(lesson, t), world: null, target: null, floorY: 0 };
        const ids = planner.plan(input).cues.map((c) => c.id);
        const p = plays.at(-1);
        if (p !== undefined) {
            const sounding = ONE_OFF_CUES.includes(p.cue) ? ids.includes(p.cue) : planner.previewsAt(t) > 0;
            if (t < p.slotEnd) {
                p.frames++;
                if (sounding) p.heard++;
            }
            if (sounding) {
                p.first ??= t;
                p.last = t;
            }
        }
        // one attempt of an ears lesson (a wrong answer may fail it and start another), the task of a flying one
        if (run.phase === 'passed' || run.attempt > 1 || (lesson.world.kind !== 'none' && run.phase === 'flying')) break;
    }
    return plays;
}

/** What a pilot would notice: a play cut short, a play that runs into the next one, a long silence between plays. */
function playIssues(plays: readonly Rendered[]): string[] {
    const out: string[] = [];
    plays.forEach((p, i) => {
        const next = plays[i + 1];
        const name = `${p.cue} play ${p.index} of ${p.of} at ${(p.start / 1000).toFixed(2)} s`;
        if (p.first === null || p.first - p.start > FRAME_MS) out.push(`${name}: does not sound at its start`);
        if (!ONE_OFF_CUES.includes(p.cue) && p.heard / Math.max(p.frames, 1) < 0.9) out.push(`${name}: sounds in ${Math.round((100 * p.heard) / Math.max(p.frames, 1))} % of its ${((p.slotEnd - p.start) / 1000).toFixed(1)} s`);
        if (p.last !== null && p.last >= p.slotEnd + FRAME_MS) out.push(`${name}: still sounds ${((p.last - p.slotEnd) / 1000).toFixed(2)} s after its slot`);
        // the next play of the same sound comes about a second after this one has stopped sounding
        if (next !== undefined && next.cue === p.cue && next.index === p.index + 1 && p.last !== null) {
            const silence = (next.start - p.last) / 1000;
            const most = ONE_OFF_CUES.includes(p.cue) ? 2 : REPEAT_GAP_S + 0.2;
            if (silence > most) out.push(`${name}: ${silence.toFixed(2)} s of silence before the next play`);
        }
    });
    return out;
}

describe('the planner sounds every play of a named sound for as long as the runner gives it (review R2)', () => {
    it('in every shipped lesson that names a sound, in every built-in theme: each play heard through its slot, about a second of silence between plays', () => {
        let total = 0;
        for (const theme of BUILTIN_THEME_IDS) {
            for (const id of SHIPPED_LESSON_IDS) {
                const plays = renderPlays(id, theme);
                total += plays.length;
                expect(plays.length % REPEAT_PLAYS, `${id}, ${theme}`).toBe(0);
                expect(playIssues(plays), `${id}, ${theme}`).toEqual([]);
            }
        }
        expect(total).toBeGreaterThan(180);
        // the glossary: every one of its 20 sounds, three plays each
        expect(renderPlays('ears-glossary')).toHaveLength(60);
    }, 120000);

    it('control: a planner that plays every repeat-cue for 0.9 s whatever durS says (REPEAT_CUE_S, lane s13-sound before its review fix B2) fails it', () => {
        const short = (e: Extract<CueEvent, { kind: 'repeat-cue' }>): CueEvent => ({ ...e, durS: 0.9 });
        const issues = playIssues(renderPlays('ears-glossary', 'soft', short));
        expect(issues.filter((x) => /sounds in \d+ %/.test(x)).length).toBeGreaterThanOrEqual(30);
        expect(issues.some((x) => /2\.[5-7]\d s of silence before the next play/.test(x))).toBe(true);
        expect(playIssues(renderPlays('hover-height', 'soft', short)).length).toBeGreaterThan(0);
    }, 120000);
});

describe('the one-off play table (ONE_OFF_PLAY_S) is the planner\'s, for every cue, named by a lesson or not', () => {
    it('every cue the planner plays as notes has a slot, never shorter than its notes and with its next play within 2 s of the last one, in every built-in theme, calm or not; a continuous cue has none', () => {
        const [, longest] = REPEAT_PLAY_RANGE_S;
        const issues: string[] = [];
        for (const cue of CUE_IDS) {
            for (const theme of BUILTIN_THEME_IDS) {
                for (const calm of [false, true]) {
                    const planner = new CuePlanner({ theme: getBuiltinTheme(theme), prefs: { ...defaultPrefs(), calm } });
                    // the longest play the planner makes: a one-off cue's notes are never cut, a continuous cue gives none
                    const notes = planner.cue({ kind: 'repeat-cue', cue, dir: null, index: 0, of: REPEAT_PLAYS, durS: longest }, 0);
                    const slot = ONE_OFF_PLAY_S[cue];
                    const where = `${cue}, ${theme}${calm ? ', calm' : ''}`;
                    if (notes.length === 0) {
                        if (slot !== undefined) issues.push(`${where}: a continuous cue in the one-off table`);
                        continue;
                    }
                    const end = Math.max(...notes.map((n) => n.atS + n.durS));
                    if (slot === undefined) issues.push(`${where}: notes end at ${end.toFixed(2)} s, no slot (a lesson naming it would give it ${REPEAT_PLAYS} plays of the continuous length)`);
                    else if (slot < end) issues.push(`${where}: notes end at ${end.toFixed(2)} s, the slot is ${slot} s (the play is cut)`);
                    else if (slot - end + REPEAT_GAP_S > 2) issues.push(`${where}: ${(slot - end + REPEAT_GAP_S).toFixed(2)} s of silence before the next play`);
                }
            }
        }
        expect(issues).toEqual([]);
        // s13-sound's one-off cues are in the table with the lengths of its figures (0.63, 0.54, 0.46, 0.96 s)
        for (const cue of ['safety.wrong-way', 'safety.wrong-side', 'target.praise', 'target.stage']) expect(ONE_OFF_CUES, cue).toContain(cue);
    });
});
