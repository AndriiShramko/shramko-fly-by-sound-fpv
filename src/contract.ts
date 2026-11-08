// The shared contract of Fly by Sound, stage 1 (docs/design/stage-1-spec.md). Types and data
// constants only: no logic and no DOM types, so the engine (browser), the lesson runner, the
// session format, the report tool (Node) and the simulator's adapters (ShramkoGSFPV,
// packages/sonic-fpv, plan docs/wip/v12-plan.md there) all compile against the same file.
// A change here is a contract change: the lead makes it and both repositories follow.
//
// Coordinates and units are the simulator's own (ShramkoGSFPV packages/sim-core/src/sim.ts):
//   world       right-handed, +Y up, metres: the FLOWN world. A scan is flown through its scene
//               transform T(p) = s*p + t; an analytic lesson world is flown at s = 1, t = 0.
//   scan frame  a scan's own coordinates before T (s = 1, metres of the file, +Y up): what the
//               simulator's walls answer in at the identity transform. Track files use it.
//   body        x right, y up, z back: the nose points along -Z.
//   heading     the listener frame: the world turned by -yaw about +Y, tilt ignored (x right, y up,
//               z back). These are Web Audio's default listener axes (facing -Z, up +Y), so a
//               PannerNode takes a heading-frame position as it is.
//   angles      degrees. yaw 0 = nose along -Z, positive = turned right; pitch positive = nose down;
//               roll positive = right side down (sim-core attitude()).
//   quaternion  [w, x, y, z], body to world.
//   time        ms. `t`: the page clock since the session started (it runs on through pauses and
//               is the clock of voice.webm). `tick`: the flight model's integer ms (it stops while
//               the flight is paused; 1 tick = one 1 ms physics step).
//   sticks      [-1, 1]: roll (right +), pitch (forward +), throttle (-1 low, +1 full), yaw (right +).

// ------------------------------------------------------------------ basics

export type Vec3 = readonly [number, number, number];
/** [w, x, y, z], body (or object) to world. */
export type Quat = readonly [number, number, number, number];
/** [s, tx, ty, tz]: T(p) = s*p + t, uniform s > 0, as the simulator's life header holds it. */
export type SceneTransform = readonly [number, number, number, number];
/** A level pose: where a craft is placed (spawn, checkpoint, lesson start). */
export interface Pose {
    readonly pos: Vec3;
    readonly yawDeg: number;
}

export const LOCALES = ['en', 'es', 'pl', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

/** A line of speech or caption: a key of locales/<lang>.json and its named parameters. */
export interface SpeechLine {
    readonly key: string;
    readonly params?: Readonly<Record<string, string | number>>;
}

/** Format identifiers of every file this contract describes; a breaking change is a new number. */
export const FORMATS = {
    /** format 2 (v0.13): the pass rule counts in total; files of format 1 are migrated on load (src/lesson/validate.ts) */
    lesson: 'shramko-sonic-lesson/2',
    track: 'shramko-sonic-track/1',
    theme: 'shramko-sonic-theme/1',
    prefs: 'shramko-sonic-prefs/1',
    session: 'shramko-sonic-session/1',
    survey: 'shramko-sonic-survey/1',
    answers: 'shramko-sonic-answers/1'
} as const;

// ------------------------------------------------------------------ the flight, as sound hears it

/**
 * One sample of the flight, taken by the simulator's adapter once per rendered frame (and replayed
 * from flight.jsonl.gz). World frame unless stated.
 */
export interface FlightSample {
    /** page clock, ms since the session started */
    readonly t: number;
    /** flight model time, integer ms */
    readonly tick: number;
    readonly pos: Vec3;
    /** m/s */
    readonly vel: Vec3;
    readonly quat: Quat;
    /** body angular rate, rad/s, body frame */
    readonly rate: Vec3;
    readonly yawDeg: number;
    readonly pitchDeg: number;
    readonly rollDeg: number;
    /** the channels the flight model applied last: roll, pitch, throttle, yaw */
    readonly sticks: readonly [number, number, number, number];
    readonly armed: boolean;
    /** a contact (soft bump) began since the previous sample */
    readonly touched: boolean;
    /** the flight is paused, or a replay drives the view */
    readonly paused: boolean;
}

// ------------------------------------------------------------------ the world, as sound reads it

export const MATERIAL_CLASSES = ['wall', 'floor', 'ceiling', 'obstacle'] as const;
/** Timbre class of a surface (spec section 2: wood, low thud, airy, metal). */
export type MaterialClass = (typeof MATERIAL_CLASSES)[number];

export interface RayHit {
    /** metres from the ray origin */
    readonly distance: number;
    readonly point: Vec3;
    /** outward unit normal, or null when the world cannot tell */
    readonly normal: Vec3 | null;
    readonly material: MaterialClass;
    /** the SonicObject hit, or null for walls, floor and ceiling */
    readonly objectId: string | null;
}

/**
 * The shape of an object in its own frame. Openings face along the local Z axis: a craft passes a
 * ring, square or gate by crossing its local XY plane inside the opening. Sizes in metres of the
 * frame the object lives in (world for SonicObject, scan frame for TrackGate).
 */
export type ObjectShape =
    | { readonly kind: 'ring'; readonly diameter: number; readonly tube: number }
    | { readonly kind: 'square'; readonly side: number; readonly bar: number }
    | { readonly kind: 'cube-frame'; readonly side: number; readonly bar: number }
    | { readonly kind: 'pillar'; readonly radius: number; readonly height: number }
    | { readonly kind: 'box'; readonly size: Vec3 }
    /** a volume with no collision: a stop zone, a goal */
    | { readonly kind: 'zone'; readonly size: Vec3 };

export interface SonicObject {
    readonly id: string;
    readonly shape: ObjectShape;
    /** centre, world frame */
    readonly pos: Vec3;
    readonly quat: Quat;
    /** place in the course (0 first), or null for an object that is not a gate */
    readonly order: number | null;
    /** the craft collides with it */
    readonly solid: boolean;
    readonly material: MaterialClass;
}

/**
 * What sound knows of the place: rays against everything solid, and the objects. Sound never reads
 * the renderer. Two implementations: analytic lesson worlds (this package) and scan worlds (the
 * simulator's voxel walls, objects from a track file).
 */
export interface SonicWorld {
    readonly kind: 'analytic' | 'scan';
    /** lesson world id or scene id */
    readonly id: string;
    readonly version: number;
    /** world-frame bounds of everything a ray can hit */
    readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
    /** First hit along a unit direction within maxDist (world frame), or null. */
    castRay(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null;
    /** Gates, pillars and zones; gates sorted by order. */
    objects(): readonly SonicObject[];
}

/** The generators of analytic lesson worlds (spec section 4). Seeded and deterministic. */
export const WORLD_GENERATORS = ['open', 'hall', 'corridor', 'pillars', 'rings', 'squares', 'cube-frames'] as const;
export type WorldGenerator = (typeof WORLD_GENERATORS)[number];

/** An analytic world as data: the same spec always gives the same geometry and the same digest. */
export interface AnalyticWorldSpec {
    readonly generator: WorldGenerator;
    /** generator version; a change of geometry is a new version */
    readonly version: number;
    readonly seed: number;
    readonly params: Readonly<Record<string, number | string | boolean | readonly number[]>>;
}

/**
 * An analytic world built from its spec. The simulator builds its collider from `solidAt` (one
 * voxel per call) and names the walls by `digest`, so a flight log replays on the same walls.
 */
export interface AnalyticWorld extends SonicWorld {
    readonly kind: 'analytic';
    readonly spec: AnalyticWorldSpec;
    /** sha256 hex of the canonical JSON of `spec` and the generator version */
    readonly digest: string;
    /** signed distance to the nearest solid surface, metres (negative inside) */
    sdf(x: number, y: number, z: number): number;
    /** solid at this point (sdf <= 0) */
    solidAt(x: number, y: number, z: number): boolean;
    /** the voxel size the simulator should build the collider at, metres */
    readonly voxelM: number;
}

export interface TrackRef {
    readonly id: string;
    readonly version: number;
}

/** Where a lesson flies. 'none': module 0 (ears), sources are placed by the lesson alone. */
export type LessonWorldRef =
    | { readonly kind: 'none' }
    | { readonly kind: 'analytic'; readonly spec: AnalyticWorldSpec }
    | { readonly kind: 'scan'; readonly sceneId: string; readonly sceneVersion: number | null; readonly transform: SceneTransform; readonly track: TrackRef | null };

// ------------------------------------------------------------------ track files (seed of stage 2)

/**
 * A course in a scene. Never edited in place: a change is a new version with `parent` naming the
 * one it changes. Every position and size is in the scan frame (or the lesson world's frame);
 * flown = s * p + t with `transform`, sizes times s.
 */
export interface TrackFile {
    readonly format: (typeof FORMATS)['track'];
    readonly id: string;
    readonly version: number;
    readonly parent: TrackRef | null;
    readonly title: string;
    readonly scene: { readonly kind: 'scan' | 'lesson'; readonly id: string; readonly version: number };
    /** the scene transform the course was laid out for */
    readonly transform: SceneTransform;
    /** in course order */
    readonly gates: readonly TrackGate[];
    readonly laps: number;
    /** where a run starts, or null for the scene's own spawn */
    readonly start: Pose | null;
    readonly author: { readonly kind: 'person' | 'agent' | 'generator'; readonly name: string };
    /** how the course was made; null when placed by hand */
    readonly generator: { readonly name: string; readonly version: string; readonly seed: number | null; readonly params: Readonly<Record<string, unknown>> } | null;
    /** ISO 8601 */
    readonly created: string;
}

export interface TrackGate {
    readonly id: string;
    readonly shape: ObjectShape;
    readonly pos: Vec3;
    readonly quat: Quat;
    /** 'forward': only a pass along the gate's local -Z counts; 'any': either way */
    readonly direction: 'forward' | 'any';
}

// ------------------------------------------------------------------ sound layers and themes

export const LAYER_IDS = ['safety', 'height', 'speed', 'target', 'shape', 'room', 'voice'] as const;
/** The layers of spec section 2; the safety layer outranks every other one. */
export type LayerId = (typeof LAYER_IDS)[number];

/** The scene sample's directions (spec section 2): each is the minimum of several rays. */
export const SECTORS = ['front', 'back', 'left', 'right', 'up', 'down', 'front-left', 'front-right', 'front-up', 'front-down'] as const;
export type SectorId = (typeof SECTORS)[number];

export type Timbre = 'mallet' | 'pad' | 'sine' | 'click' | 'pluck' | 'air' | 'noise' | 'wood' | 'thud' | 'metal';

export interface LayerTheme {
    readonly gainDb: number;
    readonly timbre: Timbre;
    /** layer-specific numbers (pulse length, tick range, roughness depth, ...), checked by the theme loader */
    readonly params: Readonly<Record<string, number>>;
}

/** A theme is plain data a sound engineer tunes without code; the Sound Lab exports it. */
export interface ThemeDef {
    readonly format: (typeof FORMATS)['theme'];
    /** 'soft' (default), 'clear', 'race', or an exported custom id */
    readonly id: string;
    readonly version: number;
    readonly name: string;
    /** every pitched note comes from this scale: root and pentatonic steps in semitones */
    readonly scale: { readonly rootHz: number; readonly steps: readonly number[]; readonly octaves: number };
    readonly master: { readonly gainDb: number; readonly ceilingDb: number; readonly fadeInS: number };
    /** how far other layers duck under speech, dB (12) */
    readonly duckDb: number;
    readonly layers: Readonly<Record<LayerId, LayerTheme>>;
    /** the safety layer's timbre per surface class */
    readonly materials: Readonly<Record<MaterialClass, Timbre>>;
}

/** The pilot's own sound settings (the simulator keeps them in its prefs as one opaque value). */
export interface SonicPrefs {
    readonly format: (typeof FORMATS)['prefs'];
    readonly theme: string;
    readonly calm: boolean;
    /** spec principle 6: "up = higher" can be flipped */
    readonly heightPolarity: 'up-higher' | 'up-lower';
    readonly layerGainDb: Readonly<Partial<Record<LayerId, number>>>;
    readonly layerPitchSteps: Readonly<Partial<Record<LayerId, number>>>;
    /** false: "my screen reader speaks", menus are not self-voiced and use aria-live */
    readonly selfVoice: boolean;
    /** speechSynthesis rate, 0.5 to 2 */
    readonly speechRate: number;
    readonly captions: boolean;
    /** the simulator's motor sound in this mode (off by default: it masks cues) */
    readonly motorSound: boolean;
    readonly path: 'full' | 'fast';
    /** listener frame: 'heading' (default, tilt ignored) or the full body attitude */
    readonly listenerFrame: 'heading' | 'body';
}

// ------------------------------------------------------------------ lessons

export const MODULES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
/** 0 ears, 1 hover, 2 move and stop, 3 walls, 4 corridor, 5 rings, 6 shapes, 7 free flight. */
export type ModuleId = (typeof MODULES)[number];

/**
 * How the sticks fly. Assists are inputs (sticks the simulator computes), so a flight log replays
 * without them. 'velocity': sticks ask a speed, centred sticks brake and hold (self-levelling);
 * 'angle', 'horizon', 'acro': the flight mode itself.
 */
export type ControlMode = 'velocity' | 'angle' | 'horizon' | 'acro';

export interface LessonAssists {
    readonly control: ControlMode;
    /** 'hold': the throttle stick asks a climb or sink speed, centred holds the height; 'own': the pilot's throttle */
    readonly altitude: 'hold' | 'own';
    /** horizontal speed cap, m/s; null = none */
    readonly maxSpeedMps: number | null;
    readonly maxClimbMps: number | null;
    readonly maxYawDps: number | null;
    /** motors start with the first flying input; no arm step */
    readonly autoArm: boolean;
    /** a touch is a soft bump; 'bump-recentre' also puts the craft back at the last checkpoint */
    readonly onTouch: 'bump' | 'bump-recentre';
}

export interface LessonLayers {
    readonly on: readonly LayerId[];
    /** the height layer's target band, metres above the lesson floor; roughness outside it */
    readonly heightBandM: readonly [number, number] | null;
    /** at most this many hazard voices at once (3 or fewer) */
    readonly hazardVoices: number;
}

/** A cue's stable id, `<layer>.<name>` (safety.wall, target.hum, shape.ring, ...): glossary, recordings. */
export type CueId = string;

/** What one attempt must achieve; every goal of a lesson in order. */
export type Goal =
    | { readonly kind: 'name-cues'; readonly cues: readonly CueId[]; readonly trials: number }
    | { readonly kind: 'locate'; readonly trials: number }
    | { readonly kind: 'hold-height'; readonly bandM: readonly [number, number]; readonly seconds: number; readonly shareMin: number }
    | { readonly kind: 'turn-to'; readonly objectId: string; readonly toleranceDeg: number }
    | { readonly kind: 'reach-zone'; readonly zoneId: string; readonly stop: boolean; readonly stopBelowMps: number }
    | { readonly kind: 'approach-stop'; readonly objectId: string | null; readonly stopWithinM: number }
    | { readonly kind: 'around'; readonly objectId: string }
    | { readonly kind: 'fly-distance'; readonly metres: number }
    | { readonly kind: 'pass-gates'; readonly gateIds: readonly string[] | 'all'; readonly inOrder: boolean }
    | { readonly kind: 'name-shape'; readonly objectId: string }
    | { readonly kind: 'timed-course'; readonly laps: number };

/**
 * Lesson format 2: "r counted attempts in total, with at most m touches each". Failures in between do
 * not reset the count. After `attempts` failed attempts in a row the pilot hears why; a blocking
 * lesson then offers the next lesson (and offers it again after every further `attempts` in a row), a
 * lesson that does not block moves on by itself. Format 1 ("k of n attempts in b blocks in a row") is
 * migrated on load: required = min(3, required x blocks), attempts = 3 (blocking) or min(3, attempts x blocks).
 */
export interface PassRule {
    /** failed attempts in a row after which the pilot hears why and is offered to go on (1 to 3) */
    readonly attempts: number;
    /** counted attempts in total that pass the lesson (1 to 3) */
    readonly required: number;
    /** format 1 only (blocks in a row); 1 in format 2 */
    readonly blocks: number;
    /** touches allowed in a counted attempt; null = any */
    readonly maxTouches: number | null;
    /** false: the lesson never holds anyone back (the game, the shapes, free flight) */
    readonly blocking: boolean;
}

export interface Checkpoint {
    readonly id: string;
    /** where a reset puts the craft, world frame */
    readonly pose: Pose;
    /** reached when the craft's centre comes within radiusM of this point */
    readonly at: Vec3;
    readonly radiusM: number;
    /** lesson format 2: this checkpoint ends stage `stage` of the course ("Stage 2 passed"); stages count up along the list */
    readonly stage?: number;
}

/** A line of a lesson's intro (format 2): `cues` are the sounds it names, each played three times after the line. */
export interface IntroLine extends SpeechLine {
    readonly cues?: readonly CueId[];
}

/** A lesson is data (spec section 3). Every lesson can be opened directly; the ladder only recommends. */
export interface LessonDef {
    readonly format: (typeof FORMATS)['lesson'];
    /** stable id, used in the URL (?sonic=<id>) and in progress */
    readonly id: string;
    /** a changed lesson is a new version */
    readonly version: number;
    readonly module: ModuleId;
    readonly order: number;
    /** part of the short path of about six lessons */
    readonly fastPath: boolean;
    readonly title: SpeechLine;
    readonly intro: readonly IntroLine[];
    readonly world: LessonWorldRef;
    readonly start: Pose;
    readonly assists: LessonAssists;
    readonly layers: LessonLayers;
    readonly goals: readonly Goal[];
    readonly pass: PassRule;
    readonly checkpoints: readonly Checkpoint[];
    /** an attempt ends unpassed after this long; null = no limit */
    readonly attemptLimitS: number | null;
    readonly speech: { readonly pass: SpeechLine; readonly retry: SpeechLine; readonly hints: readonly SpeechLine[] };
}

export interface LessonProgress {
    readonly lessonId: string;
    readonly version: number;
    readonly attempts: number;
    readonly successes: number;
    readonly blocksPassed: number;
    readonly passed: boolean;
    readonly bestTimeMs: number | null;
    /** ISO 8601 */
    readonly lastAt: string;
    /** v0.13: the pilot went on to the next lesson without passing this one (N); false or absent otherwise */
    readonly skipped?: boolean;
}

// ------------------------------------------------------------------ the session package

/** One line of flight.jsonl.gz, 30 Hz. Positions in mm precision, quaternions 1e-4. */
export interface FlightFrame {
    readonly t: number;
    readonly tick: number;
    readonly p: Vec3;
    readonly v: Vec3;
    readonly q: Quat;
    /** roll, pitch, throttle, yaw */
    readonly s: readonly [number, number, number, number];
    /** ids of the cues sounding in this frame (ActiveCue.id) */
    readonly c: readonly string[];
}

/** One line of events.jsonl. `t` is the page clock of the session, ms. */
export type SessionEvent =
    | { readonly t: number; readonly kind: 'session'; readonly what: 'start' | 'pause' | 'resume' | 'end' | 'recovered' }
    | { readonly t: number; readonly kind: 'lesson'; readonly lessonId: string; readonly version: number; readonly what: 'open' | 'intro' | 'attempt-start' | 'attempt-pass' | 'attempt-fail' | 'block-pass' | 'passed' | 'leave'; readonly attempt: number }
    | { readonly t: number; readonly kind: 'goal'; readonly index: number; readonly what: 'met' | 'missed' }
    | { readonly t: number; readonly kind: 'touch'; readonly material: MaterialClass; readonly speed: number; readonly pos: Vec3 }
    | { readonly t: number; readonly kind: 'gate'; readonly gateId: string; readonly index: number; readonly missM: number }
    | { readonly t: number; readonly kind: 'checkpoint'; readonly id: string }
    | { readonly t: number; readonly kind: 'reset'; readonly to: 'checkpoint' | 'start'; readonly checkpointId: string | null }
    | { readonly t: number; readonly kind: 'speech'; readonly key: string; readonly text: string }
    | { readonly t: number; readonly kind: 'key'; readonly code: string; readonly action: string | null }
    | { readonly t: number; readonly kind: 'answer'; readonly item: string; readonly value: number | null; readonly via: 'key' | 'voice' | 'skip' }
    | { readonly t: number; readonly kind: 'recording'; readonly what: 'start' | 'stop' | 'mic-denied' }
    | { readonly t: number; readonly kind: 'send'; readonly what: 'asked' | 'stored' | 'delivered' | 'failed'; readonly channel: 'server' | 'telegram' | 'email' | null };

export interface Consent {
    /** the session is recorded at all (off until the pilot allows it) */
    readonly recording: boolean;
    readonly voice: boolean;
    /** a separate confirmation to send the package */
    readonly send: boolean;
    /** the browser's speech recognition was allowed (audio goes to the browser vendor) */
    readonly speechRecognition: boolean;
    readonly minor: boolean;
    /** for a minor: the helper confirmed a parent's signed consent; null for an adult */
    readonly guardianConfirmed: boolean | null;
    /** ISO 8601 */
    readonly at: string;
}

export interface DeviceInfo {
    readonly userAgent: string;
    readonly locale: Locale;
    readonly audio: { readonly sampleRate: number; readonly baseLatencyMs: number | null; readonly outputLatencyMs: number | null };
    readonly input: 'keyboard' | 'gamepad' | 'radio' | 'touch';
    readonly inputName: string | null;
    /** what the pilot or helper said */
    readonly headphones: 'wired' | 'bluetooth' | 'speakers' | 'unknown';
    readonly gpu: string | null;
}

/** The file names inside one session .zip. sim-log.json (the simulator's own input log) is optional. */
export const SESSION_FILES = {
    manifest: 'manifest.json',
    flight: 'flight.jsonl.gz',
    events: 'events.jsonl',
    voice: 'voice.webm',
    survey: 'survey.json',
    simLog: 'sim-log.json'
} as const;

export interface SessionManifest {
    readonly format: (typeof FORMATS)['session'];
    /** random, URL-safe, at least 16 characters; no name in it */
    readonly id: string;
    readonly created: string;
    readonly ended: string | null;
    /** false: an unfinished session, recovered from the browser's storage */
    readonly complete: boolean;
    /** app name, the simulator's release id, this package's version and commit */
    readonly app: { readonly name: string; readonly release: string; readonly sonic: string };
    readonly scene: { readonly kind: 'none' | 'analytic' | 'scan'; readonly id: string; readonly version: number; readonly transform: SceneTransform };
    readonly track: TrackRef | null;
    readonly lesson: { readonly id: string; readonly version: number; readonly path: 'full' | 'fast' } | null;
    readonly theme: { readonly id: string; readonly version: number };
    readonly settings: SonicPrefs;
    readonly assists: LessonAssists | null;
    readonly device: DeviceInfo;
    readonly consent: Consent;
    /** a random id; the nickname is optional */
    readonly pilot: { readonly id: string; readonly nickname: string | null };
    /** voice.webm starts voiceOffsetMs after t = 0 of the session clock; null without voice */
    readonly clock: { readonly startIso: string; readonly frameHz: number; readonly voiceOffsetMs: number | null };
    readonly files: readonly { readonly name: string; readonly bytes: number; readonly sha256: string }[];
}

// ------------------------------------------------------------------ survey

export type SurveyItem =
    | { readonly id: string; readonly kind: 'scale'; readonly prompt: SpeechLine; readonly min: number; readonly max: number; readonly anchors: readonly [SpeechLine, SpeechLine] }
    | { readonly id: string; readonly kind: 'choice'; readonly prompt: SpeechLine; readonly options: readonly SpeechLine[] }
    /** answered by voice into the recording; the events mark where */
    | { readonly id: string; readonly kind: 'open'; readonly prompt: SpeechLine; readonly maxSeconds: number };

/** Spoken surveys (spec section 9): first flight, returning pilot, child (Again-Again). */
export interface SurveyDef {
    readonly format: (typeof FORMATS)['survey'];
    readonly id: string;
    readonly version: number;
    readonly variant: 'first' | 'returning' | 'child';
    readonly items: readonly SurveyItem[];
}

/** survey.json of a package. */
export interface SurveyAnswers {
    readonly format: (typeof FORMATS)['answers'];
    readonly surveyId: string;
    readonly version: number;
    readonly skipped: boolean;
    readonly answers: readonly { readonly item: string; readonly value: number | null; readonly via: 'key' | 'voice' | 'skip'; readonly t: number }[];
}

// ------------------------------------------------------------------ engine and lesson runner

/** The browser's AudioContext as this file names it (structural, so the contract needs no DOM types). */
export interface AudioContextLike {
    readonly currentTime: number;
    readonly sampleRate: number;
    readonly state: string;
}

/** A one-off sound, beside the continuous layers. */
export type CueEvent =
    | { readonly kind: 'touch'; readonly material: MaterialClass; readonly dir: Vec3 | null; readonly speed: number }
    | { readonly kind: 'gate'; readonly index: number; readonly of: number }
    | { readonly kind: 'lap' }
    | { readonly kind: 'checkpoint' }
    | { readonly kind: 'reset' }
    | { readonly kind: 'fanfare' }
    | { readonly kind: 'preview'; readonly cue: CueId; readonly dir: Vec3 | null }
    /**
     * v0.13 (M41-5, emitted by the lesson runner, sounded by the cue planner): play `index` of `of` of a sound a
     * step names, `durS` long; the runner sends one per play, about a second apart, with no speech over them.
     * `dir` is listener frame, or null for the cue's own default.
     */
    | { readonly kind: 'repeat-cue'; readonly cue: CueId; readonly dir: Vec3 | null; readonly index: number; readonly of: number; readonly durS: number }
    /** v0.13 (M41-11): a counted attempt, said with a short praise line */
    | { readonly kind: 'praise' }
    /** v0.13 (M41-11): stage `index` of a long course passed (a checkpoint that ends a stage), said "Stage k passed" */
    | { readonly kind: 'stage'; readonly index: number };

/** A cue sounding now: what the recording stores and the captions may show. */
export interface ActiveCue {
    readonly id: string;
    readonly layer: LayerId;
    /** direction in the heading frame (unit), or null for a non-spatial cue */
    readonly dir: Vec3 | null;
    readonly distance: number | null;
    readonly rateHz: number | null;
    readonly pitchHz: number | null;
    /** 0 consonant .. 1 rough */
    readonly rough: number;
}

/** What the engine hears once per frame. */
export interface SonicFrameInput {
    readonly sample: FlightSample;
    readonly world: SonicWorld | null;
    /** the next gate or zone (LessonRunner.target()), or null */
    readonly target: SonicObject | null;
    /** world y of the lesson floor: the height layer's zero */
    readonly floorY: number;
}

/** Speech behind an interface, so pre-rendered clips can replace speechSynthesis later. */
export interface SpeechOut {
    speak(text: string, o: { readonly lang: Locale; readonly rate: number; readonly interrupt: boolean }): Promise<void>;
    cancel(): void;
    readonly speaking: boolean;
}

export interface SonicEngine {
    readonly state: 'idle' | 'running' | 'suspended' | 'closed';
    /** builds the graph on `ac` (made inside a user activation) and fades in over theme.master.fadeInS */
    start(ac: AudioContextLike): Promise<void>;
    suspend(): Promise<void>;
    resume(): Promise<void>;
    close(): Promise<void>;
    setTheme(theme: ThemeDef): void;
    setPrefs(prefs: SonicPrefs): void;
    setLayers(layers: LessonLayers): void;
    /** once per rendered frame (or replayed frame) */
    update(input: SonicFrameInput): void;
    cue(e: CueEvent): void;
    /** speaks (and captions) a line; other layers duck by theme.duckDb meanwhile */
    say(line: SpeechLine, o?: { readonly interrupt?: boolean }): Promise<void>;
    activeCues(): readonly ActiveCue[];
    /** every spoken line, for captions and events.jsonl */
    onSpeech: ((line: SpeechLine, text: string) => void) | null;
    /** an AudioNode before the limiter for other sounds (the simulator's motor sound); null before start */
    readonly auxInput: object | null;
}

/**
 * Runs one lesson. Pure: no DOM, no clock of its own (the samples carry time), so Node tests drive
 * it with scripted flights and a replay re-derives the same events.
 */
export interface LessonRunner {
    readonly lesson: LessonDef;
    readonly phase: 'intro' | 'flying' | 'between' | 'passed';
    step(sample: FlightSample, world: SonicWorld | null): readonly SessionEvent[];
    /** a quiz or game answer (module 0) by key or voice */
    answer(value: number, via: 'key' | 'voice', t: number): readonly SessionEvent[];
    /** where the host puts the craft (world frame) for a reset to the last checkpoint or the lesson start */
    reset(to: 'checkpoint' | 'start', t: number): { readonly pose: Pose; readonly events: readonly SessionEvent[] };
    /** the next gate or zone, for the target layer */
    target(): SonicObject | null;
    progress(): LessonProgress;
}

/**
 * What the simulator's Fly by Sound feature exposes to its other features (ShramkoGSFPV
 * FlightContext.sonic): the recorder and the replay read it; only the flight lane writes it.
 */
export interface SonicRuntime {
    readonly engine: SonicEngine;
    readonly prefs: SonicPrefs;
    readonly theme: ThemeDef;
    readonly world: SonicWorld | null;
    readonly lesson: LessonDef | null;
    readonly runner: LessonRunner | null;
    /** true: live input and the lesson stop, the caller drives the view and the engine from frames */
    playback(on: boolean): void;
}
