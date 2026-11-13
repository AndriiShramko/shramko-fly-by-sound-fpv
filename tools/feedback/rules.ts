// The rules of the difficult spots of tools/analyze.ts (ShramkoGSFPV docs/wip/voice-feedback-plan.md 5.2 step 7), in ONE
// place. EVERY number here is an ESTIMATE: nothing was measured on real recordings yet (the first run on real packages
// waits for the owner's decision); stage 2 of the plan tunes them against what the owner hears in the replay.
// Each signal has a weight (the score of a spot is the sum of its signals' weights) and a reason a person can read.

export type SignalKind =
    | 'attempt-fail'
    | 'many-attempts'
    | 'reset'
    | 'reset-burst'
    | 'skip-lesson'
    | 'answer-skip'
    | 'answer-refused'
    | 'refused-burst'
    | 'repeat'
    | 'touch'
    | 'touch-cluster'
    | 'touch-fast'
    | 'idle'
    | 'pause';

export interface FeedbackRules {
    /** weight and reason of each signal */
    readonly signals: { readonly [K in SignalKind]: { readonly weight: number; readonly reason: string } };
    /** a lesson with this many failed attempts or more is hard (estimate) */
    readonly manyAttempts: number;
    /** this many resets within resetBurstMs (estimate) */
    readonly resetBurst: number;
    readonly resetBurstMs: number;
    /** this many refused digits on one question (between two answers) (estimate) */
    readonly refusedBurst: number;
    /** this many touches within touchClusterMs (estimate) */
    readonly touchCluster: number;
    readonly touchClusterMs: number;
    /** a touch faster than this, m/s (estimate) */
    readonly touchFastMps: number;
    /** idle in an attempt: speed under idleSpeedMps and every stick within idleStick of the centre for idleMs (estimates) */
    readonly idleSpeedMps: number;
    readonly idleStick: number;
    readonly idleMs: number;
    /** a session pause longer than this, ms (estimate) */
    readonly pauseMs: number;
    /** signals closer than this merge into one spot, ms (estimate) */
    readonly mergeMs: number;
    /** a pilot remark within this window of a spot multiplies its score (estimates) */
    readonly remarkWindowMs: number;
    readonly remarkFactor: number;
    /** how many spots the page shows */
    readonly topSpots: number;
    /** how many remarks the page shows (the rest are in analysis.json) */
    readonly pageRemarks: number;
    /**
     * The echo filter: a transcript segment within echoWindowMs of a `speech` event whose text it matches with a word
     * error rate (tools/listen-words.ts) under echoWer is the app's own voice heard by the microphone (estimates; the
     * end-to-end check of test/transcribe-e2e.test.ts measured the synthetic case, see evidence/listen/VF-1-transcribe.json)
     */
    readonly echoWindowMs: number;
    readonly echoWer: number;
}

export const RULES: FeedbackRules = {
    signals: {
        'attempt-fail': { weight: 1, reason: 'an attempt failed' },
        'many-attempts': { weight: 2, reason: 'many failed attempts in one lesson' },
        reset: { weight: 1, reason: 'the pilot reset' },
        'reset-burst': { weight: 2, reason: 'resets close together' },
        'skip-lesson': { weight: 2, reason: 'the lesson was left without a pass' },
        'answer-skip': { weight: 1, reason: 'a question was left unanswered (timed out)' },
        'answer-refused': { weight: 1, reason: 'a key the question does not take' },
        'refused-burst': { weight: 2, reason: 'several refused keys on one question' },
        repeat: { weight: 1, reason: 'the pilot asked to hear the line again' },
        touch: { weight: 0.5, reason: 'a touch' },
        'touch-cluster': { weight: 2, reason: 'touches close together' },
        'touch-fast': { weight: 1, reason: 'a fast touch' },
        idle: { weight: 2, reason: 'no movement for a long time in an attempt (lost?)' },
        pause: { weight: 1, reason: 'a long pause' }
    },
    manyAttempts: 3,
    resetBurst: 2,
    resetBurstMs: 30000,
    refusedBurst: 2,
    touchCluster: 3,
    touchClusterMs: 10000,
    touchFastMps: 2,
    idleSpeedMps: 0.2,
    idleStick: 0.1,
    idleMs: 8000,
    pauseMs: 20000,
    mergeMs: 10000,
    remarkWindowMs: 5000,
    remarkFactor: 2,
    topSpots: 5,
    pageRemarks: 15,
    echoWindowMs: 3000,
    echoWer: 0.4
};
