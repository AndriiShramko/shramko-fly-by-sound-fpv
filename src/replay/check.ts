// One call for the common case: a package (or anything with its manifest, frames and events) in, the
// replay check out. Rebuilds the session, replays it, compares it with the recording.
import type { FlightFrame, LessonProgress, SessionEvent, SessionManifest } from '../contract';
import { compareReplay, DEFAULT_TOLERANCES, type ReplayCheck, type Tolerances } from './compare';
import { rebuildSession, type RebuildOptions, type ReplaySetup } from './rebuild';
import { replayFlight, type ReplayResult } from './replay';

export interface CheckOptions extends RebuildOptions {
    readonly tolerances?: Partial<Tolerances>;
    /** the lesson's saved progress when the session began (see ReplayInput) */
    readonly progress?: LessonProgress | null;
    readonly seed?: number;
}

export interface SessionCheck {
    readonly setup: ReplaySetup;
    readonly result: ReplayResult;
    readonly check: ReplayCheck;
}

/** Throws ReplayError when the session cannot be rebuilt (an unknown lesson, a scan with no world given). */
export function checkSession(pkg: { readonly manifest: SessionManifest; readonly frames: readonly FlightFrame[]; readonly events: readonly SessionEvent[] }, options: CheckOptions = {}): SessionCheck {
    const setup = rebuildSession(pkg.manifest, options);
    const result = replayFlight({ setup, frames: pkg.frames, events: pkg.events, ...(options.progress === undefined ? {} : { progress: options.progress }), ...(options.seed === undefined ? {} : { seed: options.seed }) });
    const check = compareReplay(pkg, result, setup.exact, { ...DEFAULT_TOLERANCES, ...options.tolerances });
    return { setup, result, check };
}
