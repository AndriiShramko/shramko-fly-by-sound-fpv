// The lessons that are new in v0.13 (lane s13-worlds): no v0.12 build shipped them, so no recording or
// saved progress of theirs can be of an older version, and they start at version 1.
export const NEW_LESSONS: readonly string[] = ['tunnel-wide', 'tunnel-narrow', 'tunnel-narrower', 'tunnel-bends', 'tunnel-gaps', 'tunnel-long', 'rings-heights'];

// The speed lessons of train 3 (sonic3 Z7): drills on rings-course's known ring course at rising caps, the racing line and the
// stream budget on. They are no room lessons (their slow caps on 7 m legs are the point), and no v0.12 build shipped them.
export const SPEED_LESSONS: readonly string[] = ['speed-1', 'speed-2', 'speed-3', 'speed-4'];

// The lesson of train 3 that teaches a small turn to tell front from back (sonic3 S3, the consultant's advice): a copy of
// hover-turn with the ring behind; no v0.12 build shipped it.
export const TURN_LESSONS: readonly string[] = ['turn-listen'];
