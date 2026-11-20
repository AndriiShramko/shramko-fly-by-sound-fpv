// Moments (train 4, lane tutor-moment; the pilot's feedback, point 2): a sound is taught at the action it belongs to.
// The flight freezes, the other sounds go quiet, the sound's `what` line is said, the sound plays alone (far, then near),
// the `do` line is said, the flight goes on and the pilot does the task. Until a sound is taught its cue is not audible.
// Pure: no DOM, no clock of its own (the runner hands it the time).
//
// Stage S1: the contract only. A lesson without moments behaves as before (lessonMoments is empty, nothing is gated).
import type { CueId, LessonDef, MomentDef } from '../contract';

/** The forms of one moment together: 2-3 s (decision 4). */
export const MOMENT_FORMS_MIN_S = 2;
export const MOMENT_FORMS_MAX_S = 3;

/** A lesson's moments, in order; none when the lesson has no `moments` (every lesson before train 4). */
export function lessonMoments(lesson: LessonDef): readonly MomentDef[] {
    return lesson.moments ?? [];
}

/**
 * What the engine may sound at the start of a lesson: null (all, as before) for a lesson without moments; else every
 * cue but the ones its moments still have to teach (a known cue is audible).
 */
export function startAudible(lesson: LessonDef, allCues: readonly CueId[], known: readonly CueId[] = []): readonly CueId[] | null {
    const moments = lessonMoments(lesson);
    if (moments.length === 0) return null;
    const taught = new Set(moments.map((m) => m.cue).filter((c) => !known.includes(c)));
    return allCues.filter((c) => !taught.has(c));
}
