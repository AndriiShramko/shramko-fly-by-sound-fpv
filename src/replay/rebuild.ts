// Rebuilds what a session was flown in from its manifest: the lesson, the world, the theme, the
// pilot's settings. An analytic lesson world is made again from the lesson's spec (the same spec
// gives the same geometry and the same id); a scan world is the simulator's (rays against its voxel
// walls) and has to be handed in. Where this build differs from the recording's (another version of
// the lesson, the theme or the world generator) the setup says so in `notes` and is not `exact`.
import type { LessonDef, Locale, Pose, SessionManifest, SonicObject, SonicPrefs, SonicWorld, ThemeDef } from '../contract';
import { getLesson } from '../lesson/library';
import { resolveTheme } from '../theme/builtin';
import { createAnalyticWorld } from '../world/analytic-world';
import { WorldSpecError } from '../world/generators';

/** Why a session cannot be replayed at all. */
export class ReplayError extends Error {
    readonly code: 'unknown-lesson' | 'world' | 'scan-world-needed' | 'frames';
    constructor(code: ReplayError['code'], message: string) {
        super(message);
        this.name = 'ReplayError';
        this.code = code;
    }
}

export interface ReplayNote {
    /** stable name of what differs */
    readonly code: 'lesson-version' | 'theme-version' | 'world-id' | 'no-world' | 'no-speech-end-markers' | 'no-lesson-events' | 'progress' | 'unknown-theme' | 'other-lesson-events';
    readonly message: string;
}

export interface RebuildOptions {
    /** lessons to use instead of the shipped ones, by id (an older version kept elsewhere) */
    readonly lessons?: Readonly<Record<string, LessonDef>>;
    /** custom themes by id (one exported from the Sound Lab) */
    readonly themes?: Readonly<Record<string, ThemeDef>>;
    /**
     * The world of a scan scene, made by the simulator (rays against its walls). `null` says the
     * replay runs without one: no hazard cues, and touches are taken for walls. Required for a scan.
     */
    readonly world?: SonicWorld | null;
    /** a scan lesson's gates in the flown world (trackToObjects) */
    readonly objects?: readonly SonicObject[];
    /** a scan lesson's start (the track's start or the scene's spawn) */
    readonly start?: Pose;
    /** world y of the floor (default 0, as in the analytic worlds) */
    readonly floorY?: number;
}

export interface ReplaySetup {
    readonly manifest: SessionManifest;
    readonly lesson: LessonDef | null;
    readonly world: SonicWorld | null;
    readonly theme: ThemeDef;
    readonly prefs: SonicPrefs;
    readonly locale: Locale;
    readonly floorY: number;
    readonly objects: readonly SonicObject[] | undefined;
    readonly start: Pose | undefined;
    /** false when something differs from what the session was recorded with */
    readonly exact: boolean;
    readonly notes: readonly ReplayNote[];
}

export function rebuildSession(manifest: SessionManifest, options: RebuildOptions = {}): ReplaySetup {
    const notes: ReplayNote[] = [];
    let lesson: LessonDef | null = null;
    if (manifest.lesson !== null) {
        const id = manifest.lesson.id;
        const own = options.lessons?.[id];
        if (own !== undefined) lesson = own;
        else {
            try {
                lesson = getLesson(id);
            } catch {
                throw new ReplayError('unknown-lesson', `this build has no lesson '${id}'`);
            }
        }
        if (lesson.version !== manifest.lesson.version) notes.push({ code: 'lesson-version', message: `lesson ${id} is version ${lesson.version} here, the session was flown with ${manifest.lesson.version}` });
    }

    let world: SonicWorld | null = null;
    const ref = lesson === null ? null : lesson.world;
    if (ref !== null && ref.kind === 'analytic') {
        try {
            const made = createAnalyticWorld(ref.spec);
            world = made;
            if (made.id !== manifest.scene.id) notes.push({ code: 'world-id', message: `the world is ${made.id} here, the session was flown in ${manifest.scene.id}` });
        } catch (e) {
            if (e instanceof WorldSpecError) throw new ReplayError('world', `the lesson's world cannot be built: ${e.message}`);
            throw e;
        }
    } else if (ref !== null && ref.kind === 'none') {
        world = null;
    } else {
        // a scan lesson, or a session with no lesson: the world is the simulator's
        const needsOne = ref !== null ? ref.kind === 'scan' : manifest.scene.kind !== 'none';
        if (needsOne && options.world === undefined) throw new ReplayError('scan-world-needed', `scene ${manifest.scene.id} is not an analytic lesson world: pass the simulator's world (or null to replay without one)`);
        world = options.world ?? null;
        if (needsOne && world === null) notes.push({ code: 'no-world', message: 'replayed without a world: no hazard cues, touches are taken for walls' });
    }

    const theme = resolveTheme(manifest.theme.id, options.themes ?? {});
    if (theme.id !== manifest.theme.id) notes.push({ code: 'unknown-theme', message: `theme ${manifest.theme.id} is unknown here, ${theme.id} stands in` });
    else if (theme.version !== manifest.theme.version) notes.push({ code: 'theme-version', message: `theme ${theme.id} is version ${theme.version} here, the session was flown with ${manifest.theme.version}` });

    return {
        manifest,
        lesson,
        world,
        theme,
        prefs: manifest.settings,
        locale: manifest.device.locale,
        floorY: options.floorY ?? 0,
        objects: options.objects,
        start: options.start,
        exact: notes.length === 0,
        notes
    };
}
