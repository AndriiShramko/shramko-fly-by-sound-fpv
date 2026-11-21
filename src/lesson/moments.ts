// Moments (train 4, lane tutor-moment; the pilot's feedback, point 2): a sound is taught at the action it belongs to.
// The flight freezes, the other sounds go quiet, the sound's `what` line is said, the sound plays alone (far, then near),
// the `do` line is said, the flight goes on and the pilot does the task; a short success sound and at most three words.
// Until a sound is taught its cue is not audible. Pure: no DOM, no clock of its own (the runner hands it the time).
//
// The order of one moment (decision 4 of the brief):
//   freeze      RunnerAction 'moment' (non-null: the host holds the craft and keeps stepping frames), 'audible' [cue]
//   what        `cue.<cue>.what` (guide 'new': `cue.<cue>.name`), said; nothing else waits on it
//   sound       the forms alone, one after the other, once every line handed has been said: no speech over them
//   do          the moment's `do` line (not with guide 'new', not after "again" in the task)
//   resume      'moment' null, 'audible' with the cue; the attempt's clock leaves the frozen time out
//   task        the task's goal tracked over the flight; no success in `hintAfterS`: the hint once (guide 'full' only)
//   done        the praise cue and `moment.done` (at most three words); a moment without a task is done at resume
// Keys (LessonSession.momentKey): 'again' plays the forms again (in the task the flight freezes for them), 'on' goes on
// (frozen: the flight goes on now; in the task: the moment ends), 'know' ("I know this"): the cue is known, no task.
import type { CueId, FlightSample, Goal, GuideLevel, LessonDef, MomentDef, MomentView, MomentWhen, SessionEvent, SonicWorld, SpeechLine, Vec3 } from '../contract';
import { CUE_IDS } from '../i18n/catalog';
import { headingBasis } from '../sense/frame';
import { findFreeWay } from '../sense/freeway';
import type { GoalTracker } from './goals';
import type { MomentKey, RunnerAction } from './runner';

/** The forms of one moment together: 2-3 s (decision 4). */
export const MOMENT_FORMS_MIN_S = 2;
export const MOMENT_FORMS_MAX_S = 3;
/** The silence between two forms of a moment, s: the near form is heard as a second play, not as the far one going on. */
export const MOMENT_FORM_GAP_S = 0.25;
/** The craft's radius the free way is looked for with in a 'free' moment, m (the sampler's default body). */
export const MOMENT_BODY_RADIUS_M = 0.15;

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

/** What a flying frame tells a moment's `when`. */
export interface MomentFrame {
    readonly sample: FlightSample;
    readonly world: SonicWorld | null;
    /** world y of the floor */
    readonly floorY: number;
    /** how far the gate that counts next is, m; null without one */
    readonly gateM: number | null;
    /** gates passed in the lesson so far */
    readonly gatesPassed: number;
}

/** The listener-frame directions of a 'near' moment (x right, y up, -z ahead); 'side' is either side. */
const NEAR_DIRS: Readonly<Record<Extract<MomentWhen, { kind: 'near' }>['dir'], readonly Vec3[]>> = {
    front: [[0, 0, -1]],
    side: [
        [-1, 0, 0],
        [1, 0, 0]
    ],
    up: [[0, 1, 0]],
    down: [[0, -1, 0]]
};

/** A listener-frame direction in the world, by the craft's heading (the frame the cue events use). */
function toWorld(yawDeg: number, d: Vec3): Vec3 {
    const b = headingBasis(yawDeg);
    return [b.right[0] * d[0] + b.up[0] * d[1] + b.back[0] * d[2], b.right[1] * d[0] + b.up[1] * d[1] + b.back[1] * d[2], b.right[2] * d[0] + b.up[2] * d[1] + b.back[2] * d[2]];
}

/** The moment's action is happening in this frame. */
export function whenMet(when: MomentWhen, f: MomentFrame): boolean {
    const s = f.sample;
    switch (when.kind) {
        case 'start':
            return true;
        case 'near':
            return f.world !== null && NEAR_DIRS[when.dir].some((d) => f.world?.castRay(s.pos, toWorld(s.yawDeg, d), when.withinM) != null);
        case 'free':
            return findFreeWay(s, f.world, 'heading', { bodyRadiusM: MOMENT_BODY_RADIUS_M }) !== null;
        case 'gate':
            return f.gateM !== null && f.gateM <= when.withinM;
        case 'passed':
            return f.gatesPassed > 0;
        case 'speed':
            return Math.hypot(s.vel[0], s.vel[1], s.vel[2]) > when.aboveMps;
        case 'height':
            return s.pos[1] - f.floorY > when.aboveM;
    }
}

/** What the machine needs of the runner. */
export interface MomentHost {
    /** hands lines to the speech queue; the batch's number */
    say(lines: readonly SpeechLine[], t: number): number;
    /** the batch has been said (or the longest wait for it ran out) */
    said(batch: number, t: number): boolean;
    /** a line handed is still being said */
    speaking(t: number): boolean;
    act(a: RunnerAction): void;
    emit(e: SessionEvent): void;
    /** the sound's one name, in the pilot's language */
    name(cue: CueId): string;
    /** a tracker of a task (a goal of the lesson kinds), on the lesson's world */
    tracker(goal: Goal): GoalTracker;
    /** the flight was frozen this long: the attempt's clock leaves it out, the next frame is not measured against the last */
    frozeFor(ms: number): void;
}

interface Active {
    readonly def: MomentDef;
    phase: MomentView['phase'];
    form: number;
    /** the batch of the line said in 'what' or 'do' */
    batch: number;
    /** the end of the form playing, ms; null before the first form of a play */
    playEnd: number | null;
    /** since when the flight is frozen; null while it flies */
    frozenAt: number | null;
    /** the forms are heard again from the task: no `do` line after them */
    again: boolean;
    taskT0: number;
    hinted: boolean;
    tracker: GoalTracker | null;
    prev: FlightSample | null;
}

/** The moments of one lesson, one at a time, in their order. */
export class MomentMachine {
    private readonly pending: MomentDef[];
    /** the cues heard so far: known before the lesson, said "I know this" to, or taught here */
    private readonly taught: Set<CueId>;
    private readonly gated: boolean;
    private active: Active | null = null;

    constructor(
        lesson: LessonDef,
        known: readonly CueId[],
        private readonly guide: GuideLevel,
        private readonly host: MomentHost
    ) {
        this.taught = new Set(known);
        this.pending = lessonMoments(lesson).filter((m) => !this.taught.has(m.cue));
        this.gated = lessonMoments(lesson).length > 0;
    }

    /** The lesson begins: what the engine may sound (a lesson without moments sends nothing: all, as before). */
    begin(): void {
        if (this.gated) this.host.act({ kind: 'audible', cues: this.audible() });
    }

    /** The flight is frozen for a moment: the runner flies nothing (no goal, no touch, no path). */
    get frozen(): boolean {
        return this.active !== null && this.active.frozenAt !== null;
    }

    /** The next moment freezes the flight on its first frame (a 'start' moment): nothing to say "go" to yet. */
    get startsFrozen(): boolean {
        return this.active === null && this.pending[0]?.when.kind === 'start';
    }

    view(): MomentView | null {
        const a = this.active;
        return a === null ? null : { id: a.def.id, cue: a.def.cue, phase: a.phase, form: a.form };
    }

    /** The cues the engine may sound now: every cue but the ones still to teach; while frozen, the new one alone. */
    audible(): readonly CueId[] | null {
        if (!this.gated) return null;
        const a = this.active;
        if (a !== null && a.frozenAt !== null) return [a.def.cue];
        const ahead = new Set(this.pending.map((m) => m.cue).filter((c) => !this.taught.has(c)));
        return CUE_IDS.filter((c) => !ahead.has(c));
    }

    /** A flying frame: the next moment begins when its action happens; the task of the one running is tracked. */
    frame(f: MomentFrame, t: number): void {
        const a = this.active;
        if (a === null) {
            const next = this.pending[0];
            if (next !== undefined && whenMet(next.when, f)) {
                this.pending.shift();
                this.freeze(next, t);
            }
            return;
        }
        if (a.frozenAt !== null) this.tick(t);
        else this.task(a, f.sample, t);
    }

    /** The frozen part runs on as speech ends and time passes. */
    tick(t: number): void {
        for (let guard = 0; guard < 8; guard++) {
            const a = this.active;
            if (a === null || a.frozenAt === null) return;
            if (a.phase === 'what') {
                if (!this.host.said(a.batch, t)) return;
                a.phase = 'sound';
                a.form = 0;
                a.playEnd = null;
            } else if (a.phase === 'sound') {
                const forms = a.def.forms;
                if (a.playEnd === null) {
                    // nothing is said over the new sound
                    if (this.host.speaking(t)) return;
                    this.play(a, 0, t);
                    return;
                }
                if (t < a.playEnd + MOMENT_FORM_GAP_S * 1000) return;
                if (a.form + 1 < forms.length) {
                    this.play(a, a.form + 1, t);
                    return;
                }
                if (a.again || this.guide === 'new') {
                    this.resume(a, t);
                    return;
                }
                a.phase = 'do';
                a.batch = this.host.say([a.def.do], t);
                this.host.act({ kind: 'moment', moment: this.view() });
            } else if (a.phase === 'do') {
                if (!this.host.said(a.batch, t)) return;
                this.resume(a, t);
                return;
            } else return;
        }
    }

    /** A key of the moment; false when no moment runs (nothing happens). */
    key(k: MomentKey, t: number): boolean {
        const a = this.active;
        if (a === null) return false;
        if (k === 'again') {
            if (a.frozenAt === null) {
                // in the task: the flight freezes for the forms, then goes on (the `do` line is not said again)
                a.frozenAt = t;
                a.again = true;
                this.host.emit({ t, kind: 'moment', id: a.def.id, what: 'freeze' });
                this.host.act({ kind: 'audible', cues: [a.def.cue] });
            }
            a.phase = 'sound';
            a.form = 0;
            a.playEnd = null;
            this.host.act({ kind: 'moment', moment: this.view() });
            this.tick(t);
        } else if (k === 'on') {
            if (a.frozenAt !== null) this.resume(a, t);
            else this.finish(a, t, null);
        } else {
            this.taught.add(a.def.cue);
            this.host.emit({ t, kind: 'moment', id: a.def.id, what: 'known' });
            if (a.frozenAt !== null) this.thaw(a, t);
            this.finish(a, t, null);
            this.host.act({ kind: 'audible', cues: this.audible() });
        }
        return true;
    }

    /**
     * The pilot leaves the lesson (RunnerAction 'go'): a frozen flight goes on and the engine may sound every cue again,
     * so the next lesson starts from nothing held (a lesson without moments sends no 'audible' of its own).
     */
    leave(): void {
        const a = this.active;
        this.active = null;
        if (a !== null && a.frozenAt !== null) this.host.act({ kind: 'moment', moment: null });
        if (this.gated) this.host.act({ kind: 'audible', cues: null });
    }

    /** The flight was paused (the lesson menu) for `ms`: every clock of the moment moves on by it. */
    shift(ms: number): void {
        const a = this.active;
        if (a === null) return;
        if (a.playEnd !== null) a.playEnd += ms;
        if (a.frozenAt !== null) a.frozenAt += ms;
        a.taskT0 += ms;
    }

    private freeze(def: MomentDef, t: number): void {
        const a: Active = { def, phase: 'what', form: 0, batch: 0, playEnd: null, frozenAt: t, again: false, taskT0: t, hinted: false, tracker: null, prev: null };
        this.active = a;
        this.host.emit({ t, kind: 'moment', id: def.id, what: 'freeze' });
        this.host.act({ kind: 'audible', cues: [def.cue] });
        const line: SpeechLine = this.guide === 'new' ? { key: `cue.${def.cue}.name` } : { key: `cue.${def.cue}.what`, params: { sound: this.host.name(def.cue) } };
        a.batch = this.host.say([line], t);
        this.host.act({ kind: 'moment', moment: this.view() });
    }

    private play(a: Active, i: number, t: number): void {
        const form = a.def.forms[i];
        if (form === undefined) return;
        a.form = i;
        a.playEnd = t + form.durS * 1000;
        this.host.act({ kind: 'moment', moment: this.view() });
        this.host.act({ kind: 'cue', event: { kind: 'repeat-cue', cue: a.def.cue, dir: form.dir, index: i + 1, of: a.def.forms.length, durS: form.durS, distanceM: form.distanceM } });
    }

    /** The flight goes on (the frozen time is left out of the attempt's clock). */
    private thaw(a: Active, t: number): void {
        const at = a.frozenAt ?? t;
        a.frozenAt = null;
        this.host.frozeFor(Math.max(0, t - at));
        this.host.emit({ t, kind: 'moment', id: a.def.id, what: 'resume' });
        this.host.act({ kind: 'moment', moment: null });
    }

    private resume(a: Active, t: number): void {
        const again = a.again;
        const frozenMs = Math.max(0, t - (a.frozenAt ?? t));
        this.thaw(a, t);
        this.taught.add(a.def.cue);
        this.host.act({ kind: 'audible', cues: this.audible() });
        a.phase = 'task';
        a.prev = null;
        if (again) {
            // heard again from the task: the task goes on where it was, its time to the hint without the frozen part
            a.again = false;
            a.taskT0 += frozenMs;
            return;
        }
        a.taskT0 = t;
        a.tracker = a.def.task === null ? null : this.host.tracker(a.def.task);
        if (a.tracker === null) this.finish(a, t, 'learned');
    }

    private task(a: Active, s: FlightSample, t: number): void {
        const tracker = a.tracker;
        if (tracker !== null && a.def.task !== null) {
            const outcome = tracker.step(s, a.prev ?? s);
            a.prev = s;
            if (outcome === 'met') {
                this.host.act({ kind: 'cue', event: { kind: 'praise' } });
                if (this.guide !== 'new') this.host.say([{ key: 'moment.done' }], t);
                this.finish(a, t, 'learned');
                return;
            }
            // missed (a hold that ran out, a stop too far): the task again, the hint stays once
            if (outcome === 'missed') a.tracker = this.host.tracker(a.def.task);
        }
        if (!a.hinted && this.guide === 'full' && t - a.taskT0 >= a.def.hintAfterS * 1000) {
            a.hinted = true;
            this.host.say([a.def.hint], t);
            this.host.emit({ t, kind: 'moment', id: a.def.id, what: 'hint' });
        }
    }

    private finish(a: Active, t: number, how: 'learned' | null): void {
        if (how !== null) this.host.emit({ t, kind: 'moment', id: a.def.id, what: how });
        this.host.emit({ t, kind: 'moment', id: a.def.id, what: 'done' });
        a.phase = 'done';
        this.active = null;
    }
}
