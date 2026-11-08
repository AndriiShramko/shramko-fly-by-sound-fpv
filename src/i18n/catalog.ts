// The list of every string key the four locale files must contain, and nothing else. The parity
// test (test/locales.test.ts) holds each file to this list, in this order, so a text cannot be
// missing in one language or left over after a lesson or a cue is removed. Lessons and the lesson
// runner (step 8) take their SpeechLines from here: a lesson id that is not in LESSONS has no text.
//
// Key patterns
//   cue.<layer>.<name>.name | .glossary     one line to name a cue, one to describe it
//   layer.<id>.name                         the seven layers, for the settings menu
//   dir.<sector>                            a stand-alone phrase that says where something is
//   module.<0..7>.name
//   theme.<id>.name | .what                 the three shipped themes (an exported custom theme has its own name)
//   lesson.<id>.title | intro.<n> | goal.<n> | pass | retry | hint.<n>
//   everything else is listed in FREE_KEYS
//   survey.item.<id> | survey.anchor.<name> | survey.opt.<name>     derived from src/survey/defs.ts
//
// Parameters (documented here, checked for parity): {key} is a key label supplied by the host,
// {label} {layer} {name} {title} are texts, {n} {total} {seconds} {metres} are numbers (a plural
// block where the language needs one), {time} is a duration made by Translator.duration.
import { LAYER_IDS, MODULES, SECTORS, type ModuleId } from '../contract';
import { surveyKeys } from '../survey/defs';

/** Cue ids, `<layer>.<name>`, in the order the glossary introduces them. */
export const CUE_IDS = [
    'safety.wall',
    'safety.floor',
    'safety.ceiling',
    'safety.obstacle',
    'safety.touch',
    'safety.reset',
    'height.tone',
    'height.rough',
    'speed.tick',
    'target.hum',
    'target.off',
    'target.note',
    'target.lap',
    'target.checkpoint',
    'target.fanfare',
    'shape.ring',
    'shape.square',
    'shape.cube',
    'shape.pillar',
    'room.bed'
] as const;
export type KnownCueId = (typeof CUE_IDS)[number];

export const THEME_IDS = ['soft', 'clear', 'race'] as const;

export interface LessonSpec {
    readonly id: string;
    readonly module: ModuleId;
    /** number of spoken intro lines */
    readonly intro: number;
    /** number of spoken goal lines */
    readonly goals: number;
    /** number of hint lines */
    readonly hints: number;
}

/** The lesson ladder of spec section 3, in order. Which of them form the fast path is decided by the lesson files. */
export const LESSONS: readonly LessonSpec[] = [
    { id: 'ears-headphones', module: 0, intro: 2, goals: 1, hints: 1 },
    { id: 'ears-glossary', module: 0, intro: 2, goals: 1, hints: 1 },
    { id: 'ears-walls', module: 0, intro: 2, goals: 1, hints: 1 },
    { id: 'ears-shapes', module: 0, intro: 2, goals: 1, hints: 1 },
    { id: 'ears-game', module: 0, intro: 3, goals: 1, hints: 1 },
    { id: 'hover-height', module: 1, intro: 2, goals: 1, hints: 1 },
    { id: 'hover-turn', module: 1, intro: 2, goals: 1, hints: 1 },
    { id: 'move-speed', module: 2, intro: 2, goals: 1, hints: 1 },
    { id: 'move-stop', module: 2, intro: 2, goals: 1, hints: 1 },
    { id: 'walls-hall', module: 3, intro: 3, goals: 1, hints: 1 },
    { id: 'walls-pillar', module: 3, intro: 2, goals: 1, hints: 1 },
    { id: 'walls-row', module: 3, intro: 2, goals: 1, hints: 1 },
    { id: 'corridor', module: 4, intro: 3, goals: 2, hints: 1 },
    { id: 'rings-first', module: 5, intro: 3, goals: 1, hints: 1 },
    { id: 'rings-line', module: 5, intro: 2, goals: 1, hints: 1 },
    { id: 'rings-small', module: 5, intro: 2, goals: 1, hints: 1 },
    { id: 'rings-course', module: 5, intro: 2, goals: 1, hints: 1 },
    { id: 'shapes-square', module: 6, intro: 2, goals: 1, hints: 1 },
    { id: 'shapes-series', module: 6, intro: 2, goals: 1, hints: 1 },
    { id: 'shapes-cube', module: 6, intro: 3, goals: 1, hints: 1 },
    { id: 'free-garden', module: 7, intro: 3, goals: 1, hints: 1 }
];

/** Keys of one lesson, in the order of the locale files. */
export function lessonKeys(spec: LessonSpec): string[] {
    const p = `lesson.${spec.id}.`;
    const out = [`${p}title`];
    for (let i = 1; i <= spec.intro; i++) out.push(`${p}intro.${i}`);
    for (let i = 1; i <= spec.goals; i++) out.push(`${p}goal.${i}`);
    out.push(`${p}pass`, `${p}retry`);
    for (let i = 1; i <= spec.hints; i++) out.push(`${p}hint.${i}`);
    return out;
}

/** Keys that belong to no catalogue above, grouped as the locale files group them. */
export const FREE_KEYS = [
    // the sound glossary (lesson ears-glossary, key G)
    'glossary.intro',
    'glossary.next',
    'glossary.done',
    'glossary.again',
    // the headphone check (lesson ears-headphones)
    'headphones.intro',
    'headphones.q-side',
    'headphones.q-front-back',
    'headphones.good',
    'headphones.swapped',
    'headphones.unclear',
    'headphones.wired',
    'headphones.volume',
    'headphones.os-spatial',
    // the game "what is it, where is it, is it moving"
    'quiz.intro',
    'quiz.howto',
    'quiz.q-what',
    'quiz.q-where',
    'quiz.q-moving',
    'quiz.moving',
    'quiz.still',
    'quiz.right',
    'quiz.wrong',
    'quiz.score',
    'quiz.option',
    'quiz.where-options',
    'quiz.skip',
    // narration before a sound is previewed
    'narrate.coming',
    // spoken menus
    'menu.welcome',
    'menu.main.title',
    'menu.main.continue',
    'menu.main.start',
    'menu.main.lessons',
    'menu.main.path-fast',
    'menu.main.path-full',
    'menu.main.glossary',
    'menu.main.settings',
    'menu.main.recording',
    'menu.main.quit',
    'menu.item',
    'menu.back',
    'menu.lessons.title',
    'menu.lesson.new',
    'menu.lesson.current',
    'menu.lesson.passed',
    'menu.path.fast-what',
    'menu.path.full-what',
    'menu.settings.title',
    'menu.setting.theme',
    'menu.setting.calm',
    'menu.setting.calm-what',
    'menu.setting.polarity',
    'menu.setting.volume',
    'menu.setting.pitch',
    'menu.setting.speech-rate',
    'menu.setting.captions',
    'menu.setting.screen-reader',
    'menu.setting.frame',
    'menu.setting.motor',
    'menu.value.on',
    'menu.value.off',
    'menu.value.up-higher',
    'menu.value.up-lower',
    'menu.value.heading',
    'menu.value.body',
    'menu.change.louder',
    'menu.change.quieter',
    'menu.change.higher',
    'menu.change.lower',
    'menu.change.faster',
    'menu.change.slower',
    'menu.change.limit',
    'menu.hearing-note',
    // the keys, spoken (the host supplies {key})
    'help.intro',
    'help.record',
    'help.send',
    'help.status',
    'help.repeat',
    'help.glossary',
    'help.reset',
    'help.next',
    'help.digits',
    // recording
    'rec.ask',
    'rec.started',
    'rec.stopped',
    'rec.mic-denied',
    'rec.minor',
    'rec.saved',
    'rec.recover',
    'rec.off',
    // sending and delivery
    'send.ask',
    'send.confirm',
    'send.sending',
    'send.stored',
    'send.delivered',
    'send.partial-telegram',
    'send.partial-email',
    'send.failed',
    'send.retry',
    'send.by-voice',
    'send.speech-note',
    'send.none',
    'send.cancelled',
    // status (key I)
    'status.recording-on',
    'status.recording-off',
    'status.lesson',
    'status.none',
    'status.theme',
    // in flight
    'fly.ready',
    'fly.go',
    'fly.checkpoint',
    'fly.reset-checkpoint',
    'fly.reset-start',
    'fly.gate',
    'fly.lap',
    'fly.paused',
    'fly.resumed',
    'fly.step-passed',
    'fly.next-step',
    'fly.attempt',
    'fly.time',
    'fly.best-time',
    'fly.touches',
    // after failed attempts in a row: the offer to go on, and a lesson that does not block moving on
    'fly.offer-next',
    'fly.moving-on',
    // why an attempt was not counted (each goal's reason, the time limit, touches)
    'reason.time',
    'reason.height-never-low',
    'reason.height-never-high',
    'reason.height-high',
    'reason.height-low',
    'reason.turn-hold',
    'reason.turn-behind',
    'reason.turn-left',
    'reason.turn-right',
    'reason.zone-past',
    'reason.zone-short',
    'reason.zone-no-stop',
    'reason.stop-none',
    'reason.stop-far',
    'reason.around',
    'reason.distance',
    'reason.gate-missed',
    'reason.gates',
    'reason.touches',
    'reason.touches-none',
    // durations (Translator.duration)
    'time.minutes',
    'time.seconds',
    // surveys: framing (the items are derived from src/survey/defs.ts)
    'survey.intro.first',
    'survey.intro.returning',
    'survey.intro.child',
    'survey.mic-on',
    'survey.offer',
    'survey.howto',
    'survey.howto-voice',
    'survey.question-of',
    'survey.repeat-hint',
    'survey.open-howto',
    'survey.skipped',
    'survey.thanks'
] as const;

/** All keys the locale files hold, in file order. */
export function requiredKeys(): string[] {
    const keys: string[] = ['app.name'];
    for (const id of CUE_IDS) keys.push(`cue.${id}.name`, `cue.${id}.glossary`);
    for (const id of LAYER_IDS) keys.push(`layer.${id}.name`);
    for (const s of SECTORS) keys.push(`dir.${s}`);
    for (const m of MODULES) keys.push(`module.${m}.name`);
    for (const t of THEME_IDS) keys.push(`theme.${t}.name`, `theme.${t}.what`);
    for (const spec of LESSONS) keys.push(...lessonKeys(spec));
    keys.push(...FREE_KEYS);
    keys.push(...surveyKeys());
    return keys;
}
