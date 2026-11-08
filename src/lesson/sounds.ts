// The sounds a lesson plays on its own (not the flight's): the named sounds of an intro line, the
// glossary's previews, the narrated scenes and the game's scenes of module 0. Shared by the runner
// (what to play, how long) and the validator (whether the lesson's layers let it be heard).
//
// M41-5: every sound a step names plays REPEAT_PLAYS times, REPEAT_GAP_S apart, with no speech over it
// (the runner waits until the host reports its speech queue empty). How each play sounds is the cue
// planner's (src/cues): the runner sends `repeat-cue` events with the cue id and the play's length.
import type { CueId, LessonDef, LessonLayers, Vec3 } from '../contract';

/** A named sound plays this many times. */
export const REPEAT_PLAYS = 3;
/** Silence between two plays of a sound, and after the last one before the step goes on, s. */
export const REPEAT_GAP_S = 1;
/** One play of a continuous sound (a hazard coming closer, the hum, the height tone, a shape trace), s. */
export const REPEAT_PLAY_S = 2.5;
/** One play of a one-off sound (a ping, a note, a chime, the fanfare), s. */
export const ONE_OFF_PLAY_S = 1.2;
/** A narrated scene of module 0 lasts this long, s; a scene of the game a little less. */
export const NARRATED_SCENE_S = 4;
export const GAME_SCENE_S = 3.5;

/** The cues that are one short sound, not a sound that goes on (src/cues/planner.ts plays them as one-off notes). */
export const ONE_OFF_CUES: readonly CueId[] = ['safety.touch', 'safety.reset', 'target.note', 'target.lap', 'target.checkpoint', 'target.fanfare'];

/** How long one play of `cue` lasts, s. */
export function playS(cue: CueId): number {
    return ONE_OFF_CUES.includes(cue) ? ONE_OFF_PLAY_S : REPEAT_PLAY_S;
}

/** Where each wall-like cue comes from in the narrated scenes of ears-walls (spec: front, left, right, above, below). */
export const APPROACHES: Readonly<Record<string, readonly { readonly dir: Vec3; readonly sector: string }[]>> = {
    'safety.wall': [
        { dir: [0, 0, -1], sector: 'front' },
        { dir: [-1, 0, 0], sector: 'left' },
        { dir: [1, 0, 0], sector: 'right' }
    ],
    'safety.ceiling': [{ dir: [0, 1, 0], sector: 'up' }],
    'safety.floor': [{ dir: [0, -1, 0], sector: 'down' }],
    'safety.obstacle': [{ dir: [Math.SQRT1_2, 0, -Math.SQRT1_2], sector: 'front-right' }]
};

export const SHAPE_ORDER: readonly CueId[] = ['shape.ring', 'shape.square', 'shape.cube', 'shape.pillar'];

/** The glossary names sounds of every kind; the narrated lessons only walls and shapes. */
export function isGlossary(cues: readonly CueId[]): boolean {
    return !cues.every((c) => c in APPROACHES || SHAPE_ORDER.includes(c));
}

/**
 * The cues a lesson of module 0 shows as scenes (the virtual craft moving toward the source, heard
 * through the lesson's own layers, unlike a preview, which sounds whatever layers are on).
 */
export function sceneCues(lesson: Pick<LessonDef, 'world' | 'goals'>): CueId[] {
    if (lesson.world.kind !== 'none') return [];
    const names = lesson.goals.find((g) => g.kind === 'name-cues');
    if (names === undefined || names.kind !== 'name-cues') return [];
    if (names.trials > 0) return [...names.cues.slice(0, 9)];
    return isGlossary(names.cues) ? [] : [...names.cues];
}

/** Why a scene of `cue` would not be heard with these layers, or null when it is: the layer that plays it must be on. */
export function sceneSilentReason(cue: CueId, layers: LessonLayers): string | null {
    const [layer] = cue.split('.') as [string];
    // a wall, the floor, the ceiling or an obstacle are hazard voices of the safety layer (a pillar scene is traced by the shape layer)
    if (layer === 'safety') {
        if (!layers.on.includes('safety')) return `the scene of ${cue} needs the 'safety' layer on`;
        if (layers.hazardVoices < 1) return `the scene of ${cue} needs at least one hazard voice`;
        return null;
    }
    if (layer === 'target' || layer === 'shape') return layers.on.includes(layer) ? null : `the scene of ${cue} needs the '${layer}' layer on`;
    return `a scene of ${cue} is not something the runner can show`;
}
