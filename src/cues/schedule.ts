// Pulses, ticks and hum repetitions are placed on the audio clock with lookahead (the "two clocks"
// pattern): whatever wakes the engine (a frame, a timer) asks which pulses fall before now +
// lookahead and schedules exactly those, at their exact times. A late wake-up never shifts a pulse;
// it can only be skipped. Pure: the engine owns one PulseTrain per rhythmic voice.

/** How far ahead of the audio clock pulses are placed, s. Longer than a frame, shorter than a reaction. */
export const LOOKAHEAD_S = 0.1;
/** A train that fell this far behind (the tab slept, a frame hitched) skips its missed pulses instead of playing them in a burst, s. */
export const MAX_CATCH_UP_S = 0.03;
/** The first pulse of a new train comes this long after now, so it is never scheduled in the past, s. */
export const START_DELAY_S = 0.005;

export interface PulseTrain {
    /** audio time of the last pulse placed, or null before the first */
    last: number | null;
}

export function createPulseTrain(): PulseTrain {
    return { last: null };
}

/**
 * The pulse times to place now, in order: every pulse before `horizon` (= now + lookahead). The
 * interval between two pulses is the period current when the later one is placed, so a quicker
 * period takes effect at the very next pulse, never after the old, slower one has run out. A
 * period of 0 or less, or not finite, stops the train (it starts again with a fresh first pulse).
 */
export function duePulses(train: PulseTrain, now: number, horizon: number, periodS: number): number[] {
    if (!(periodS > 0) || !Number.isFinite(periodS)) {
        train.last = null;
        return [];
    }
    let next = train.last === null ? now + START_DELAY_S : train.last + periodS;
    if (next < now - MAX_CATCH_UP_S) next = now + START_DELAY_S;
    const out: number[] = [];
    while (next < horizon) {
        out.push(next);
        train.last = next;
        next += periodS;
        if (out.length > 1000) break; // a period far below a frame: never loop forever
    }
    return out;
}

/**
 * The page clock (ms, FlightSample.t) and the audio clock (s, AudioContext.currentTime) side by
 * side: the engine notes both at every frame, and an event stamped on the page clock is placed at
 * the matching audio time (never in the past).
 */
export function pageToAudioTime(eventT: number, frameT: number, audioNow: number): number {
    return audioNow + Math.max(0, (eventT - frameT) / 1000);
}
