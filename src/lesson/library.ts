// The lessons that ship: plain JSON files in lessons/, loaded through the same validator as any
// lesson a teacher writes, so a broken shipped file fails loudly. Every lesson can be opened
// directly (?sonic=<id>); the full and the fast path only recommend an order (spec section 3).
import type { LessonDef } from '../contract';
import corridor from '../../lessons/corridor.json';
import earsGame from '../../lessons/ears-game.json';
import earsGlossary from '../../lessons/ears-glossary.json';
import earsHeadphones from '../../lessons/ears-headphones.json';
import earsShapes from '../../lessons/ears-shapes.json';
import earsWalls from '../../lessons/ears-walls.json';
import freeGarden from '../../lessons/free-garden.json';
import hoverHeight from '../../lessons/hover-height.json';
import hoverTurn from '../../lessons/hover-turn.json';
import moveSpeed from '../../lessons/move-speed.json';
import moveStop from '../../lessons/move-stop.json';
import paths from '../../lessons/paths.json';
import ringsCourse from '../../lessons/rings-course.json';
import ringsFirst from '../../lessons/rings-first.json';
import ringsLine from '../../lessons/rings-line.json';
import ringsSmall from '../../lessons/rings-small.json';
import shapesCube from '../../lessons/shapes-cube.json';
import shapesSeries from '../../lessons/shapes-series.json';
import shapesSquare from '../../lessons/shapes-square.json';
import wallsHall from '../../lessons/walls-hall.json';
import wallsPillar from '../../lessons/walls-pillar.json';
import wallsRow from '../../lessons/walls-row.json';
import { formatIssues } from '../util/check';
import { validateLesson, validatePaths, type LessonPaths } from './validate';

const SOURCES: Readonly<Record<string, unknown>> = {
    'ears-headphones': earsHeadphones,
    'ears-glossary': earsGlossary,
    'ears-walls': earsWalls,
    'ears-shapes': earsShapes,
    'ears-game': earsGame,
    'hover-height': hoverHeight,
    'hover-turn': hoverTurn,
    'move-speed': moveSpeed,
    'move-stop': moveStop,
    'walls-hall': wallsHall,
    'walls-pillar': wallsPillar,
    'walls-row': wallsRow,
    corridor,
    'rings-first': ringsFirst,
    'rings-line': ringsLine,
    'rings-small': ringsSmall,
    'rings-course': ringsCourse,
    'shapes-square': shapesSquare,
    'shapes-series': shapesSeries,
    'shapes-cube': shapesCube,
    'free-garden': freeGarden
};

const cache = new Map<string, LessonDef>();
let pathsCache: LessonPaths | null = null;

/** The ids of the shipped lessons. */
export const SHIPPED_LESSON_IDS: readonly string[] = Object.keys(SOURCES);

export function isShippedLesson(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(SOURCES, id);
}

/** A shipped lesson, validated on first use; throws for an unknown id or a broken file. */
export function getLesson(id: string): LessonDef {
    let lesson = cache.get(id);
    if (lesson === undefined) {
        if (!isShippedLesson(id)) throw new Error(`no lesson '${id}'`);
        const result = validateLesson(SOURCES[id]);
        if (!result.ok) throw new Error(`shipped lesson '${id}' is invalid: ${formatIssues(result.issues)}`);
        if (result.value.id !== id) throw new Error(`lessons/${id}.json holds the lesson '${result.value.id}'`);
        lesson = result.value;
        cache.set(id, lesson);
    }
    return lesson;
}

/** lessons/paths.json, validated. */
export function lessonPaths(): LessonPaths {
    if (pathsCache === null) {
        const result = validatePaths(paths);
        if (!result.ok) throw new Error(`lessons/paths.json is invalid: ${formatIssues(result.issues)}`);
        pathsCache = result.value;
    }
    return pathsCache;
}

/** The lessons of a path, in order. */
export function lessonsOnPath(path: 'full' | 'fast'): LessonDef[] {
    return lessonPaths()[path].map((id) => getLesson(id));
}

/** The lesson after `id` on a path, or null at its end (or when `id` is not on it). */
export function nextLesson(id: string, path: 'full' | 'fast'): LessonDef | null {
    const list = lessonPaths()[path];
    const i = list.indexOf(id);
    const next = i < 0 ? undefined : list[i + 1];
    return next === undefined ? null : getLesson(next);
}

/**
 * Where a runner's 'go' action leads: the lesson after (or before) `id` on the pilot's path, or on the
 * full ladder when `id` is not on that path; null at either end (the host shows the start screen).
 */
export function lessonAfter(id: string, path: 'full' | 'fast'): LessonDef | null {
    return lessonPaths()[path].includes(id) ? nextLesson(id, path) : nextLesson(id, 'full');
}

export function lessonBefore(id: string, path: 'full' | 'fast'): LessonDef | null {
    const list = lessonPaths()[lessonPaths()[path].includes(id) ? path : 'full'];
    const i = list.indexOf(id);
    const before = i <= 0 ? undefined : list[i - 1];
    return before === undefined ? null : getLesson(before);
}
