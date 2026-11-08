// The comparer of the replay core: what the replay re-derived against what the recording holds, with
// tolerances (the recording keeps 30 Hz frames, the live run saw about 60 Hz, so a crossing is seen
// up to a frame later and a position differs by what the craft moved meanwhile).
//
// Events are compared kind by kind (COMPARED_KINDS): the two lists are aligned by what each event IS
// (lesson step, goal, gate id, touch material, answer, spoken key) so that a missing or an extra
// event does not shift the rest, then every aligned pair must agree in time and in its numbers.
// `speech` is held to a subsequence rule: every line the lesson runner asked for must be in the
// recording in order, but the host may have spoken more (menus, help, status). Cues are compared per
// frame as sets of ids, allowed to be off by `cueSlackFrames` frames (a cue that starts one frame
// earlier or later is not a different flight).
import type { FlightFrame, SessionEvent } from '../contract';
import type { ReplayNote } from './rebuild';
import { SPEECH_END_KEY } from './replay';

export interface Tolerances {
    /** an aligned pair of events may differ in time by this much, ms */
    readonly timeMs: number;
    /** positions and gate misses, m */
    readonly distanceM: number;
    /** touch speeds, m/s */
    readonly speedMps: number;
    /** at least this share of frames must have the recorded set of cues (within the slack) */
    readonly minCueShare: number;
    readonly cueSlackFrames: number;
}

export const DEFAULT_TOLERANCES: Tolerances = { timeMs: 100, distanceM: 0.15, speedMps: 0.3, minCueShare: 0.95, cueSlackFrames: 1 };

/** The kinds of event the replay can re-derive; session, key, recording and send events are the host's own. */
export const COMPARED_KINDS = ['lesson', 'goal', 'gate', 'touch', 'checkpoint', 'reset', 'answer', 'speech'] as const;
export type ComparedKind = (typeof COMPARED_KINDS)[number];

export interface EventDiff {
    readonly kind: ComparedKind;
    /** missing: recorded, not re-derived. extra: re-derived, not recorded. time or value: both, but too far apart. */
    readonly problem: 'missing' | 'extra' | 'time' | 'value';
    readonly recorded: SessionEvent | null;
    readonly derived: SessionEvent | null;
    readonly detail: string;
}

export interface KindCount {
    readonly recorded: number;
    readonly derived: number;
    readonly matched: number;
}

export interface EventComparison {
    /** recorded events of the compared kinds (host-only speech lines left out) */
    readonly recorded: number;
    readonly derived: number;
    /** aligned pairs within the tolerances */
    readonly matched: number;
    /** recorded speech lines the lesson runner never asked for: the host's own, not a difference */
    readonly hostOnly: number;
    /** the largest time difference among aligned pairs, ms */
    readonly maxDeltaMs: number;
    readonly byKind: Readonly<Record<ComparedKind, KindCount>>;
    readonly diffs: readonly EventDiff[];
}

export interface CueDiff {
    readonly index: number;
    readonly t: number;
    readonly recorded: readonly string[];
    readonly derived: readonly string[];
}

export interface CueComparison {
    readonly frames: number;
    /** frames whose derived set equals the recorded one */
    readonly identical: number;
    /** frames that agree within the slack (identical ones included) */
    readonly agreeing: number;
    /** agreeing / frames, 1 when there are no frames */
    readonly share: number;
    /**
     * The same share when a hazard cue counts by its kind only ('safety.wall:left' is 'safety.wall'):
     * the voices a sampler gives to borderline sectors flip with the rate it is fed at (30 Hz here, about
     * 60 Hz live), which changes the sector of a hazard voice but not what the pilot hears of it.
     */
    readonly classShare: number;
    /** the first frames that disagree beyond the slack */
    readonly mismatches: readonly CueDiff[];
}

/**
 * What the check says (v0.13). 'pass': the recording re-derives within the tolerances. 'older-build': it does not,
 * and it was recorded with an older build (a lesson or theme version lower than this build's, none higher): this
 * build cannot verify it, which says nothing against the recording ("recorded with an older build"). 'fail': it
 * does not re-derive, with the build it was recorded with or with nothing that explains why. A recording whose only
 * difference is the world's id (the same lesson and theme versions) is a 'fail': a lesson's world changes only with a
 * new lesson version, so a world changed under the same version is a defect, never an older build.
 */
export type ReplayVerdict = 'pass' | 'older-build' | 'fail';

export interface ReplayCheck {
    /** re-derived within the tolerances */
    readonly ok: boolean;
    /** v0.13: set by compareReplay; for a check put together elsewhere `replayVerdict(check)` gives it */
    readonly verdict?: ReplayVerdict;
    readonly tolerances: Tolerances;
    readonly events: EventComparison;
    readonly cues: CueComparison;
    /** false when the replay was not rebuilt from the recording's own versions */
    readonly exact: boolean;
    readonly notes: readonly ReplayNote[];
}

/** The notes that say the build is not the recording's own. */
const BUILD_NOTES: readonly ReplayNote['code'][] = ['lesson-version', 'theme-version', 'world-id', 'unknown-theme', 'no-world'];

/** The verdict of a check from what it found: see ReplayVerdict. */
export function replayVerdict(check: Pick<ReplayCheck, 'ok' | 'notes'>): ReplayVerdict {
    if (check.ok) return 'pass';
    const versions = check.notes.filter((n) => n.code === 'lesson-version' || n.code === 'theme-version');
    const older = versions.length > 0 && versions.every((n) => n.recorded !== undefined && n.here !== undefined && n.recorded < n.here);
    return older ? 'older-build' : 'fail';
}

function identity(e: SessionEvent): string {
    switch (e.kind) {
        case 'lesson':
            return `${e.lessonId}@${e.version}:${e.what}:${e.attempt}`;
        case 'goal':
            return `${e.index}:${e.what}`;
        case 'gate':
            return `${e.gateId}:${e.index}`;
        case 'touch':
            return e.material;
        case 'checkpoint':
            return e.id;
        case 'reset':
            return `${e.to}:${e.checkpointId ?? ''}`;
        case 'answer':
            return `${e.item}:${e.value ?? 'null'}:${e.via}`;
        case 'speech':
            return e.key;
        default:
            return e.kind;
    }
}

/** Events the replay can say something about: not the host-driven `leave`, not the speech-end markers. */
function comparable(e: SessionEvent): e is SessionEvent & { kind: ComparedKind } {
    if (!(COMPARED_KINDS as readonly string[]).includes(e.kind)) return false;
    if (e.kind === 'lesson' && e.what === 'leave') return false;
    if (e.kind === 'speech' && e.key === SPEECH_END_KEY) return false;
    return true;
}

/** Pairs of indexes (i, j) with equal identities, in order, as long as possible (longest common subsequence). */
function align(a: readonly string[], b: readonly string[]): [number, number][] {
    const n = a.length;
    const m = b.length;
    const pairs: [number, number][] = [];
    if (n * m > 16_000_000) {
        // too long for the table: greedy in-order matching
        let j = 0;
        for (let i = 0; i < n; i++) {
            const k = b.indexOf(a[i] as string, j);
            if (k >= 0) {
                pairs.push([i, k]);
                j = k + 1;
            }
        }
        return pairs;
    }
    const w = m + 1;
    const dp = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * w + j] = a[i] === b[j] ? (dp[(i + 1) * w + j + 1] as number) + 1 : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number);
        }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            pairs.push([i, j]);
            i++;
            j++;
        } else if ((dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number)) i++;
        else j++;
    }
    return pairs;
}

const dist3 = (a: readonly number[], b: readonly number[]): number => Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number));

function valueProblem(r: SessionEvent, d: SessionEvent, tol: Tolerances): string | null {
    if (r.kind === 'gate' && d.kind === 'gate' && Math.abs(r.missM - d.missM) > tol.distanceM) return `miss ${r.missM} m recorded, ${d.missM} m re-derived`;
    if (r.kind === 'touch' && d.kind === 'touch') {
        if (Math.abs(r.speed - d.speed) > tol.speedMps) return `speed ${r.speed} m/s recorded, ${d.speed} m/s re-derived`;
        if (dist3(r.pos, d.pos) > tol.distanceM) return `position differs by ${dist3(r.pos, d.pos).toFixed(2)} m`;
    }
    return null;
}

const emptyCount = (): { recorded: number; derived: number; matched: number } => ({ recorded: 0, derived: 0, matched: 0 });

/** Compares the recorded events with the derived ones. */
export function compareEvents(recorded: readonly SessionEvent[], derived: readonly SessionEvent[], tolerances: Tolerances = DEFAULT_TOLERANCES): EventComparison {
    const diffs: EventDiff[] = [];
    const byKind = Object.fromEntries(COMPARED_KINDS.map((k) => [k, emptyCount()])) as Record<ComparedKind, { recorded: number; derived: number; matched: number }>;
    let recordedCount = 0;
    let derivedCount = 0;
    let matched = 0;
    let hostOnly = 0;
    let maxDeltaMs = 0;
    for (const kind of COMPARED_KINDS) {
        const r = recorded.filter((e) => e.kind === kind && comparable(e));
        const d = derived.filter((e) => e.kind === kind && comparable(e));
        const pairs = align(r.map(identity), d.map(identity));
        const pairedR = new Set(pairs.map((p) => p[0]));
        const pairedD = new Set(pairs.map((p) => p[1]));
        const count = byKind[kind];
        count.derived = d.length;
        derivedCount += d.length;
        r.forEach((e, i) => {
            if (pairedR.has(i)) return;
            if (kind === 'speech') {
                hostOnly++;
                return;
            }
            count.recorded++;
            recordedCount++;
            diffs.push({ kind, problem: 'missing', recorded: e, derived: null, detail: `${identity(e)} at ${e.t} ms is recorded but the replay did not derive it` });
        });
        d.forEach((e, j) => {
            if (pairedD.has(j)) return;
            diffs.push({ kind, problem: 'extra', recorded: null, derived: e, detail: `${identity(e)} at ${e.t} ms is derived by the replay but not recorded` });
        });
        for (const [i, j] of pairs) {
            const re = r[i] as SessionEvent;
            const de = d[j] as SessionEvent;
            count.recorded++;
            recordedCount++;
            const delta = Math.abs(re.t - de.t);
            maxDeltaMs = Math.max(maxDeltaMs, delta);
            if (delta > tolerances.timeMs) {
                diffs.push({ kind, problem: 'time', recorded: re, derived: de, detail: `${identity(re)}: recorded at ${re.t} ms, re-derived at ${de.t} ms (${delta} ms apart)` });
                continue;
            }
            const v = valueProblem(re, de, tolerances);
            if (v !== null) {
                diffs.push({ kind, problem: 'value', recorded: re, derived: de, detail: `${identity(re)} at ${re.t} ms: ${v}` });
                continue;
            }
            count.matched++;
            matched++;
        }
    }
    diffs.sort((a, b) => ((a.recorded ?? a.derived) as SessionEvent).t - ((b.recorded ?? b.derived) as SessionEvent).t);
    return { recorded: recordedCount, derived: derivedCount, matched, hostOnly, maxDeltaMs, byKind, diffs };
}

const cueKey = (ids: readonly string[]): string => [...new Set(ids)].sort().join('|');
const classKey = (ids: readonly string[]): string => cueKey(ids.map((id) => id.split(':')[0] as string));

/** Compares the recorded cue ids of each frame with the derived ones. */
export function compareCues(frames: readonly FlightFrame[], derived: readonly (readonly string[])[], tolerances: Tolerances = DEFAULT_TOLERANCES): CueComparison {
    const n = Math.min(frames.length, derived.length);
    const rec = frames.slice(0, n).map((f) => cueKey(f.c));
    const der = derived.slice(0, n).map(cueKey);
    let identical = 0;
    let agreeing = 0;
    let classAgreeing = 0;
    const mismatches: CueDiff[] = [];
    const recClass = frames.slice(0, n).map((f) => classKey(f.c));
    const derClass = derived.slice(0, n).map(classKey);
    for (let i = 0; i < n; i++) {
        let classOk = false;
        for (let k = Math.max(0, i - tolerances.cueSlackFrames); k <= Math.min(n - 1, i + tolerances.cueSlackFrames) && !classOk; k++) classOk = recClass[k] === derClass[i];
        if (classOk) classAgreeing++;
        if (rec[i] === der[i]) {
            identical++;
            agreeing++;
            continue;
        }
        let ok = false;
        for (let k = Math.max(0, i - tolerances.cueSlackFrames); k <= Math.min(n - 1, i + tolerances.cueSlackFrames) && !ok; k++) ok = rec[k] === der[i];
        if (ok) agreeing++;
        else if (mismatches.length < 10) mismatches.push({ index: i, t: (frames[i] as FlightFrame).t, recorded: (frames[i] as FlightFrame).c, derived: derived[i] as readonly string[] });
    }
    return { frames: frames.length, identical, agreeing, share: n === 0 ? 1 : agreeing / n, classShare: n === 0 ? 1 : classAgreeing / n, mismatches };
}

/** The whole check: events and cues against the tolerances. */
export function compareReplay(
    recorded: { readonly events: readonly SessionEvent[]; readonly frames: readonly FlightFrame[] },
    result: { readonly derivedEvents: readonly SessionEvent[]; readonly cues: readonly (readonly string[])[]; readonly notes: readonly ReplayNote[] },
    exact: boolean,
    tolerances: Tolerances = DEFAULT_TOLERANCES
): ReplayCheck {
    const events = compareEvents(recorded.events, result.derivedEvents, tolerances);
    const cues = compareCues(recorded.frames, result.cues, tolerances);
    const ok = events.diffs.length === 0 && cues.share >= tolerances.minCueShare;
    return { ok, verdict: replayVerdict({ ok, notes: result.notes }), tolerances, events, cues, exact, notes: result.notes };
}

/**
 * The check as one line of text for a log or a report: "replay check PASS: ...", "replay check FAIL: ...", or
 * "replay check: recorded with an older build (the versions), so this build cannot verify it: ...".
 */
export function formatReplayCheck(check: ReplayCheck): string {
    const e = check.events;
    const parts: string[] = [];
    parts.push(`events ${e.matched} of ${e.recorded} re-derived (largest time difference ${e.maxDeltaMs} ms)`);
    parts.push(`cues ${(check.cues.share * 100).toFixed(1)} % of ${check.cues.frames} frames agree (${(check.cues.classShare * 100).toFixed(1)} % by cue kind)`);
    if (e.diffs.length > 0) parts.push(`${e.diffs.length} event difference${e.diffs.length === 1 ? '' : 's'}, first: ${(e.diffs[0] as EventDiff).detail}`);
    const build = check.notes.filter((n) => BUILD_NOTES.includes(n.code)).map((n) => n.message).join('; ');
    const verdict = check.verdict ?? replayVerdict(check);
    if (verdict === 'older-build') return `replay check: recorded with an older build (${build}), so this build cannot verify it: ${parts.join('; ')}`;
    if (!check.exact) parts.push(`not the recording's own build: ${build}`);
    return `replay check ${verdict === 'pass' ? 'PASS' : 'FAIL'}: ${parts.join('; ')}`;
}
