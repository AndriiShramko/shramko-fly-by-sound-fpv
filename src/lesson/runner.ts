// The lesson runner (contract LessonRunner; spec section 3). Pure: no DOM and no clock of its own,
// time comes with the samples, so Node tests drive it with scripted flights and a replay
// re-derives the same events. Beside the contract it tells the host what to do through actions
// (say a line, play a cue, place the craft, ask a question, show a module-0 scene), which the host
// drains with takeActions() and carries out.
//
// The host loop:
//   const run = createLessonRunner(lesson, { locale, objects, start, path, returnTo });
//   run.begin(t)                                  // the task, then the first attempt
//   every frame: events = run.step(sample, world); actions = run.takeActions();
//                engine.update(run.demoFrame(t) ?? { sample, world, target: run.target(), floorY })
//   say actions: engine.say(line), then run.spoken(t) when the speech queue is empty
//   digits / voice: run.answer(value, via, t)    R: run.reset('checkpoint' | 'start', t)
//   N: run.next(t)   B: run.previous(t)   Z: run.repeat(t)   menu: run.nextLesson(t), run.previousLesson(t)
//   a 'go' action: the lesson G left first (returnTo), else the lesson after (or before) this one on the
//                  pilot's path (lessonAfter, lessonBefore), else the start screen
//   I: run.view() and run.statusLine()            (what the host draws and says: lesson k of n, step, attempt, count)
//   the flight pauses (the Escape menu, the simulator's pause): run.pause(t); it goes on: run.resume(t), then
//                  run.spoken(t) once the speech queue is empty (at once when it already is); see "Pause" below
//
// Steps. A lesson is a short list of steps the pilot can tell apart and move between. A flying lesson
// has two: 1 the task (its title and intro lines) and 2 flying (the attempts). A lesson without a
// world (module 0, the ears) has its intro as step 1, then one step per sound of the glossary, per
// narrated scene, per trial of the headphone check or per round of the game. N moves one step on and,
// from the last step (flying, or the last sound), to the next lesson, marking this one skipped unless
// it was passed; B moves one step back and, from step 1, to the previous lesson (B while flying drops
// the attempt, uncounted, for the task); Z gives the step again from its first line (while flying the
// task is said again and the attempt waits, its clock stopped, then goes on). A lesson opened with G from
// another one (RunnerOptions.returnTo, the glossary) is a detour: its ways out lead back there, and
// leaving it forward does not mark it skipped (review R3).
//
// Sounds and speech (M41-5, M41-9). A spoken step is over when the host reports its speech queue empty
// (spoken(t)), not when the runner thinks the lines should have been said: a voice slower than the
// runner's estimate made v0.12 play the sounds under the speech (docs/dev/status-v0.13-lessons.md F2). A sound a
// step names (in an intro line's `cues`, the glossary, the narrated scenes, the headphone trials, the
// game's rounds) waits for that silence and then plays REPEAT_PLAYS times, REPEAT_GAP_S apart, as
// 'repeat-cue' events (a scene: the scene shown that many times). A host that never reports the end of
// speech is waited for no longer than twice the runner's estimate and a second per line.
//
// An attempt of a lesson without a world is a script: narrated scenes, the headphone check, the
// glossary, the game "what is it, where is it, is it moving". An attempt of a flying lesson tracks its
// goals in order (goals.ts). An attempt counts when every goal is met with at most `pass.maxTouches`
// touches; `pass.required` counted attempts in total pass the lesson, and failures in between do not
// reset the count (lesson format 2, v0.13: the v0.12 rule of blocks in a row let a pilot fail for
// ever, docs/dev/status-v0.13-lessons.md F1). After every attempt that does not pass the lesson the pilot hears
// "Attempt k. Counted m of r."; after `pass.attempts` failures in a row he hears why and, in a blocking
// lesson, that N goes on to the next lesson; a lesson that does not block (the game, the shapes, free
// flight) moves on by itself then, so it never holds anyone back.
//
// Praise (M41-11). A counted attempt that does not yet pass the lesson is praised in a short line from a
// pool (never the same twice in a row), or "Better than last time!" when its score really improved (by at
// least BETTER_SHARE: the share in the height band, the miss of the gates' centres, the stop's distance, or
// else the attempt's time); with it the cue event 'praise'. The pass is the fanfare, the lesson's own pass
// line and "Lesson passed. Next, a bit harder: <the next lesson on the pilot's path>". A checkpoint that
// ends a stage gives the cue event 'stage' and "Stage k passed"; any other but the first chimes ('checkpoint'),
// but for the last one of a lesson that ends on 'track-end': the end of the track has the fanfare.
//
// Direction (M41-15). A lesson with a track (track.ts: the world's checkpoint list, the lesson's
// checkpoints, or a course's gates) knows which way is forward: flying against it faster than
// WRONG_WAY_MPS for more than WRONG_WAY_S gives the cue event 'wrong-way' and "You are flying back. Turn
// around.", at most once every WRONG_WAY_EVERY_S. While the goal is a course of gates, forward is the way to
// the gate that counts next, judged only in front of it further than its line-up distance (behind it or close to
// it the pilot may be flying round to its front: a ring missed beside it is flown back to). Lane s13-elev (M41-15):
// the line-up distance follows the leg to that gate, LINE_UP_M for a leg of LINE_UP_SPACING_M or more and in
// proportion below it, and flying back is flying against the leg (from the gate passed last, along the floor), so a
// pilot who turns back toward the gate he just passed is told within a few metres in the 5 to 7 m legs of the v0.13
// rooms, which the 8 m of v0.13 never did, and a pilot who moves aside to fly round a gate is not flying back. That
// rule holds on a leg only once the craft has flown along it (faster than WRONG_WAY_MPS, since the gate before was
// passed or the attempt began); before, v0.13's rule holds (further than LINE_UP_M in front of the gate, flying away
// from it), so the momentum carried out of a course that turns back after a gate (the Winter Garden's ring 4 to 5,
// 135 degrees) and a pilot backing away at the start are told only where v0.13 told them (review E1 and E3 of the
// lane). A course in any order has no legs: v0.13's rule, toward the gate whose hum sounds. A gate crossed from its
// back side gives 'wrong-side' and its line, and is not counted.
//
// Respawn (M41-20). A touch in a lesson that re-centres, or a short R, puts the craft RESPAWN_BEFORE_M
// before the furthest point of the track passed in this attempt (a lesson checkpoint, or a point of the
// world's checkpoint list), facing along the track (a checkpoint's own pose yaw, a world point's dir), and
// the attempt's flown path goes back to what it was there, so a stretch flown twice is not counted twice. A
// long R still goes back to the start; with no point passed yet a short R goes to the start of the attempt.
// When an attempt of such a lesson fails (its time ran out), the next one begins at that point too, not at
// the far start (review R9). A frame's touch is taken after the points the frame crossed: a 30 Hz replay sees
// a crossing and the next 60 Hz frame's touch in one frame, and puts the craft where the live run did (the
// v0.13 merge review's M1; a recorder keeps every sample with a touch, so the touch is replayed where it was).
//
// Pause (review R8). While the flight is paused (the lesson menu of M41-3 speaks through the same queue) the
// lesson waits: pause(t) stops it, and resume(t) moves every clock it keeps on by the pause (the step's start,
// its plays, a question's time to answer, the speech deadline, the attempt's time limit and its goals), so a
// pause never counts as time held in a band, never times a question out and never starts a sound or a line over
// the menu. A report of the queue ran empty while paused is the menu's, not the lesson's: it is not taken; the
// host reports spoken(t) after resume(t) when its queue is empty. Keys still work while paused.
//
// Never silence (M41-10, the runner's part). Between attempts target() keeps giving the first target of the
// next attempt (the gate, the zone, the sound to turn to), so the target layer goes on sounding while the
// attempt's lines are said and the pause runs; a step never waits in silence without a line said first.
import type { Checkpoint, CueEvent, CueId, FlightSample, Goal, IntroCue, LessonDef, LessonProgress, LessonRunner, Locale, MaterialClass, Pose, SessionEvent, SonicFrameInput, SonicObject, SonicWorld, SpeechLine, Vec3 } from '../contract';
import { DICTS } from '../i18n/dicts';
import { createTranslator, type Dicts, type Translator } from '../i18n/translator';
import { createRng } from '../util/rng';
import { distance as dist3, dot, normalize, sub, yawQuat } from '../util/vec';
import { createAnalyticWorld, makeSpec, type AnalyticWorldInfo } from '../world/analytic-world';
import { BODY_RADIUS_M, createTracker, toLocal, type GoalScore, type GoalTracker, type Outcome } from './goals';
import { getLesson, isShippedLesson, lessonAfter, lessonPaths } from './library';
import { APPROACHES, GAME_SCENE_S, isGlossary, NARRATED_SCENE_S, playS, REPEAT_GAP_S, REPEAT_PLAYS, SHAPE_ORDER } from './sounds';
import { lessonTrack, yawOf, type LessonTrack, type TrackPoint } from './track';
import { headingBasis, worldToListener } from '../sense/frame';

// ------------------------------------------------------------------ host interface

/** A question asked by digits (or the same number said aloud). */
export interface Question {
    /** the item id of the answer event */
    readonly id: string;
    readonly lines: readonly SpeechLine[];
    /** digits 1..options answer */
    readonly options: number;
    /** 0 skips the question */
    readonly skippable: boolean;
}

/** A module-0 scene: a sound shown by moving the virtual craft toward its source (or holding still). */
export interface DemoScene {
    readonly cue: CueId;
    /** where it comes from, listener frame */
    readonly dir: Vec3;
    readonly moving: boolean;
    readonly durS: number;
}

export type RunnerAction =
    | { readonly kind: 'say'; readonly line: SpeechLine; readonly interrupt: boolean }
    | { readonly kind: 'cue'; readonly event: CueEvent }
    /** move the craft (the respawn path): back to the start or to a checkpoint */
    | { readonly kind: 'place'; readonly pose: Pose; readonly to: 'start' | 'checkpoint' }
    /** digits are expected now (the host may show them; the question's lines come as 'say' actions) */
    | { readonly kind: 'ask'; readonly question: Question }
    /** module 0: while a scene is set, feed the engine with demoFrame(t) instead of the craft; `play`: which play of the scene (a named sound plays three times) */
    | { readonly kind: 'scene'; readonly scene: DemoScene | null; readonly play?: { readonly index: number; readonly of: number } }
    /**
     * the pilot leaves this lesson. 'next': the way back to the lesson left with G first (RunnerOptions.returnTo),
     * else the next lesson on the pilot's path (lessonAfter), else the start screen: the simulator host's advance().
     * 'previous': the way back first too, else the lesson before (lessonBefore), else the start screen. The runner is
     * done after it (a lesson event 'leave').
     */
    | { readonly kind: 'go'; readonly to: 'next' | 'previous' };

/** What a step of a lesson is (see "Steps" above). */
export type StepKind = 'task' | 'fly' | 'intro' | 'sound' | 'scene' | 'trial' | 'round';

/**
 * Where the pilot is in the lesson, for the I key and the host's progress panel ("Lesson 6 of 28, step
 * 2 of 2, attempt 4, counted 2 of 3"). Plain data, so a host can draw it and say it (statusLine).
 */
export interface LessonView {
    readonly lessonId: string;
    readonly title: SpeechLine;
    /** the lesson's place on the pilot's path (1-based) and the path's length; the full ladder's when the lesson is not on it */
    readonly lessonIndex: number;
    readonly lessonCount: number;
    readonly path: 'full' | 'fast';
    /** the step running (1-based), how many steps the lesson has, and what the step is */
    readonly step: number;
    readonly steps: number;
    readonly stepKind: StepKind;
    /** the goal being flown (1-based) and how many the lesson has; 0 outside an attempt or in a lesson without a world */
    readonly goal: number;
    readonly goals: number;
    /** attempts started in this sitting (0 before the first) */
    readonly attempt: number;
    /** counted attempts toward the pass, and how many pass the lesson */
    readonly counted: number;
    readonly required: number;
    /** failed attempts in a row now */
    readonly failsInARow: number;
    /** the pilot has been told in this sitting that N goes on to the next lesson */
    readonly offered: boolean;
    readonly touches: number;
    /** touches a counted attempt allows; null: any */
    readonly maxTouches: number | null;
    readonly phase: LessonRunner['phase'];
    readonly passed: boolean;
    /** the pilot went on without passing (here or in an earlier sitting) */
    readonly skipped: boolean;
    /** Z while flying: the task is being said again and the attempt waits */
    readonly listening: boolean;
    /** the flight is paused (pause(t)): the lesson waits */
    readonly paused: boolean;
    /** a sound the step is playing now (a named sound plays three times): its cue, which play and of how many; null otherwise */
    readonly playing: { readonly cue: CueId; readonly index: number; readonly of: number } | null;
}

export interface LessonSession extends LessonRunner {
    /** starts the lesson: the task, then the first attempt */
    begin(t: number): readonly SessionEvent[];
    /** what the host must do now; each action is handed out once */
    takeActions(): RunnerAction[];
    /** the host's speech queue ran empty at t (the runner otherwise estimates how long lines take) */
    spoken(t: number): readonly SessionEvent[];
    /** module 0: the frame the engine should hear at t while a scene runs, else null */
    demoFrame(t: number): SonicFrameInput | null;
    /** N: the next step; from the last step, the next lesson (a 'go' action; this one is marked skipped unless passed) */
    next(t: number): readonly SessionEvent[];
    /** B: the previous step; from step 1, the previous lesson (a 'go' action) */
    previous(t: number): readonly SessionEvent[];
    /** Z: the step again from its first line; while flying the task is said again and the attempt waits */
    repeat(t: number): readonly SessionEvent[];
    /** the next lesson at once (the lesson menu): this one marked skipped unless passed */
    nextLesson(t: number): readonly SessionEvent[];
    /** the previous lesson at once (the lesson menu) */
    previousLesson(t: number): readonly SessionEvent[];
    /** the flight paused (the lesson menu, the simulator's pause): the lesson waits, its clocks stop (review R8) */
    pause(t: number): readonly SessionEvent[];
    /** the flight goes on: every clock moves on by the pause; then report spoken(t) once the speech queue is empty */
    resume(t: number): readonly SessionEvent[];
    /** where the pilot is: lesson, step, attempt, count */
    view(): LessonView;
    /** the view as one line to say (I) */
    statusLine(): SpeechLine;
    /** attempts started so far (1 during the first) */
    readonly attempt: number;
    /** touches in the current attempt */
    readonly touches: number;
}

export interface RunnerOptions {
    /** language of the names put into narrated lines ("Coming: wall.") */
    readonly locale?: Locale;
    readonly dicts?: Dicts;
    /** progress saved earlier: counts and the best time go on from there */
    readonly progress?: LessonProgress | null;
    /** epoch ms of the session clock's t = 0, for LessonProgress.lastAt */
    readonly sessionStartMs?: number;
    /** a scan lesson's gates in the flown world (trackToObjects); default: the world's objects */
    readonly objects?: readonly SonicObject[];
    /** a scan lesson's start (the track's start or the scene spawn); default lesson.start */
    readonly start?: Pose;
    /** world y of the floor: the height goals' zero */
    readonly floorY?: number;
    /** dice of the game's rounds */
    readonly seed?: number;
    /** the pilot's path (SonicPrefs.path): where the lesson stands on it and what comes after; default 'full' */
    readonly path?: 'full' | 'fast';
    /** the pilot's speech rate (SonicPrefs.speechRate): how long a host that never reports the end of speech is waited for */
    readonly speechRate?: number;
    /** the names of the host's keys, as the lines say them ("Press N to go on"); default N, B, Z */
    readonly keys?: { readonly next?: string; readonly previous?: string; readonly repeat?: string };
    /**
     * The lesson the pilot left with G (the sound glossary opened from another lesson): this one is a detour. Its
     * 'go' actions lead back there (the host's way back, review R3), leaving it forward does not mark it skipped,
     * and its pass says "Back to <that lesson>" instead of the next lesson on the path. Null or absent: none.
     */
    readonly returnTo?: string | null;
    /**
     * @internal For the package's own negative controls only (review R15): each brings back a rule of v0.12 that a
     * check must catch. Not part of the host API; a host never sets it.
     */
    readonly testHooks?: RunnerTestHooks;
}

/** @internal For the package's own negative controls only (RunnerOptions.testHooks); not part of the host API. */
export interface RunnerTestHooks {
    /**
     * The block rule of v0.12 with the lesson's v0.12 numbers: `required` successes in a block of `attempts`, `blocks`
     * blocks in a row, a block that can no longer pass starts again from zero; no reason and no offer to go on.
     */
    readonly passRule?: V012PassRule;
    /**
     * 'v012': the timing of v0.12: a spoken step ends at the earlier of the host's report and the runner's estimate,
     * a sound or a scene starts at once and plays once (the cause of "press 1, press 2, but no sound").
     */
    readonly speechWait?: 'v012';
    /**
     * 'fixed': the line-up rule of v0.13, LINE_UP_M in front of the next gate whatever the leg to it (lane s13-elev's
     * control). 'no-progress': the lane's first rule (0dd3cd9), flying back judged against the leg from the pass of the
     * gate before, whether or not the craft has flown along the leg since (the control of its review E1 and E3).
     */
    readonly lineUp?: 'fixed' | 'no-progress';
}

/** @internal A lesson's pass rule as v0.12 shipped it (format 1), for RunnerTestHooks.passRule only. */
export interface V012PassRule {
    readonly attempts: number;
    readonly required: number;
    readonly blocks: number;
}

// ------------------------------------------------------------------ numbers

/** A question waits this long for an answer, then counts as skipped (never blocks), s. */
export const ASK_TIMEOUT_S = 20;
/**
 * While a question waits (after its lines), every ASK_REMIND_S the pilot hears the waiting sound and which keys answer it
 * (sonic-keys, the owner's complaint of 2026-11-10: 20 s of silence, then the check moved on without a word). Not in v0.12 timing.
 */
export const ASK_REMIND_S = 7;
/** Pause between attempts, s. */
export const BETWEEN_S = 1.5;
/** v0.12 (testHooks.speechWait only): a preview was given this long, s. */
export const PREVIEW_WAIT_S = 3.3;
/** Flying against the track faster than this, m/s, ... */
export const WRONG_WAY_MPS = 0.5;
/** ... for longer than this, s, is flying the wrong way; it is said at most once every WRONG_WAY_EVERY_S. */
export const WRONG_WAY_S = 1;
export const WRONG_WAY_EVERY_S = 5;
/**
 * In a course, this close in front of the gate that counts next a pilot may be turning to line up with it: flying
 * away from it there is not flying back, m (review R1; rings 14 m apart, a pilot back from beside one ends 5 m out).
 * Since lane s13-elev the most it is: a shorter leg has a shorter one (lineUpM).
 */
export const LINE_UP_M = 8;
/** The leg LINE_UP_M was set for, m: the line-up distance is LINE_UP_M times the leg over this, at most LINE_UP_M. */
export const LINE_UP_SPACING_M = 14;

/**
 * Lane s13-elev (M41-15): how close in front of the gate that counts next flying away from it is lining up, not
 * flying back, for a leg of `legM` from the gate before it (or the start): 8 m for 14 m and longer, in proportion
 * below (2.9 m for the 5 m legs of rings-small, 4 m for rings-course's 7 m). v0.13 took 8 m for every leg, and every
 * gap between two gates of the v0.13 rooms (5 to 7 m) lay inside it, so turning back there was never told.
 */
export function lineUpM(legM: number): number {
    return Number.isFinite(legM) && legM > 0 ? Math.min(LINE_UP_M, (LINE_UP_M * legM) / LINE_UP_SPACING_M) : LINE_UP_M;
}
/** A respawn puts the craft this far before the last point of the track it passed, m. */
export const RESPAWN_BEFORE_M = 1;
/** The craft further than this from the start when a course's first attempt begins goes back there first, m. */
export const START_SLACK_M = 1;
/** A point of the world's checkpoint list is passed by crossing its plane forward this close to it, m. */
export const PASS_POINT_M = 4;
/**
 * A point's plane counts as crossed from this far before it, m: a micrometre, so a craft that stops on the last point of
 * a track is not left a rounding error short of it (the truth bot stopped 1e-12 m short in tunnel-long, and a 'track-end'
 * attempt never ended). No pilot is that exact, so it changes nothing in flight.
 */
export const PASS_POINT_TOLERANCE_M = 1e-6;
/** A move this long from one frame to the next is a jump (a reset, a place), never flight, m. */
export const JUMP_M = 3;
/** A gate's back side is told at most this often, s (a craft that hovers on the plane would cross it to and fro). */
export const WRONG_SIDE_EVERY_S = 3;
/** The praise lines of a counted attempt (keys praise.1 .. praise.PRAISE_LINES). */
export const PRAISE_LINES = 8;
/** A score counts as better than the last counted attempt's when it improved by this share of it. */
export const BETTER_SHARE = 0.05;
/** Share of right answers that meets 'name-cues' (spec: names cues at 90 %). */
export const NAME_SHARE = 0.9;
/** Share of right answers that meets 'locate'. */
export const LOCATE_SHARE = 0.8;
/**
 * turn-to lessons start each attempt turned by these, degrees, so the sound comes from another side.
 * None of them may leave the craft facing the sound at the start, or that attempt is passed without a
 * touch: hover-turn has its ring 83 degrees to the left, so -90 faced it (6.8 degrees off) and -135 does not.
 */
export const TURN_OFFSETS = [0, 180, 90, -135] as const;

/** Where an intro line's cue comes from, listener frame (x right, y up, -z ahead). */
const SIDE_DIRS: Readonly<Record<IntroCue['from'], Vec3>> = { left: [-1, 0, 0], right: [1, 0, 0], front: [0, 0, -1], back: [0, 0, 1], up: [0, 1, 0], down: [0, -1, 0] };

const SIDES: readonly { readonly dir: Vec3; readonly sector: 'left' | 'right' | 'front' | 'back' }[] = [
    { dir: [-1, 0, 0], sector: 'left' },
    { dir: [1, 0, 0], sector: 'right' },
    { dir: [0, 0, -1], sector: 'front' },
    { dir: [0, 0, 1], sector: 'back' }
];

// ------------------------------------------------------------------ the script

type Step =
    /** `once`: said when its step begins, not when the repeat key plays the step again (the headphone check's intro) */
    | { readonly kind: 'say'; readonly lines: readonly SpeechLine[]; readonly interrupt?: boolean; readonly once?: boolean }
    | { readonly kind: 'cue'; readonly event: CueEvent; readonly waitS: number }
    /** a sound the step names: once the speech is over, `plays` plays REPEAT_GAP_S apart */
    | { readonly kind: 'sound'; readonly cue: CueId; readonly dir: Vec3 | null; readonly plays: number }
    | { readonly kind: 'scene'; readonly scene: DemoScene; readonly plays: number }
    /** `early`: a digit pressed while the sound step just before it plays answers it (the headphone check's trials) */
    | { readonly kind: 'ask'; readonly question: Question; readonly onAnswer: (value: number | null, t: number) => void; readonly early?: boolean }
    | { readonly kind: 'wait'; readonly s: number }
    | { readonly kind: 'do'; readonly run: (t: number) => void };

/** One step of the lesson as the pilot moves between them: what it is and what it plays. */
interface Block {
    readonly kind: StepKind;
    readonly steps: readonly Step[];
}

interface Running {
    readonly step: Step;
    /** when the step began (moved on by a pause) */
    t0: number;
    answered: boolean;
    /** say, ask: the batch of lines the step handed to the host's speech queue */
    batch: number;
    /** v0.12 timing: the host reported its queue empty while this step was current */
    spokenSeen: boolean;
    /** ask: when its lines had been said (its time to answer runs from here) */
    askSpokenAt: number | null;
    /** ask: how many times the waiting sound and the keys were said */
    reminded: number;
    /** sound, scene: when the plays began (after the speech), how many have begun, and the end of the one going on */
    playT0: number | null;
    played: number;
    playEnd: number;
}

type Phase = LessonRunner['phase'];

/** One answer of module 0, by question id: asked again (a step repeated), it replaces the earlier one. */
interface EarsAnswer {
    readonly kind: 'what' | 'where' | 'moving' | 'side' | 'front-back';
    readonly value: number | null;
    readonly right: boolean;
    /** the headphone check: the side the sound came from */
    readonly sector?: 'left' | 'right';
}

const speedOf = (s: FlightSample): number => Math.hypot(s.vel[0], s.vel[1], s.vel[2]);

class Runner implements LessonSession {
    readonly lesson: LessonDef;
    private phaseValue: Phase = 'intro';
    private readonly o: RunnerOptions;
    private readonly tr: Translator;
    private readonly script: Step[] = [];
    private current: Running | null = null;
    private actions: RunnerAction[] = [];
    private events: SessionEvent[] = [];
    private t = 0;
    private began = false;
    private prev: FlightSample | null = null;
    private worldRef: SonicWorld | null = null;
    // speech: batches of lines handed to the host, the last one it has said, and when the lines handed must be over at the latest
    private handed = 0;
    private spokenUpTo = 0;
    private speechDeadline = 0;
    // steps: the task or the intro first, then (module 0) one per sound, scene, trial or round
    private blocks: Block[] = [];
    private blockIndex = 0;
    // attempt
    private attemptNo = 0;
    private attemptT0 = 0;
    private touchCount = 0;
    private pathM = 0;
    private goalIndex = 0;
    private tracker: GoalTracker | null = null;
    private lastCheckpoint: Checkpoint | null = null;
    private reached = new Set<string>();
    private shapeOutcome: Outcome = null;
    /** set while the pilot's own key (N, an answer) is being handled: the first line said after it interrupts the speech in progress */
    private interruptNext = false;
    private earsAnswers = new Map<string, EarsAnswer>();
    /** the headphone check after a failed attempt: the sides it asks again (the trials answered wrong or not at all), no intro */
    private earsRetry: ('left' | 'right')[] | null = null;
    /** the scores of the goals met in this attempt, and the score of the last counted attempt of this sitting */
    private goalScores: GoalScore[] = [];
    private lastScore: GoalScore | null = null;
    private lastPraise = -1;
    // direction: the track (built once the world is known), since when the craft flies against it, the last warnings
    private trackValue: LessonTrack | null | undefined = undefined;
    private backSince: number | null = null;
    private lastWrongWay = -Infinity;
    private lastWrongSide = -Infinity;
    // a course's leg (lane s13-elev, review E1, E3, E8): the gate passed last in this attempt (where the leg to the next
    // one begins; null: the start), and whether the craft has flown along that leg since it began (or since it was placed)
    private lastGate: SonicObject | null = null;
    private legFlown = false;
    // respawn: the furthest point of the track passed in this attempt (its index on the track) and the path flown there
    private passedPoint: { readonly point: TrackPoint; readonly index: number; readonly pathM: number; readonly checkpoint: Checkpoint | null } | null = null;
    // progress
    /** attempts and counted attempts of this lesson version, earlier sessions included */
    private attemptsDone: number;
    private successes: number;
    /** counted attempts toward the pass: this sitting's, plus an unfinished earlier sitting's of the same version */
    private counted: number;
    /** failed attempts in a row */
    private failRun = 0;
    /** the go-on offer was made in this sitting */
    private offered = false;
    /** the lesson was passed by its rule (not only ended, as a lesson that does not block may be) */
    private passedByRule = false;
    private passedValue: boolean;
    private skippedValue: boolean;
    private bestTimeMs: number | null;
    private lastAtT = 0;
    /** the pilot left the lesson (a 'go' action): nothing more happens */
    private left = false;
    /** the lesson ended by moving on after failures in a row (a lesson that does not block), not by a pass */
    private movedOn = false;
    /** the flight is paused since then (pause(t)), or null */
    private pausedAt: number | null = null;
    /** a failed attempt of a course that re-centres: the furthest point it passed, where the next attempt begins */
    private resumeFrom: Runner['passedPoint'] = null;
    /** Z while flying: the task is said again; the goals and the attempt's clock wait from listenT0 */
    private listening = false;
    private listenT0 = 0;
    /** how long the attempt waited for repeats, ms (the goals' and the time limit's clock leaves it out) */
    private pausedMs = 0;
    // the v0.12 block rule (testHooks.passRule only)
    private blockOk = 0;
    private blockDone = 0;
    private consecutive = 0;
    private blocksPlayed = 0;
    // scenes
    private scene: { readonly scene: DemoScene; readonly t0: number } | null = null;
    private readonly sceneWorlds = new Map<string, AnalyticWorldInfo>();

    constructor(lesson: LessonDef, options: RunnerOptions) {
        this.lesson = lesson;
        this.o = options;
        this.tr = createTranslator(options.locale ?? 'en', options.dicts ?? DICTS);
        const p = options.progress ?? null;
        const same = p !== null && p.lessonId === lesson.id;
        // counts carry on within one version of the lesson only: another version has another rule
        const sameVersion = same && p.version === lesson.version;
        this.attemptsDone = sameVersion ? p.attempts : 0;
        this.successes = sameVersion ? p.successes : 0;
        this.passedValue = same ? p.passed : false;
        this.skippedValue = same && !p.passed && p.skipped === true;
        this.passedByRule = sameVersion && p.passed && p.blocksPassed > 0;
        // a lesson passed before is practised afresh; an unfinished one goes on from its count
        this.counted = sameVersion && !p.passed ? Math.min(p.successes, lesson.pass.required - 1) : 0;
        this.consecutive = sameVersion ? p.blocksPassed : 0;
        this.bestTimeMs = same ? p.bestTimeMs : null;
    }

    private get hooks(): RunnerTestHooks {
        return this.o.testHooks ?? {};
    }

    private key(which: 'next' | 'previous' | 'repeat'): string {
        return this.o.keys?.[which] ?? { next: 'N', previous: 'B', repeat: 'Z' }[which];
    }

    get phase(): Phase {
        return this.phaseValue;
    }

    get attempt(): number {
        return this.attemptNo;
    }

    get touches(): number {
        return this.touchCount;
    }

    private get ears(): boolean {
        return this.lesson.world.kind === 'none';
    }

    /** opened with G from another lesson, which the pilot goes back to (RunnerOptions.returnTo) */
    private get detour(): boolean {
        return (this.o.returnTo ?? null) !== null;
    }

    // -------------------------------------------------------------- plumbing

    private emit(e: SessionEvent): void {
        this.events.push(e);
    }

    private drain(): SessionEvent[] {
        const out = this.events;
        this.events = [];
        return out;
    }

    takeActions(): RunnerAction[] {
        const out = this.actions;
        this.actions = [];
        return out;
    }

    private lessonEvent(what: Extract<SessionEvent, { kind: 'lesson' }>['what'], t: number): void {
        this.emit({ t, kind: 'lesson', lessonId: this.lesson.id, version: this.lesson.version, what, attempt: this.attemptNo });
        this.lastAtT = t;
    }

    private objects(): readonly SonicObject[] {
        return this.o.objects ?? (this.worldRef === null ? [] : this.worldRef.objects());
    }

    private text(line: SpeechLine): string {
        return this.tr.text(line);
    }

    private sayS(lines: readonly SpeechLine[]): number {
        let s = 0;
        for (const l of lines) s += 0.7 + this.text(l).length * 0.065;
        return s;
    }

    // -------------------------------------------------------------- the script

    private push(...steps: Step[]): void {
        this.script.push(...steps);
    }

    /** Runs step `index` of the lesson's steps from its beginning (what was going on stops). */
    private startBlock(index: number, t: number, again = false): void {
        this.blockIndex = index;
        this.script.length = 0;
        this.stopCurrent();
        const block = this.blocks[index];
        if (block !== undefined) this.push(...(again ? block.steps.filter((s) => !(s.kind === 'say' && s.once === true)) : block.steps));
        this.advance(t);
    }

    /** The step going on is dropped: a scene stops; a question is left (no answer is recorded). */
    private stopCurrent(): void {
        this.current = null;
        if (this.scene !== null) {
            this.scene = null;
            this.actions.push({ kind: 'scene', scene: null });
        }
    }

    /** Runs the script as far as time and answers allow. */
    private advance(t: number): void {
        for (let guard = 0; guard < 1000 && !this.left; guard++) {
            if (this.current === null) {
                const step = this.script.shift();
                if (step === undefined) return;
                this.current = { step, t0: t, answered: false, batch: 0, spokenSeen: false, askSpokenAt: null, reminded: 0, playT0: null, played: 0, playEnd: 0 };
                this.startStep(this.current, t);
            }
            const c = this.current;
            if (!this.stepDone(c, t)) return;
            this.current = null;
            if (this.scene !== null) {
                this.scene = null;
                this.actions.push({ kind: 'scene', scene: null });
            }
            if (c.step.kind === 'ask' && !c.answered) {
                // timed out: a skip, never a block
                this.emit({ t, kind: 'answer', item: c.step.question.id, value: null, via: 'skip' });
                c.step.onAnswer(null, t);
                // the skip is said, before what follows (sonic-keys: never a silent skip)
                if (!this.v012) this.script.unshift({ kind: 'say', lines: [{ key: 'answer.timeout' }] });
            }
        }
    }

    private get v012(): boolean {
        return this.hooks.speechWait === 'v012';
    }

    /** How long the host may take to say a line before the runner stops waiting for its report, ms: twice the estimate and a second. */
    private fallbackMs(line: SpeechLine): number {
        const rate = Math.min(Math.max(this.o.speechRate ?? 1, 0.25), 4);
        return 2000 * ((0.7 + this.text(line).length * 0.065) / rate) + 1000;
    }

    /** Hands lines to the host's speech queue; the first one interrupts what is being said when the pilot's key asked for it. */
    private sayLines(lines: readonly SpeechLine[], interrupt: boolean, t: number): number {
        lines.forEach((line, i) => this.actions.push({ kind: 'say', line, interrupt: i === 0 && interrupt }));
        let ms = 0;
        for (const l of lines) ms += this.fallbackMs(l);
        this.speechDeadline = (interrupt ? t : Math.max(t, this.speechDeadline)) + ms;
        return ++this.handed;
    }

    /** Lines were handed that the host has not reported said (and the longest wait for them has not run out). */
    private speaking(t: number): boolean {
        return this.spokenUpTo < this.handed && t < this.speechDeadline;
    }

    private startStep(c: Running, t: number): void {
        const step = c.step;
        switch (step.kind) {
            case 'say':
                // a key the pilot just pressed cuts the speech still going with the first line of what follows
                c.batch = this.sayLines(step.lines, step.interrupt ?? this.interruptNext, t);
                this.interruptNext = false;
                break;
            case 'cue':
                this.actions.push({ kind: 'cue', event: step.event });
                break;
            case 'sound':
            case 'scene':
                // played in stepDone, once the speech is over (v0.12: at once)
                break;
            case 'ask':
                c.batch = this.sayLines(step.question.lines, this.interruptNext, t);
                this.interruptNext = false;
                this.actions.push({ kind: 'ask', question: step.question });
                break;
            case 'wait':
                break;
            case 'do':
                step.run(t);
                break;
        }
    }

    /** One play of a sound or a scene begins. */
    private play(c: Running, t: number): void {
        const step = c.step;
        c.played++;
        if (step.kind === 'sound') {
            const durS = playS(step.cue);
            if (this.v012) {
                // v0.12: one preview (the planner plays 3 s of it), the next step 3.3 s after it began
                c.playEnd = t + (PREVIEW_WAIT_S - 0.3) * 1000;
                this.actions.push({ kind: 'cue', event: { kind: 'preview', cue: step.cue, dir: step.dir } });
                return;
            }
            c.playEnd = t + durS * 1000;
            this.actions.push({ kind: 'cue', event: { kind: 'repeat-cue', cue: step.cue, dir: step.dir, index: c.played, of: step.plays, durS } });
        } else if (step.kind === 'scene') {
            c.playEnd = t + step.scene.durS * 1000;
            this.scene = { scene: step.scene, t0: t };
            this.actions.push({ kind: 'scene', scene: step.scene, play: { index: c.played, of: step.plays } });
        }
    }

    private stepDone(c: Running, t: number): boolean {
        const age = (t - c.t0) / 1000;
        switch (c.step.kind) {
            case 'say':
                if (this.v012) return c.spokenSeen || age >= this.sayS(c.step.lines);
                return this.spokenUpTo >= c.batch || t >= this.speechDeadline;
            case 'cue':
                return age >= c.step.waitS;
            case 'sound':
            case 'scene': {
                const plays = this.v012 ? 1 : c.step.plays;
                if (c.playT0 === null) {
                    if (!this.v012 && this.speaking(t)) return false;
                    c.playT0 = t;
                    this.play(c, t);
                }
                // a play ends, then the gap; the next play, or the step is over after the gap of the last one
                if (this.scene !== null && t >= c.playEnd) {
                    this.scene = null;
                    this.actions.push({ kind: 'scene', scene: null });
                }
                const gapMs = this.v012 ? (c.step.kind === 'sound' ? 300 : 0) : REPEAT_GAP_S * 1000;
                if (t < c.playEnd + gapMs) return false;
                if (c.played < plays) {
                    this.play(c, t);
                    return false;
                }
                return true;
            }
            case 'ask':
                if (c.answered) return true;
                if (this.v012) return age >= this.sayS(c.step.question.lines) + ASK_TIMEOUT_S;
                // the time to answer runs from the end of the question's lines
                if (c.askSpokenAt === null && (this.spokenUpTo >= c.batch || t >= this.speechDeadline)) c.askSpokenAt = t;
                if (c.askSpokenAt === null) return false;
                if (t - c.askSpokenAt >= ASK_TIMEOUT_S * 1000) return true;
                // the waiting sound and the keys, every ASK_REMIND_S while the time to answer runs (not over a line still said)
                if (t - c.askSpokenAt >= (c.reminded + 1) * ASK_REMIND_S * 1000 && !this.speaking(t)) {
                    c.reminded++;
                    this.actions.push({ kind: 'cue', event: { kind: 'answer', what: 'wait' } });
                    this.sayLines([{ key: 'answer.waiting', params: { max: c.step.question.options, repeat: this.key('repeat') } }], false, t);
                }
                return false;
            case 'wait':
                return age >= c.step.s;
            case 'do':
                return true;
        }
    }

    spoken(t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        // paused, the queue holds the lesson menu's lines: its running empty says nothing about the lesson's (review R8)
        if (this.pausedAt !== null) return this.drain();
        // every line handed so far has been said (the host's queue ran empty)
        this.spokenUpTo = this.handed;
        this.speechDeadline = t;
        if (this.current !== null) this.current.spokenSeen = true;
        this.advance(t);
        this.afterScript(t);
        return this.drain();
    }

    // -------------------------------------------------------------- life cycle

    begin(t: number): readonly SessionEvent[] {
        if (this.began) return [];
        this.began = true;
        this.t = t;
        this.lessonEvent('open', t);
        this.lessonEvent('intro', t);
        if (!this.ears) this.actions.push({ kind: 'place', pose: this.startPose(1), to: 'start' });
        this.blocks = [this.introBlock()];
        this.phaseValue = 'intro';
        this.startBlock(0, t);
        this.afterScript(t);
        return this.drain();
    }

    /** Step 1: the task of a flying lesson, or the intro of a lesson without a world: the lines, each named sound three times after its line. */
    private introBlock(): Block {
        const steps: Step[] = [];
        let lines: SpeechLine[] = [this.lesson.title];
        for (const l of this.lesson.intro) {
            lines.push(l.params === undefined ? { key: l.key } : { key: l.key, params: l.params });
            if (l.cues === undefined || l.cues.length === 0) continue;
            steps.push({ kind: 'say', lines });
            lines = [];
            // a cue the line places on a side plays from there (review R11: "a sound will come from one side"); else its own default
            for (const c of l.cues) steps.push(typeof c === 'string' ? { kind: 'sound', cue: c, dir: null, plays: REPEAT_PLAYS } : { kind: 'sound', cue: c.cue, dir: SIDE_DIRS[c.from], plays: REPEAT_PLAYS });
        }
        if (lines.length > 0) steps.push({ kind: 'say', lines });
        return { kind: this.ears ? 'intro' : 'task', steps };
    }

    private startPose(attempt: number): Pose {
        const base = this.o.start ?? this.lesson.start;
        if (!this.lesson.goals.some((g) => g.kind === 'turn-to')) return base;
        const off = TURN_OFFSETS[(attempt - 1) % TURN_OFFSETS.length] as number;
        return { pos: base.pos, yawDeg: ((((base.yawDeg + off) % 360) + 540) % 360) - 180 };
    }

    /** A lesson whose attempts begin where the previous one ended does not send the craft back. */
    private returnsToStart(): boolean {
        return this.lesson.goals.some((g) => g.kind !== 'hold-height' && g.kind !== 'approach-stop' && g.kind !== 'around');
    }

    private startAttempt(t: number, first: boolean): void {
        // a course that re-centres goes on from the last point the failed attempt passed (review R9, M41-20)
        const resume = first ? null : this.resumeFrom;
        this.resumeFrom = null;
        this.attemptNo++;
        this.attemptT0 = t;
        this.touchCount = 0;
        this.pathM = 0;
        this.goalIndex = 0;
        this.shapeOutcome = null;
        if (resume === null) {
            this.lastCheckpoint = null;
            this.passedPoint = null;
            this.reached.clear();
        } else this.passedPoint = resume;
        this.earsAnswers = new Map();
        this.goalScores = [];
        this.backSince = null;
        this.lastGate = null;
        this.legFlown = false;
        this.listening = false;
        this.pausedMs = 0;
        this.phaseValue = 'flying';
        // the first attempt of a course begins at its start too when the craft left it while the task was said: what the
        // attempt counts (the distance flown, the gates) is the course's, not what is left of it (a pilot who flew 170 m
        // of the corridor during its task could never meet its 240 m before the dead end, and every touch there sent him
        // back to cp-5 for ever: the simulator's corridor pilot, found after the fix of review R9)
        const left = first && this.prev !== null && dist3(this.prev.pos, this.startPose(1).pos) > START_SLACK_M;
        if ((!first || left) && !this.ears && this.returnsToStart()) {
            if (resume !== null) {
                // the path flown to that point counts again, so the course's distance goals stay where they were
                const back = this.respawn();
                this.actions.push({ kind: 'place', pose: back.pose, to: back.to });
                this.emit({ t, kind: 'reset', to: back.to, checkpointId: back.id });
                this.prev = null; // the jump is not flight
            } else {
                const pose = this.startPose(this.attemptNo);
                this.actions.push({ kind: 'place', pose, to: 'start' });
                this.emit({ t, kind: 'reset', to: 'start', checkpointId: null });
                // the jump is not flight: from past a gate back to the start is no crossing of it from its back side
                this.prev = null;
            }
        }
        this.lessonEvent('attempt-start', t);
        if (this.ears) {
            this.tracker = null;
            this.blocks = [this.introBlock(), ...this.earsBlocks()];
            this.startBlock(1, t);
        } else {
            this.script.length = 0;
            this.push({ kind: 'say', lines: [{ key: 'fly.go' }] });
            this.startGoal(t);
        }
    }

    private startGoal(t: number): void {
        const goal = this.lesson.goals[this.goalIndex] as Goal;
        this.tracker = createTracker(goal, {
            floorY: this.o.floorY ?? 0,
            objects: () => this.objects(),
            world: () => this.worldRef,
            attemptPathM: () => this.pathM,
            passedGate: (gate, index, of, missM, lapDone, at) => {
                // the leg to the next gate begins here; nothing of it is flown yet
                this.lastGate = gate;
                this.legFlown = false;
                this.emit({ t: at, kind: 'gate', gateId: gate.id, index, missM: Math.round(missM * 1000) / 1000 });
                this.actions.push({ kind: 'cue', event: { kind: 'gate', index, of } });
                if (lapDone) this.actions.push({ kind: 'cue', event: { kind: 'lap' } });
            },
            // a 'track-end' goal: the furthest point passed is the track's last (the world's list, else the lesson's checkpoints)
            trackEnded: () => {
                const track = this.track();
                const pp = this.passedPoint;
                return track !== null && track.source !== 'gates' && pp !== null && pp.index >= track.points.length - 1;
            },
            wrongSide: (gate, at) => {
                if (at - this.lastWrongSide < WRONG_SIDE_EVERY_S * 1000) return;
                this.lastWrongSide = at;
                this.actions.push({ kind: 'cue', event: { kind: 'wrong-side', dir: this.toListener(sub(gate.pos, this.prev?.pos ?? gate.pos)) } });
                this.actions.push({ kind: 'say', line: { key: 'fly.wrong-side' }, interrupt: false });
            }
        });
        if (goal.kind === 'name-shape') this.pushShapeQuestion(goal.objectId, t);
    }

    /**
     * The script has run dry: the task or the intro is over, a step of module 0 has played (the next one
     * begins, or the attempt is scored after the last), or the pause between attempts ended.
     */
    private afterScript(t: number): void {
        for (let guard = 0; guard < 64; guard++) {
            if (this.current !== null || this.script.length > 0 || !this.began || this.left) return;
            // after the task (also heard again by B): the craft goes back to the start for every attempt but the first
            if (this.phaseValue === 'intro') this.startAttempt(t, this.attemptNo === 0);
            else if (this.phaseValue === 'between') this.startAttempt(t, false);
            else if (this.phaseValue === 'flying' && this.listening) this.endListening(t);
            else if (this.phaseValue === 'flying' && this.ears) {
                if (this.blockIndex + 1 < this.blocks.length) this.startBlock(this.blockIndex + 1, t);
                else this.endEarsAttempt(t);
            } else return;
            this.advance(t);
        }
    }

    // -------------------------------------------------------------- frames

    step(sample: FlightSample, world: SonicWorld | null): readonly SessionEvent[] {
        const t = sample.t;
        this.t = t;
        this.worldRef = world;
        if (this.pausedAt !== null) return this.drain(); // a host steps no paused frame; one that does changes nothing
        const prev = this.prev;
        this.prev = sample;
        if (!this.began || this.left || this.phaseValue === 'passed') return this.drain();
        const jump = prev !== null && dist3(prev.pos, sample.pos) >= JUMP_M;
        if (prev !== null && !this.listening && !jump) this.pathM += dist3(prev.pos, sample.pos); // a longer jump is a reset, not flight
        this.advance(t);
        if (this.phaseValue === 'flying' && !this.ears && !this.listening) {
            // a place (an attempt begun at the start, or where the last one got to) is no flight: in advance() it set prev
            // aside, and a jump crosses no gate, point or checkpoint, in whichever frame a recording shows it (live the frame
            // after the place; in a replay, whose estimated speech can begin the attempt a frame or two before, a later one)
            const from = this.prev === null || jump ? sample : (prev ?? sample);
            this.fly(this.goalClock(sample), this.goalClock(from), t);
            // what an attempt that just ended says goes out with this frame
            this.advance(t);
        }
        this.afterScript(t);
        return this.drain();
    }

    private fly(s: FlightSample, prev: FlightSample, t: number): void {
        // what the frame crossed counts before its touch (review M1 of the merge): live, the craft may cross a point one
        // 60 Hz frame and touch the next; a 30 Hz replay sees both in one frame, and the respawn must go to the same point
        for (const cp of this.lesson.checkpoints) {
            if (this.reached.has(cp.id) || segmentDistance(prev.pos, s.pos, cp.at) > cp.radiusM) continue;
            this.reached.add(cp.id);
            this.lastCheckpoint = cp;
            this.emit({ t, kind: 'checkpoint', id: cp.id });
            this.passed(cp.id, cp);
            if (cp.stage !== undefined && !this.stagesFromWorld()) this.stagePassed(cp.stage);
            else if (this.lesson.checkpoints.indexOf(cp) > 0 && !this.endsTrack(cp)) this.actions.push({ kind: 'cue', event: { kind: 'checkpoint' } });
        }
        this.passWorldPoints(prev, s);
        if (s.touched) {
            this.touchCount++;
            this.emit({ t, kind: 'touch', material: this.touchMaterial(s.pos), speed: Math.round(speedOf(s) * 100) / 100, pos: s.pos });
            if (this.lesson.assists.onTouch === 'bump-recentre') {
                const back = this.respawn();
                this.actions.push({ kind: 'place', pose: back.pose, to: back.to });
                this.actions.push({ kind: 'cue', event: { kind: 'reset' } });
                this.emit({ t, kind: 'reset', to: back.to, checkpointId: back.id });
                this.prev = null; // the jump is not flight
                this.backSince = null;
                this.legFlown = false;
            }
        }
        this.checkDirection(s);
        this.evaluateGoals(s, prev, t);
    }

    /**
     * The last of the lesson's checkpoints in a lesson whose last goal is 'track-end': the end of the track, which the
     * fanfare (or a counted attempt's chime) tells a moment later, so it chimes no checkpoint of its own just before
     * (review m1 of the merge: in the corridor and every tunnel the chime came about half a second before the fanfare).
     */
    private endsTrack(cp: Checkpoint): boolean {
        return this.lesson.goals.at(-1)?.kind === 'track-end' && this.lesson.checkpoints.at(-1) === cp;
    }

    /** A point of the track was passed: the furthest one passed is where a respawn goes back to. */
    private passed(id: string, checkpoint: Checkpoint | null): void {
        const track = this.track();
        let index: number;
        let point: TrackPoint | undefined;
        if (checkpoint !== null) {
            // the world's own list, when there is one, is the finer track: the lesson's checkpoints do not move the respawn then
            if (track?.source === 'world') return;
            index = this.lesson.checkpoints.indexOf(checkpoint);
            const a = (checkpoint.pose.yawDeg * Math.PI) / 180;
            point = track?.source === 'checkpoints' ? track.points[index] : { id, pos: checkpoint.at, dir: [Math.sin(a), 0, -Math.cos(a)], pose: checkpoint.pose };
        } else {
            index = (track?.points ?? []).findIndex((p) => p.id === id);
            point = track?.points[index];
        }
        if (point === undefined || (this.passedPoint !== null && index <= this.passedPoint.index)) return;
        this.passedPoint = { point, index, pathM: this.pathM, checkpoint };
    }

    /**
     * Where a course's stages come from: the world's checkpoint list when it marks any, else the lesson's checkpoints;
     * never both, or a stage is said twice (review R6). A world list without stages (the corridor of version 1) leaves
     * them to the lesson's checkpoints.
     */
    private stagesFromWorld(): boolean {
        const track = this.track();
        return track !== null && track.source === 'world' && track.points.some((p) => p.stage !== undefined);
    }

    /** The world's checkpoint list: a point is passed by crossing its plane forward close to it (its stages are said). */
    private passWorldPoints(prev: FlightSample, s: FlightSample): void {
        const track = this.track();
        if (track === null || track.source !== 'world') return;
        const from = this.passedPoint === null ? 0 : this.passedPoint.index + 1;
        for (let i = from; i < track.points.length; i++) {
            const p = track.points[i] as TrackPoint;
            const before = dot(sub(prev.pos, p.pos), p.dir);
            const after = dot(sub(s.pos, p.pos), p.dir);
            if (!(before < -PASS_POINT_TOLERANCE_M && after >= -PASS_POINT_TOLERANCE_M) || dist3(s.pos, p.pos) > PASS_POINT_M) continue;
            this.passed(p.id, null);
            if (p.stage !== undefined) this.stagePassed(p.stage);
        }
    }

    /**
     * Where a touch that re-centres, or a short R, puts the craft: RESPAWN_BEFORE_M before the furthest point passed,
     * facing along the track, the path flown set back to what it was there; the attempt's start when none was passed.
     */
    private respawn(): { readonly pose: Pose; readonly to: 'start' | 'checkpoint'; readonly id: string | null } {
        const passed = this.passedPoint;
        if (passed === null) return { pose: this.startPose(Math.max(this.attemptNo, 1)), to: 'start', id: null };
        const { point, checkpoint } = passed;
        // a lesson checkpoint's own pose says how to face there (its height too); a world point its direction
        const yawDeg = checkpoint !== null ? checkpoint.pose.yawDeg : yawOf(point.dir);
        const at = checkpoint !== null ? checkpoint.pose.pos : point.pos;
        const a = (yawDeg * Math.PI) / 180;
        const before: Vec3 = [point.pos[0] - Math.sin(a) * RESPAWN_BEFORE_M, at[1], point.pos[2] + Math.cos(a) * RESPAWN_BEFORE_M];
        const w = this.worldRef as { sdf?: (x: number, y: number, z: number) => number } | null;
        const free = typeof w?.sdf !== 'function' || (w.sdf(before[0], before[1], before[2]) as number) > BODY_RADIUS_M + 0.2;
        this.pathM = Math.max(0, passed.pathM - RESPAWN_BEFORE_M);
        return { pose: { pos: free ? before : at, yawDeg }, to: 'checkpoint', id: checkpoint?.id ?? point.id };
    }

    /** The lesson's track, built the first time a frame brings the world. */
    private track(): LessonTrack | null {
        if (this.trackValue === undefined) this.trackValue = lessonTrack(this.lesson, this.worldRef, this.objects(), this.o.start ?? this.lesson.start);
        return this.trackValue;
    }

    /** A world direction in the craft's heading frame (the listener frame the cue events use), unit; null for none. */
    private toListener(w: Vec3): Vec3 | null {
        const p = this.prev;
        if (p === null || Math.hypot(w[0], w[1], w[2]) < 1e-6) return null;
        return normalize(worldToListener(headingBasis(p.yawDeg), w));
    }

    /** M41-15: flying against the way forward for more than a second, told at most once every few seconds. */
    private checkDirection(s: FlightSample): void {
        const way = this.wayForward(s);
        if (way === null || dot(s.vel, way.against) >= -WRONG_WAY_MPS) {
            this.backSince = null;
            return;
        }
        this.backSince ??= s.t;
        if (s.t - this.backSince < WRONG_WAY_S * 1000 || s.t - this.lastWrongWay < WRONG_WAY_EVERY_S * 1000) return;
        this.lastWrongWay = s.t;
        this.actions.push({ kind: 'cue', event: { kind: 'wrong-way', dir: this.toListener(way.dir) } });
        this.actions.push({ kind: 'say', line: { key: 'fly.wrong-way' }, interrupt: false });
    }

    /**
     * The way forward where the craft is (unit, world frame), or null where nothing says it. While the goal is a
     * course of gates it is the way to the gate that counts next, and only in front of that gate, further than its
     * line-up distance (lineUpM of the leg to it): behind it, beside it or close in front of it a pilot may be on his
     * way round to its front (review R1: a ring passed beside it is flown back to, its hum ahead). The leg's rule holds
     * once the craft has flown along the leg; before that, and in a course in any order, v0.13's rule (LINE_UP_M,
     * flying away from the gate). Elsewhere it is the way the track goes.
     */
    private wayForward(s: FlightSample): { readonly dir: Vec3; readonly against: Vec3 } | null {
        const goal = this.lesson.goals[this.goalIndex];
        if (goal !== undefined && (goal.kind === 'pass-gates' || goal.kind === 'timed-course')) {
            const gate = this.tracker?.target() ?? null;
            if (gate === null) return null;
            const to = sub(gate.pos, s.pos);
            const dir = normalize(to);
            const ahead = toLocal(gate, s.pos)[2] > 0;
            const away = Math.hypot(to[0], to[1], to[2]);
            // v0.13's rule: further than LINE_UP_M in front of the gate, flying back is flying away from it (the 'fixed'
            // control everywhere; a course in any order, whose next gate is wherever the pilot goes, has no legs)
            const v013 = (): { readonly dir: Vec3; readonly against: Vec3 } | null => (!ahead || away <= LINE_UP_M ? null : { dir, against: dir });
            const hook = this.o.testHooks?.lineUp;
            if (hook === 'fixed' || (goal.kind === 'pass-gates' && !goal.inOrder)) return v013();
            const leg = this.legTo(gate);
            if (leg.along !== null && dot(s.vel, leg.along) > WRONG_WAY_MPS) this.legFlown = true;
            // nothing of the leg flown yet: momentum out of a course that turns back, or backing away at the start
            if (!this.legFlown && hook !== 'no-progress') return v013();
            if (!ahead || away <= lineUpM(leg.metres)) return null;
            return { dir, against: leg.along ?? dir };
        }
        const along = this.track()?.dirAt(s.pos) ?? null;
        return along === null ? null : { dir: along, against: along };
    }

    /**
     * The leg to a gate of the course (lane s13-elev): from the gate passed last in this attempt (the gate before it,
     * or the course's last for the first gate of a later lap), else from the lesson's start; its length (m) and its way
     * along the floor (unit; null when the leg is all but vertical, or has no length: a course of one gate flown again).
     */
    private legTo(gate: SonicObject): { readonly metres: number; readonly along: Vec3 | null } {
        const from = this.lastGate !== null ? this.lastGate.pos : (this.o.start ?? this.lesson.start).pos;
        const flat: Vec3 = [gate.pos[0] - from[0], 0, gate.pos[2] - from[2]];
        return { metres: dist3(from, gate.pos), along: Math.hypot(flat[0], flat[2]) >= 0.5 ? normalize(flat) : null };
    }

    /** The current goal, and the next ones as each is met, in order; then the attempt's time limit. */
    private evaluateGoals(s: FlightSample, prev: FlightSample, t: number): void {
        for (let guard = 0; guard < 16 && this.phaseValue === 'flying' && this.tracker !== null; guard++) {
            const goal = this.lesson.goals[this.goalIndex] as Goal;
            const outcome: Outcome = goal.kind === 'name-shape' ? this.shapeOutcome : this.tracker.step(s, prev);
            if (outcome === null) break;
            this.emit({ t, kind: 'goal', index: this.goalIndex, what: outcome });
            if (outcome === 'missed') {
                this.endAttempt(false, t, this.whyMissed(false));
                return;
            }
            const score = this.tracker.score();
            if (score !== null) this.goalScores.push(score);
            this.goalIndex++;
            if (this.goalIndex >= this.lesson.goals.length) {
                this.endAttempt(true, t);
                return;
            }
            this.startGoal(t);
        }
        const limit = this.lesson.attemptLimitS;
        if (this.phaseValue === 'flying' && limit !== null && (t - this.pausedMs - this.attemptT0) / 1000 >= limit) {
            this.emit({ t, kind: 'goal', index: this.goalIndex, what: 'missed' });
            this.endAttempt(false, t, this.whyMissed(true));
        }
    }

    /** A checkpoint that ends a stage: the stage cue and "Stage k passed", said over the flight (it does not wait for other lines). */
    private stagePassed(stage: number): void {
        this.actions.push({ kind: 'cue', event: { kind: 'stage', stage } });
        this.actions.push({ kind: 'say', line: { key: 'fly.stage', params: { n: stage } }, interrupt: false });
    }

    /** A sample on the goals' clock: the time the attempt waited for a repeat (Z) is left out. */
    private goalClock(s: FlightSample): FlightSample {
        return this.pausedMs === 0 ? s : { ...s, t: s.t - this.pausedMs };
    }

    /** What went wrong in the attempt now ending: the time ran out, and what the current goal says (at most two short lines). */
    private whyMissed(outOfTime: boolean): SpeechLine[] {
        const goal = this.tracker === null ? null : this.tracker.reason();
        const out: SpeechLine[] = [];
        if (outOfTime) out.push({ key: 'reason.time' });
        if (goal !== null) out.push(goal);
        return out;
    }

    private touchMaterial(p: Vec3): MaterialClass {
        const w = this.worldRef;
        if (w === null) return 'wall';
        let best: { d: number; m: MaterialClass } | null = null;
        const dirs: Vec3[] = [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 0, 1],
            [0, 0, -1],
            [0, 1, 0],
            [0, -1, 0]
        ];
        for (const d of dirs) {
            const hit = w.castRay(p, d, 5);
            if (hit !== null && (best === null || hit.distance < best.d)) best = { d: hit.distance, m: hit.material };
        }
        return best === null ? 'wall' : best.m;
    }

    // -------------------------------------------------------------- attempts and the pass rule

    /**
     * An attempt ends. Format 2: it counts when every goal was met with at most `maxTouches` touches;
     * `required` counted attempts in total pass the lesson (failures in between do not reset the count).
     * The pilot hears "Attempt k. Counted m of r." (no line when the lesson is passed: the pass line instead).
     * After `attempts` failures in a row he hears why (`why`: the goal's reason) and, in a blocking
     * lesson, that N goes on to the next lesson; a lesson that does not block moves on by itself then.
     */
    private endAttempt(goalsMet: boolean, t: number, why: readonly SpeechLine[] = []): void {
        if (this.hooks.passRule !== undefined) {
            this.endAttemptV012(goalsMet, t, this.hooks.passRule);
            return;
        }
        const rule = this.lesson.pass;
        const touchesOk = rule.maxTouches === null || this.touchCount <= rule.maxTouches;
        const ok = goalsMet && touchesOk;
        this.attemptsDone++;
        if (ok) {
            this.successes++;
            this.counted++;
            this.failRun = 0;
            this.timedLine(t);
        } else {
            this.failRun++;
            // a course that re-centres on a touch (the corridor, the tunnels) does not throw the pilot back to its far start
            // when an attempt fails (its time ran out): the next one begins where this one got to (review R9, M41-20)
            if (this.lesson.assists.onTouch === 'bump-recentre') this.resumeFrom = this.passedPoint;
        }
        this.lessonEvent(ok ? 'attempt-pass' : 'attempt-fail', t);
        this.tracker = null;
        if (ok && this.counted >= rule.required) {
            this.pass(t);
            return;
        }
        const touches: SpeechLine = rule.maxTouches === 0 ? { key: 'reason.touches-none' } : { key: 'reason.touches', params: { n: this.touchCount, limit: rule.maxTouches ?? 0 } };
        const reasons: SpeechLine[] = ok ? [] : goalsMet ? [touches] : [...why];
        const progress: SpeechLine = { key: 'fly.progress', params: { n: this.attemptNo, counted: this.counted, required: rule.required } };
        const offerNow = !ok && this.failRun % rule.attempts === 0;
        if (offerNow && !rule.blocking) {
            this.moveOn(t, [progress, ...reasons]);
            return;
        }
        this.phaseValue = 'between';
        this.script.length = 0;
        if (ok) {
            this.actions.push({ kind: 'cue', event: { kind: 'praise' } });
            this.push({ kind: 'say', lines: [this.praise(t), progress] });
        } else if (offerNow) {
            this.offered = true;
            this.push({ kind: 'say', lines: [progress, ...reasons, { key: 'fly.offer-next', params: { key: this.key('next') } }] });
        } else {
            const hints = this.lesson.speech.hints;
            const hint = hints.length === 0 ? [] : [hints[(this.attemptsDone - 1) % hints.length] as SpeechLine];
            this.push({ kind: 'say', lines: [progress, this.lesson.speech.retry, ...hint] });
        }
        this.push({ kind: 'wait', s: BETWEEN_S });
    }

    /**
     * The praise of a counted attempt: "Better than last time!" when its score improved by BETTER_SHARE on the last
     * counted attempt of this sitting, else a line of the pool, never the one said last. A timed course says its time instead.
     */
    private praise(t: number): SpeechLine {
        const timed = this.lesson.goals.some((g) => g.kind === 'timed-course');
        const score: GoalScore = this.goalScores.at(-1) ?? { value: t - this.pausedMs - this.attemptT0, better: 'lower' };
        const last = this.lastScore;
        this.lastScore = score;
        if (!timed && last !== null && last.better === score.better) {
            const better = score.better === 'lower' ? score.value < last.value * (1 - BETTER_SHARE) : score.value > last.value * (1 + BETTER_SHARE);
            if (better) return { key: 'praise.better' };
        }
        // the pool, in an order of its own for each lesson and attempt, never the same line twice in a row
        let k = (this.attemptNo * 5 + this.counted * 3 + (this.o.seed ?? 0)) % PRAISE_LINES;
        if (k === this.lastPraise) k = (k + 1) % PRAISE_LINES;
        this.lastPraise = k;
        return { key: `praise.${k + 1}` };
    }

    /** What the pass says comes next: the lesson G left (a detour), the next lesson on the pilot's path, or that this was the last. */
    private nextLine(): SpeechLine {
        const back = this.o.returnTo ?? null;
        if (back !== null && isShippedLesson(back)) return { key: 'fly.back-to', params: { title: this.text(getLesson(back).title) } };
        const next = lessonAfter(this.lesson.id, this.o.path ?? 'full');
        return next === null ? { key: 'fly.last-lesson' } : { key: 'fly.lesson-passed', params: { title: this.text(next.title) } };
    }

    /** A timed course: the time of a counted attempt, and whether it is the best one. */
    private timedLine(t: number): void {
        if (!this.lesson.goals.some((g) => g.kind === 'timed-course')) return;
        const ms = Math.round(t - this.pausedMs - this.attemptT0);
        const better = this.bestTimeMs === null || ms < this.bestTimeMs;
        if (better) this.bestTimeMs = ms;
        this.actions.push({ kind: 'say', line: { key: better ? 'fly.best-time' : 'fly.time', params: { time: this.tr.duration(ms) } }, interrupt: false });
    }

    /** The lesson is passed by its rule: the fanfare and the pass line. */
    private pass(t: number): void {
        this.passedValue = true;
        this.passedByRule = true;
        this.skippedValue = false;
        this.phaseValue = 'passed';
        // the report counts a `passed` as a pass when the lesson event just before it says the rule was met
        this.lessonEvent('block-pass', t);
        this.lessonEvent('passed', t);
        this.script.length = 0;
        this.current = null;
        this.actions.push({ kind: 'cue', event: { kind: 'fanfare' } });
        this.actions.push({ kind: 'say', line: this.lesson.speech.pass, interrupt: false });
        this.actions.push({ kind: 'say', line: this.nextLine(), interrupt: false });
    }

    /**
     * A lesson that does not block ends after `attempts` failures in a row: it never holds anyone back. Its phase is
     * 'passed', so the host goes on as after a pass, but it is saved as skipped, not passed (review R7): the start
     * screen shows it as a lesson left without passing, like one left with N.
     */
    private moveOn(t: number, lines: readonly SpeechLine[]): void {
        if (!this.passedValue && !this.detour) this.skippedValue = true;
        this.movedOn = true;
        this.phaseValue = 'passed';
        this.lessonEvent('passed', t);
        this.script.length = 0;
        this.current = null;
        this.actions.push({ kind: 'cue', event: { kind: 'checkpoint' } });
        for (const line of [...lines, { key: 'fly.moving-on' }]) this.actions.push({ kind: 'say', line, interrupt: false });
    }

    /** The block rule of v0.12, kept only for the negative controls (testHooks.passRule). */
    private endAttemptV012(goalsMet: boolean, t: number, rule: V012PassRule): void {
        const touchesOk = this.lesson.pass.maxTouches === null || this.touchCount <= this.lesson.pass.maxTouches;
        const ok = goalsMet && touchesOk;
        this.attemptsDone++;
        this.blockDone++;
        if (ok) {
            this.successes++;
            this.blockOk++;
            this.timedLine(t);
        }
        this.lessonEvent(ok ? 'attempt-pass' : 'attempt-fail', t);
        this.tracker = null;
        const left = rule.attempts - this.blockDone;
        let blockOver = false;
        let blockPassed = false;
        if (this.blockOk >= rule.required) {
            blockOver = true;
            blockPassed = true;
        } else if (this.blockOk + left < rule.required) blockOver = true;
        let done = false;
        if (blockOver) {
            this.blocksPlayed++;
            this.blockOk = 0;
            this.blockDone = 0;
            if (blockPassed) {
                this.consecutive++;
                this.lessonEvent('block-pass', t);
            } else this.consecutive = 0;
            done = this.lesson.pass.blocking ? this.consecutive >= rule.blocks : this.blocksPlayed >= rule.blocks;
        }
        if (done) {
            this.passedValue = true;
            this.passedByRule = blockPassed;
            this.phaseValue = 'passed';
            this.lessonEvent('passed', t);
            this.script.length = 0;
            this.current = null;
            this.actions.push({ kind: 'cue', event: { kind: 'fanfare' } });
            this.actions.push({ kind: 'say', line: this.lesson.speech.pass, interrupt: false });
            return;
        }
        this.phaseValue = 'between';
        this.script.length = 0;
        if (ok) {
            if (!this.ears) this.actions.push({ kind: 'cue', event: { kind: 'checkpoint' } });
            if (blockPassed) this.push({ kind: 'say', lines: [{ key: 'fly.step-passed' }] });
        } else {
            const hints = this.lesson.speech.hints;
            const hint = hints.length === 0 ? [] : [hints[(this.attemptsDone - 1) % hints.length] as SpeechLine];
            this.push({ kind: 'say', lines: [this.lesson.speech.retry, ...hint] });
        }
        this.push({ kind: 'wait', s: BETWEEN_S });
    }

    // -------------------------------------------------------------- module 0

    private goalOf<K extends Goal['kind']>(kind: K): Extract<Goal, { kind: K }> | null {
        return (this.lesson.goals.find((g) => g.kind === kind) as Extract<Goal, { kind: K }> | undefined) ?? null;
    }

    /** The steps of an attempt of module 0 (after the intro): one per sound, scene, trial or round. */
    private earsBlocks(): Block[] {
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        if (names !== null && names.trials > 0) return this.gameBlocks(names, locate);
        if (names !== null) return this.presentationBlocks(names.cues);
        if (locate !== null) return this.headphoneBlocks(locate.trials);
        return [];
    }

    /** How many steps an attempt of module 0 has (known before the attempt is built). */
    private earsStepCount(): number {
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        if (names !== null && names.trials > 0) return Math.max(names.trials, locate?.trials ?? 0);
        if (names !== null) return isGlossary(names.cues) ? names.cues.length : names.cues.reduce((n, c) => n + (APPROACHES[c] ?? [null]).length, 0);
        return locate === null ? 0 : locate.trials;
    }

    private cueName(cue: CueId): string {
        return this.text({ key: `cue.${cue}.name` });
    }

    /** The glossary, or narrated scenes when every cue is a wall or a shape (ears-walls, ears-shapes). */
    private presentationBlocks(cues: readonly CueId[]): Block[] {
        if (isGlossary(cues)) {
            return cues.map((cue, i) => ({
                kind: 'sound' as const,
                steps: [
                    { kind: 'say', lines: [{ key: i === 0 ? 'glossary.intro' : 'glossary.next' }, { key: `cue.${cue}.name` }, { key: `cue.${cue}.glossary` }] },
                    { kind: 'sound', cue, dir: null, plays: REPEAT_PLAYS },
                    ...(i === cues.length - 1 ? [{ kind: 'say', lines: [{ key: 'glossary.done' }] } as Step] : [])
                ]
            }));
        }
        const out: Block[] = [];
        for (const cue of cues) {
            const ways = APPROACHES[cue] ?? [{ dir: [0, 0, -1] as Vec3, sector: 'front' }];
            for (const w of ways) {
                out.push({
                    kind: 'scene',
                    steps: [
                        { kind: 'say', lines: [{ key: 'narrate.coming', params: { name: this.cueName(cue) } }, { key: `dir.${w.sector}` }] },
                        { kind: 'scene', scene: { cue, dir: w.dir, moving: true, durS: NARRATED_SCENE_S }, plays: REPEAT_PLAYS }
                    ]
                });
            }
        }
        return out;
    }

    /**
     * The headphone check: a sound on the left, then on the right, in turn; answered by digits (1 left, 2 right, 3 not sure),
     * also while the sound plays. Only left and right (sonic-keys): telling front from behind with a generic HRTF is
     * unreliable (research 01: 10 to 50 % reversals), and the question about it was never graded. After a failed attempt
     * only the trials answered wrong or not at all are asked again, without the headphone intro.
     */
    private headphoneBlocks(trials: number): Block[] {
        const sides = this.earsRetry ?? Array.from({ length: trials }, (_, i) => (i % 2 === 0 ? 'left' : 'right') as 'left' | 'right');
        return sides.map((sector, i) => {
            const side = SIDES[sector === 'left' ? 0 : 1] as (typeof SIDES)[number];
            const correct = sector === 'left' ? 1 : 2;
            const id = `${this.lesson.id}:${this.attemptNo}:${i + 1}:side`;
            const steps: Step[] = [];
            // every trial begins with a line, so a key that moves here cuts what was being said (N, B, Z); the intro once, in the first attempt
            if (i === 0 && this.earsRetry === null) steps.push({ kind: 'say', lines: [{ key: 'headphones.intro' }, { key: 'headphones.wired' }, { key: 'headphones.os-spatial' }], once: true });
            steps.push({ kind: 'say', lines: [{ key: 'headphones.trial', params: { n: i + 1, total: sides.length } }] });
            steps.push({ kind: 'sound', cue: 'target.hum', dir: side.dir, plays: REPEAT_PLAYS });
            steps.push({
                kind: 'ask',
                early: true,
                question: { id, lines: [{ key: 'headphones.q-side' }], options: 3, skippable: true },
                onAnswer: (value) => {
                    this.earsAnswers.set(id, { kind: 'side', value, right: value === correct, sector });
                }
            });
            return { kind: 'trial', steps };
        });
    }

    /** The game "what is it, where is it, is it moving" (rounds of three questions). */
    private gameBlocks(names: Extract<Goal, { kind: 'name-cues' }>, locate: Extract<Goal, { kind: 'locate' }> | null): Block[] {
        const rng = createRng((this.o.seed ?? 1) * 7919 + this.attemptNo);
        const options = names.cues.slice(0, 9);
        const rounds = Math.max(names.trials, locate?.trials ?? 0);
        const out: Block[] = [];
        for (let r = 0; r < rounds; r++) {
            const cueIndex = rng.int(0, options.length - 1);
            const cue = options[cueIndex] as CueId;
            const side = SIDES[rng.int(0, SIDES.length - 1)] as (typeof SIDES)[number];
            const moving = rng.next() < 0.5;
            const scene: DemoScene = { cue, dir: side.dir, moving, durS: GAME_SCENE_S };
            const id = `${this.lesson.id}:${this.attemptNo}:${r + 1}`;
            const feedback = (value: number | null, right: boolean, replay: boolean): Step[] =>
                value === null ? [] : right ? [{ kind: 'say', lines: [{ key: 'quiz.right' }] }] : [{ kind: 'say', lines: [{ key: 'quiz.wrong' }] }, ...(replay ? [{ kind: 'scene', scene, plays: 1 } as Step] : [])];
            const steps: Step[] = [{ kind: 'say', lines: r === 0 ? [{ key: 'quiz.howto' }, { key: 'quiz.intro' }] : [{ key: 'quiz.intro' }] }, { kind: 'scene', scene, plays: REPEAT_PLAYS }];
            if (r < names.trials) {
                steps.push({
                    kind: 'ask',
                    question: { id: `${id}:what`, lines: [{ key: 'quiz.q-what' }, ...options.map((c, i) => ({ key: 'quiz.option', params: { n: i + 1, label: this.cueName(c) } }))], options: options.length, skippable: true },
                    onAnswer: (value) => {
                        const right = value === cueIndex + 1;
                        this.earsAnswers.set(`${id}:what`, { kind: 'what', value, right });
                        this.script.unshift(...feedback(value, right, true));
                    }
                });
            }
            if (locate !== null && r < locate.trials) {
                const where = SIDES.indexOf(side) + 1;
                steps.push({
                    kind: 'ask',
                    question: { id: `${id}:where`, lines: [{ key: 'quiz.q-where' }, { key: 'quiz.where-options' }], options: 4, skippable: true },
                    onAnswer: (value) => {
                        const right = value === where;
                        this.earsAnswers.set(`${id}:where`, { kind: 'where', value, right });
                        this.script.unshift(...feedback(value, right, false));
                    }
                });
                steps.push({
                    kind: 'ask',
                    question: { id: `${id}:moving`, lines: [{ key: 'quiz.q-moving' }], options: 2, skippable: true },
                    onAnswer: (value) => {
                        const right = value === (moving ? 1 : 2);
                        this.earsAnswers.set(`${id}:moving`, { kind: 'moving', value, right });
                        if (value !== null) this.script.unshift({ kind: 'say', lines: [{ key: right ? 'quiz.right' : 'quiz.wrong' }, { key: moving ? 'quiz.moving' : 'quiz.still' }] });
                    }
                });
            }
            out.push({ kind: 'round', steps });
        }
        return out;
    }

    private endEarsAttempt(t: number): void {
        if (this.phaseValue !== 'flying') return;
        const names = this.goalOf('name-cues');
        const locate = this.goalOf('locate');
        const all = [...this.earsAnswers.values()];
        const count = (kind: EarsAnswer['kind'], right: boolean | null): number => all.filter((a) => a.kind === kind && (right === null || a.right === right)).length;
        const results: { index: number; met: boolean }[] = [];
        this.lesson.goals.forEach((g, index) => {
            if (g.kind === 'name-cues') results.push({ index, met: g.trials === 0 ? true : count('what', null) > 0 && count('what', true) / g.trials >= NAME_SHARE });
            else if (g.kind === 'locate') {
                // the game grades where and moving of every round; the headphone check the left and right trials it asked
                const game = names !== null && names.trials > 0;
                const asked = game ? 2 * g.trials : Math.max(1, count('side', null));
                const right = game ? count('where', true) + count('moving', true) : count('side', true);
                results.push({ index, met: right / asked >= LOCATE_SHARE });
            }
        });
        for (const r of results) this.emit({ t, kind: 'goal', index: r.index, what: r.met ? 'met' : 'missed' });
        // what the pilot hears about the attempt
        if (names !== null && names.trials > 0) {
            const total = count('what', null) + count('where', null) + count('moving', null);
            this.actions.push({ kind: 'say', line: { key: 'quiz.score', params: { right: count('what', true) + count('where', true) + count('moving', true), total } }, interrupt: false });
        } else if (locate !== null && names === null) {
            const side = all.filter((a) => a.kind === 'side');
            const swapped = side[0]?.value === 2 && side[1]?.value === 1;
            const good = results.every((r) => r.met);
            this.actions.push({ kind: 'say', line: { key: good ? 'headphones.good' : swapped ? 'headphones.swapped' : 'headphones.unclear' }, interrupt: false });
            const missed = side.flatMap((a) => (!a.right && a.sector !== undefined ? [a.sector] : []));
            this.earsRetry = good || missed.length === 0 ? null : missed;
        }
        this.endAttempt(results.every((r) => r.met), t);
    }

    private pushShapeQuestion(objectId: string, t: number): void {
        const object = this.objects().find((o) => o.id === objectId) ?? null;
        const kind = object === null ? null : object.shape.kind === 'cube-frame' ? 'shape.cube' : `shape.${object.shape.kind}`;
        const correct = kind === null ? -1 : SHAPE_ORDER.indexOf(kind) + 1;
        this.push({
            kind: 'ask',
            question: { id: `${this.lesson.id}:${this.attemptNo}:shape`, lines: [{ key: 'quiz.q-what' }, ...SHAPE_ORDER.map((c, i) => ({ key: 'quiz.option', params: { n: i + 1, label: this.cueName(c) } })), { key: 'quiz.skip' }], options: SHAPE_ORDER.length, skippable: true },
            onAnswer: (value) => {
                // optional: a skip counts as done, a wrong name as a miss
                this.shapeOutcome = value === null || value === correct ? 'met' : 'missed';
                if (value !== null) this.script.unshift({ kind: 'say', lines: [{ key: value === correct ? 'quiz.right' : 'quiz.wrong' }] });
            }
        });
        this.advance(t);
    }

    // -------------------------------------------------------------- the pilot's keys

    answer(value: number, via: 'key' | 'voice', t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        if (this.left) return this.drain();
        this.catchUp(t);
        let c = this.current;
        // a digit while the sound of a step plays answers the question right after it, when that one takes early answers:
        // the rest of the plays and the question's lines are left out (sonic-keys: the digit was dropped without a word)
        const next = this.script[0];
        if (!this.v012 && c !== null && c.step.kind === 'sound' && c.playT0 !== null && next?.kind === 'ask' && next.early === true && this.inRange(value, next.question)) {
            this.script.shift();
            this.stopCurrent();
            c = { step: next, t0: t, answered: false, batch: 0, spokenSeen: false, askSpokenAt: t, reminded: 0, playT0: null, played: 0, playEnd: 0 };
            this.current = c;
        }
        if (c === null || c.step.kind !== 'ask' || c.answered) {
            this.refuse(null, t);
            return this.drain();
        }
        const q = c.step.question;
        const skip = value === 0 && q.skippable;
        if (!this.inRange(value, q)) {
            this.refuse(q.options, t);
            return this.drain();
        }
        c.answered = true;
        this.emit({ t, kind: 'answer', item: q.id, value: skip ? null : value, via: skip ? 'skip' : via });
        this.current = null;
        this.interruptNext = true;
        try {
            c.step.onAnswer(skip ? null : value, t);
            // the answer is acknowledged at once: its sound, then "Taken: n." (or "Skipped."), cutting what was being said
            if (!this.v012) {
                this.actions.push({ kind: 'cue', event: { kind: 'answer', what: 'yes' } });
                this.script.unshift({ kind: 'say', lines: [skip ? { key: 'answer.skipped' } : { key: 'answer.got', params: { n: value } }] });
            }
            this.advance(t);
            if (!this.ears && this.prev !== null && this.phaseValue === 'flying') this.evaluateGoals(this.prev, this.prev, t);
            this.afterScript(t);
        } finally {
            this.interruptNext = false;
        }
        return this.drain();
    }

    /** A digit answers `q`: 1 to its options, or 0 when it may be skipped. */
    private inRange(value: number, q: Question): boolean {
        return (value === 0 && q.skippable) || (Number.isInteger(value) && value >= 1 && value <= q.options);
    }

    /**
     * A digit that answers nothing: the "no" sound at once and a word after what is being said ("Not taken. Nothing to
     * answer now." or "Not taken. Press 1 to {max}."). No event: the replay gets no input, and the line is the host's to it.
     */
    private refuse(max: number | null, t: number): void {
        if (this.v012 || !this.began || this.pausedAt !== null) return;
        this.actions.push({ kind: 'cue', event: { kind: 'answer', what: 'no' } });
        this.sayLines([max === null ? { key: 'answer.not-now' } : { key: 'answer.range', params: { max } }], false, t);
    }

    // -------------------------------------------------------------- N, B, Z and the lesson menu

    /**
     * Before a key, an answer or a reset at `t` the lesson catches up to `t`: what was due by then (the pause between
     * attempts ran out, a play ended, a question timed out) has happened, whether or not a frame came after it. A live host
     * steps a frame every 16 ms, a replay has the recording's 30 Hz frames: without this, a key in the same millisecond as
     * an attempt's start was taken before it in the replay and after it live (the simulator's reader test, found while
     * measuring review R4). Not while paused: the lesson's clocks wait then.
     */
    private catchUp(t: number): void {
        if (this.pausedAt !== null || !this.began || this.left) return;
        this.advance(t);
        this.afterScript(t);
    }

    /** A key of the pilot: the first line said after it cuts the speech going on (review D2). */
    private byKey(t: number, run: () => void): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        if (!this.began || this.left) return this.drain();
        this.catchUp(t);
        this.interruptNext = true;
        try {
            run();
            this.advance(t);
            this.afterScript(t);
        } finally {
            this.interruptNext = false;
        }
        return this.drain();
    }

    /** A question going on is left by a key: a skip, as when it times out. */
    private abandonQuestion(t: number): void {
        const c = this.current;
        if (c === null || c.step.kind !== 'ask' || c.answered) return;
        c.answered = true;
        this.emit({ t, kind: 'answer', item: c.step.question.id, value: null, via: 'skip' });
        c.step.onAnswer(null, t);
    }

    next(t: number): readonly SessionEvent[] {
        return this.byKey(t, () => {
            if (this.phaseValue === 'intro') {
                // the task or the intro is skipped: the first attempt begins (afterScript)
                this.abandonQuestion(t);
                this.script.length = 0;
                this.stopCurrent();
                return;
            }
            if (this.ears && this.phaseValue === 'flying' && this.blockIndex + 1 < this.blocks.length) {
                this.abandonQuestion(t);
                this.startBlock(this.blockIndex + 1, t);
                return;
            }
            // the last step (flying, the last sound, the pause after an attempt, the pass): the next lesson
            this.leave('next', t);
        });
    }

    previous(t: number): readonly SessionEvent[] {
        return this.byKey(t, () => {
            if (this.phaseValue === 'intro' || (this.ears && this.phaseValue === 'flying' && this.blockIndex === 0)) {
                this.leave('previous', t);
                return;
            }
            if (this.ears && this.phaseValue === 'flying') {
                this.abandonQuestion(t);
                this.startBlock(this.blockIndex - 1, t);
                return;
            }
            this.backToTask(t);
        });
    }

    repeat(t: number): readonly SessionEvent[] {
        return this.byKey(t, () => {
            if (this.phaseValue === 'intro' || (this.ears && this.phaseValue === 'flying')) {
                this.abandonQuestion(t);
                this.startBlock(this.blockIndex, t, true);
                return;
            }
            if (this.phaseValue === 'flying') {
                this.listen(t);
                return;
            }
            if (this.phaseValue === 'between') {
                // the task again, then the next attempt as planned
                this.stopCurrent();
                this.script.unshift(...this.introBlock().steps);
                return;
            }
            // after the end: the pass line, or that the lesson moved on without a pass
            this.actions.push({ kind: 'say', line: this.movedOn ? { key: 'fly.moving-on' } : this.lesson.speech.pass, interrupt: true });
        });
    }

    nextLesson(t: number): readonly SessionEvent[] {
        return this.byKey(t, () => this.leave('next', t));
    }

    previousLesson(t: number): readonly SessionEvent[] {
        return this.byKey(t, () => this.leave('previous', t));
    }

    /** B while flying (or after an attempt, or after the pass): the task again; the attempt is dropped, not counted. */
    private backToTask(t: number): void {
        this.abandonQuestion(t);
        this.resumeFrom = null; // the attempt after the task begins at the start
        this.tracker = null;
        this.listening = false;
        this.phaseValue = 'intro';
        this.blocks = [this.introBlock()];
        this.startBlock(0, t);
    }

    /** Z while flying: the task again; the goals and the attempt's clock wait until it has been said. */
    private listen(t: number): void {
        const c = this.current;
        // a question of the attempt (name-shape) is asked again after the task, not skipped
        const ask = c !== null && c.step.kind === 'ask' && !c.answered ? c.step : null;
        if (!this.listening) {
            this.listening = true;
            this.listenT0 = t;
        }
        this.script.length = 0;
        this.current = null;
        this.push(...this.introBlock().steps);
        if (ask !== null) this.push(ask);
    }

    /** The task has been said again: the attempt goes on. */
    private endListening(t: number): void {
        this.listening = false;
        this.pausedMs += t - this.listenT0;
        this.push({ kind: 'say', lines: [{ key: 'fly.go-on' }] });
    }

    /** The pilot leaves for the next or the previous lesson: the host opens it ('go'); nothing more happens here. */
    private leave(to: 'next' | 'previous', t: number): void {
        this.abandonQuestion(t);
        this.stopCurrent();
        this.script.length = 0;
        // a detour (G) left forward was heard, not skipped: the ladder's state of the lesson stays as it was
        if (to === 'next' && !this.passedValue && !this.detour) this.skippedValue = true;
        this.listening = false;
        this.lessonEvent('leave', t);
        this.left = true;
        this.actions.push({ kind: 'go', to });
    }

    reset(to: 'checkpoint' | 'start', t: number): { readonly pose: Pose; readonly events: readonly SessionEvent[] } {
        this.t = Math.max(this.t, t);
        if (this.left) return { pose: this.startPose(Math.max(this.attemptNo, 1)), events: this.drain() };
        this.catchUp(t);
        // a short R: near the last point passed (M41-20); a long R: the start
        const back = to === 'checkpoint' && !this.ears && this.phaseValue === 'flying' ? this.respawn() : null;
        const pose = back === null ? this.startPose(Math.max(this.attemptNo, 1)) : back.pose;
        this.emit({ t, kind: 'reset', to, checkpointId: back === null ? null : back.id });
        this.prev = null;
        this.backSince = null;
        this.legFlown = false; // placed: the leg is flown again from where the craft is now
        if (to === 'start') this.resumeFrom = null; // a long R in the pause: the next attempt from the start too
        if (to === 'start' && this.phaseValue === 'flying') {
            // the same attempt again from the start (a manual reset is not a failure)
            this.lastGate = null;
            this.attemptT0 = t;
            this.touchCount = 0;
            this.pathM = 0;
            this.goalIndex = 0;
            this.shapeOutcome = null;
            this.lastCheckpoint = null;
            this.passedPoint = null;
            this.reached.clear();
            this.script.length = 0;
            this.current = null;
            if (this.ears) {
                this.earsAnswers = new Map();
                this.blocks = [this.introBlock(), ...this.earsBlocks()];
                this.blockIndex = 1;
                const block = this.blocks[1];
                if (block !== undefined) this.push(...block.steps);
            } else this.startGoal(t);
            this.push({ kind: 'say', lines: [{ key: 'fly.reset-start' }], interrupt: !this.ears });
            this.advance(t);
        } else if (to === 'checkpoint') this.push({ kind: 'say', lines: [{ key: 'fly.reset-checkpoint' }], interrupt: !this.ears });
        return { pose, events: this.drain() };
    }

    // -------------------------------------------------------------- pause

    pause(t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        if (this.pausedAt === null && this.began && !this.left) this.pausedAt = t;
        return this.drain();
    }

    resume(t: number): readonly SessionEvent[] {
        this.t = Math.max(this.t, t);
        const at = this.pausedAt;
        if (at === null) return this.drain();
        this.pausedAt = null;
        const d = Math.max(0, t - at);
        // every clock the lesson keeps moves on by the pause, as if it had not been
        const c = this.current;
        if (c !== null) {
            c.t0 += d;
            if (c.playT0 !== null) {
                c.playT0 += d;
                c.playEnd += d;
            }
            if (c.askSpokenAt !== null) c.askSpokenAt += d;
        }
        if (this.speechDeadline > at) this.speechDeadline += d;
        if (this.scene !== null) this.scene = { scene: this.scene.scene, t0: this.scene.t0 + d };
        // the attempt's time limit and its goals' clock (goalClock) leave the pause out; a repeat (Z) going on waits it out too
        this.pausedMs += d;
        if (this.listening) this.listenT0 += d;
        this.lastWrongWay += d;
        this.lastWrongSide += d;
        this.backSince = null;
        // the first frame after the pause is not measured against the last one before it (no jump, no time in a band)
        this.prev = null;
        this.advance(t);
        this.afterScript(t);
        return this.drain();
    }

    // -------------------------------------------------------------- what the host shows and says

    view(): LessonView {
        const paths = lessonPaths();
        const path = this.o.path ?? 'full';
        const onPath = paths[path].includes(this.lesson.id) ? path : 'full';
        const list = paths[onPath];
        const index = list.indexOf(this.lesson.id);
        const steps = this.ears ? 1 + this.earsStepCount() : 2;
        const step = this.ears ? Math.min(this.blockIndex + 1, steps) : this.phaseValue === 'intro' ? 1 : 2;
        const stepKind: StepKind = this.ears ? (this.blocks[this.blockIndex]?.kind ?? 'intro') : step === 1 ? 'task' : 'fly';
        const flying = !this.ears && this.phaseValue === 'flying';
        return {
            lessonId: this.lesson.id,
            title: this.lesson.title,
            lessonIndex: index < 0 ? 1 : index + 1,
            lessonCount: index < 0 ? 1 : list.length,
            path: onPath,
            step,
            steps,
            stepKind,
            goal: flying ? this.goalIndex + 1 : 0,
            goals: this.ears ? 0 : this.lesson.goals.length,
            attempt: this.attemptNo,
            counted: this.counted,
            required: this.lesson.pass.required,
            failsInARow: this.failRun,
            offered: this.offered,
            touches: this.touchCount,
            maxTouches: this.lesson.pass.maxTouches,
            phase: this.phaseValue,
            passed: this.passedValue,
            skipped: this.skippedValue,
            listening: this.listening,
            paused: this.pausedAt !== null,
            playing: this.playing()
        };
    }

    private playing(): LessonView['playing'] {
        const c = this.current;
        if (c === null || c.playT0 === null || (c.step.kind !== 'sound' && c.step.kind !== 'scene') || this.t >= c.playEnd) return null;
        return { cue: c.step.kind === 'sound' ? c.step.cue : c.step.scene.cue, index: c.played, of: this.v012 ? 1 : c.step.plays };
    }

    statusLine(): SpeechLine {
        return statusLine(this.view(), this.text(this.lesson.title));
    }

    // -------------------------------------------------------------- what the engine hears

    target(): SonicObject | null {
        if (this.ears || this.left) return null;
        if (this.phaseValue === 'flying') return this.tracker === null ? null : this.tracker.target();
        // between attempts the next attempt's first target keeps sounding (M41-10: silence means something is wrong)
        return this.phaseValue === 'between' ? this.firstTarget() : null;
    }

    /** What the first goal of an attempt sounds as its target (null for a goal without one: a height, a distance). */
    private firstTarget(): SonicObject | null {
        const goal = this.lesson.goals[0];
        if (goal === undefined) return null;
        return createTracker(goal, { floorY: this.o.floorY ?? 0, objects: () => this.objects(), world: () => this.worldRef, attemptPathM: () => 0, passedGate: () => undefined }).target();
    }

    progress(): LessonProgress {
        const lastAt = new Date((this.o.sessionStartMs ?? 0) + Math.max(this.lastAtT, 0)).toISOString();
        // blocksPassed: 1 once the lesson was passed by its rule (format 2 has no blocks), the blocks in a row under the v0.12 control
        const blocksPassed = this.hooks.passRule !== undefined ? this.consecutive : this.passedByRule ? 1 : 0;
        return { lessonId: this.lesson.id, version: this.lesson.version, attempts: this.attemptsDone, successes: this.successes, blocksPassed, passed: this.passedValue, bestTimeMs: this.bestTimeMs, lastAt, skipped: this.skippedValue };
    }

    demoFrame(t: number): SonicFrameInput | null {
        if (this.scene === null) return null;
        return demoFrame(this.scene.scene, (t - this.scene.t0) / 1000, t, this.sceneWorlds);
    }
}

/** How close the segment a..b comes to p (a fast craft can pass a checkpoint between two frames), m. */
function segmentDistance(a: Vec3, b: Vec3, p: Vec3): number {
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const u = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
    return dist3(p, [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u]);
}

/**
 * The progress view as one line to say (I): "Lesson 6 of 28: Hold your height. Step 2 of 2. Attempt 4.
 * Counted 2 of 3." A lesson without a world says its lesson and step only. `title` is the lesson's title
 * in the pilot's language.
 */
export function statusLine(v: LessonView, title: string): SpeechLine {
    const base = { title, lesson: v.lessonIndex, lessons: v.lessonCount, step: v.step, steps: v.steps };
    if (v.goals === 0 || v.attempt === 0) return { key: 'status.progress-step', params: base };
    return { key: 'status.progress', params: { ...base, n: v.attempt, counted: v.counted, required: v.required } };
}

// ------------------------------------------------------------------ module-0 scenes

const SCENE_SHAPES: Readonly<Record<string, { readonly generator: 'rings' | 'squares' | 'cube-frames' | 'pillars'; readonly params: Readonly<Record<string, number | string>> }>> = {
    'shape.ring': { generator: 'rings', params: { layout: 'single', sizeM: 2.4, aheadM: 10 } },
    'shape.square': { generator: 'squares', params: { layout: 'single', sizeM: 2.4, aheadM: 10 } },
    'shape.cube': { generator: 'cube-frames', params: { layout: 'single', sizeM: 2.4, aheadM: 10 } },
    'shape.pillar': { generator: 'pillars', params: { layout: 'single', aheadM: 10, startHeightM: 3 } },
    'safety.obstacle': { generator: 'pillars', params: { layout: 'single', aheadM: 10, startHeightM: 3 } }
};

function sceneWorld(key: string, make: () => AnalyticWorldInfo, cache: Map<string, AnalyticWorldInfo>): AnalyticWorldInfo {
    let w = cache.get(key);
    if (w === undefined) {
        w = make();
        cache.set(key, w);
    }
    return w;
}

function demoSample(t: number, pos: Vec3, vel: Vec3, yawDeg: number): FlightSample {
    return { t, tick: 0, pos, vel, quat: yawQuat(yawDeg), rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false };
}

/** How far the source is at scene time u (0..1): an approach that slows as it nears, or a still distance. */
function sceneDistance(moving: boolean, far: number, near: number, still: number, u: number): number {
    if (!moving) return still;
    const x = Math.min(Math.max(u, 0), 1);
    return far * (near / far) ** x;
}

/**
 * The frame of a module-0 scene at `age` seconds: a virtual craft (the listener) that moves toward
 * a wall, a shape or a hum from the scene's direction, in a small analytic world, so the engine
 * sounds it exactly as in flight.
 */
export function demoFrame(scene: DemoScene, age: number, t: number, cache: Map<string, AnalyticWorldInfo> = new Map()): SonicFrameInput {
    const u = age / scene.durS;
    const du = 0.01;
    const az = (Math.atan2(scene.dir[0], -scene.dir[2]) * 180) / Math.PI;
    if (scene.cue in APPROACHES && scene.cue !== 'safety.obstacle') {
        const hall = sceneWorld('hall', () => createAnalyticWorld(makeSpec('hall', {}, 1)), cache);
        const [w, , d] = [40, 12, 60];
        const h = 12;
        const gap = (x: number): number => sceneDistance(scene.moving, 9, 1.2, 3, x);
        const at = (x: number): Vec3 => {
            const g = gap(x);
            const [dx, dy, dz] = scene.dir;
            if (dy > 0.5) return [0, h - g, 0];
            if (dy < -0.5) return [0, g, 0];
            if (Math.abs(dx) > Math.abs(dz)) return [dx < 0 ? -w / 2 + g : w / 2 - g, 3, 0];
            return [0, 3, dz < 0 ? -d / 2 + g : d / 2 - g];
        };
        const p = at(u);
        const q = at(u + du);
        const vel: Vec3 = [(q[0] - p[0]) / (du * scene.durS), (q[1] - p[1]) / (du * scene.durS), (q[2] - p[2]) / (du * scene.durS)];
        return { sample: demoSample(t, p, scene.moving && u < 1 ? vel : [0, 0, 0], 0), world: hall, target: null, floorY: 0 };
    }
    const shape = SCENE_SHAPES[scene.cue];
    if (shape !== undefined) {
        const world = sceneWorld(scene.cue, () => createAnalyticWorld(makeSpec(shape.generator, shape.params, 1)), cache);
        const object = world.objects()[0] as SonicObject;
        const gap = (x: number): number => sceneDistance(scene.moving, 10, 2.2, 5, x);
        // the craft strafes along -Z toward the object while facing -az, so the object sits at the scene's direction
        const at = (x: number): Vec3 => [object.pos[0], object.pos[1], object.pos[2] + gap(x)];
        const p = at(u);
        const q = at(u + du);
        const vel: Vec3 = [0, 0, (q[2] - p[2]) / (du * scene.durS)];
        return { sample: demoSample(t, p, scene.moving && u < 1 ? vel : [0, 0, 0], -az), world, target: object.order === null ? null : object, floorY: 0 };
    }
    // a hum (target.hum and anything else): a goal zone in an empty space
    const gap = (x: number): number => sceneDistance(scene.moving, 14, 3, 6, x);
    const target: SonicObject = { id: 'demo', shape: { kind: 'zone', size: [1, 1, 1] }, pos: [scene.dir[0] * 14, 1.5 + scene.dir[1] * 14, scene.dir[2] * 14], quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' };
    const at = (x: number): Vec3 => {
        const travelled = 14 - gap(x);
        return [scene.dir[0] * travelled, 1.5 + scene.dir[1] * travelled, scene.dir[2] * travelled];
    };
    const p = at(u);
    const q = at(u + du);
    const vel: Vec3 = [(q[0] - p[0]) / (du * scene.durS), (q[1] - p[1]) / (du * scene.durS), (q[2] - p[2]) / (du * scene.durS)];
    return { sample: demoSample(t, p, scene.moving && u < 1 ? vel : [0, 0, 0], 0), world: null, target, floorY: 0 };
}

/** A runner for one lesson (contract LessonRunner, plus the host interface of LessonSession). */
export function createLessonRunner(lesson: LessonDef, options: RunnerOptions = {}): LessonSession {
    return new Runner(lesson, options);
}

