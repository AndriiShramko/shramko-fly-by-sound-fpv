// The target hum as a beacon (lane sonic-beacon, owner's complaint of 2026-11-10: "we do not understand where to fly"),
// flown through the cue planner frame by frame. With SonicPrefs.beacon false every plan must be the plan of the
// planner before this lane (package main b102ce6): test/fixtures/beacon-b102ce6.json holds the hash of every frame's
// plan as that planner made it from these flights and from the placement flights (test/helpers/placement.ts), all
// with the default prefs of b102ce6.
import type { CueEvent, SonicObject, SonicPrefs, Vec3 } from '../../src/contract';
import { getLesson } from '../../src/lesson';
import { defaultPrefs } from '../../src/prefs/prefs';
import { fly, held, legs, PLACEMENT_FLIGHTS, PLACEMENT_FLIGHT_IDS, type FrameRecord, type Flight, type Step } from './placement';

/** The craft's place in the bearing flights: hovering, nose along -Z (yaw 0). */
export const BEACON_CRAFT: Vec3 = [0, 1.5, 0];
/** How far the target stands in the bearing flights, m. */
export const BEACON_TARGET_M = 10;
/** The bearings of the target from the nose, degrees, positive right: each held half a second. */
export const BEACON_BEARINGS = [0, 5, -5, 8, 12, -12, 45, -60, 89, -89, 91, -91, 120, -120, 150, -150, 170, 179, -179, 180] as const;
/** Frames each bearing is held. */
export const BEACON_HOLD_FRAMES = 30;

/** A ring of the course (order 0, opening along Z) at `pos`. */
export const ringAt = (pos: Vec3): SonicObject => ({ id: 'beacon-ring', shape: { kind: 'ring', diameter: 1.6, tube: 0.1 }, pos, quat: [1, 0, 0, 0], order: 0, solid: false, material: 'obstacle' });

/** Where a target at `bearingDeg` from the nose stands (yaw 0, same height as the craft). */
export function bearingPoint(bearingDeg: number, distanceM = BEACON_TARGET_M, from: Vec3 = BEACON_CRAFT): Vec3 {
    const b = (bearingDeg * Math.PI) / 180;
    return [from[0] + Math.sin(b) * distanceM, from[1], from[2] - Math.cos(b) * distanceM];
}

const layers = getLesson('rings-heights').layers;

/** The target at each bearing in turn, the craft hovering. */
function bearings(): Flight {
    const steps: Step[] = [];
    for (const b of BEACON_BEARINGS) steps.push(...held(BEACON_CRAFT, 0, BEACON_HOLD_FRAMES / 60, ringAt(bearingPoint(b))));
    return { theme: 'soft', layers, world: null, floorY: 0, steps };
}

/** The craft turns once round on the spot in 6 s, the target 10 m ahead of its first heading and 2 m above. */
function turn(): Flight {
    const target = ringAt([0, 3.5, -10]);
    const steps: Step[] = Array.from({ length: 360 }, (_, i) => ({ pos: BEACON_CRAFT, vel: [0, 0, 0] as Vec3, yawDeg: i - 180, target }));
    return { theme: 'soft', layers, world: null, floorY: 0, steps };
}

/** The craft flies 1 m left of a ring and on past it at 2 m/s, the ring staying the target (ahead, beside, behind). */
function pass(): Flight {
    const target = ringAt([1, 1.5, 0]);
    return { theme: 'soft', layers, world: null, floorY: 0, steps: legs([[0, 1.5, 10], [0, 1.5, -10]], 2, 0, () => target) };
}

/** The previews and plays of the hum and of "off course", from ahead, the side and behind. */
function previews(): Flight {
    const events: readonly (readonly CueEvent[])[] = [
        [{ kind: 'preview', cue: 'target.hum', dir: null }],
        [{ kind: 'repeat-cue', cue: 'target.hum', dir: [0, 0, 1], index: 1, of: 3, durS: 2.5 }],
        [{ kind: 'repeat-cue', cue: 'target.hum', dir: [-0.5, 0, 0.8660254037844386], index: 2, of: 3, durS: 2.5 }],
        [{ kind: 'preview', cue: 'target.off', dir: [1, 0, 0] }]
    ];
    const steps: Step[] = [];
    for (const e of events) {
        const block = held(BEACON_CRAFT, 0, 3.2);
        steps.push({ ...(block[0] as Step), events: e }, ...block.slice(1));
    }
    return { theme: 'soft', layers, world: null, floorY: 0, steps };
}

export const BEACON_FLIGHTS = {
    'beacon-bearings': bearings,
    'beacon-turn': turn,
    'beacon-pass': pass,
    'beacon-previews': previews
} as const;
export type BeaconFlightId = keyof typeof BEACON_FLIGHTS;
/** Every flight the fixture holds: the beacon flights and the placement flights. */
export const BEACON_FIXTURE_IDS: readonly string[] = [...Object.keys(BEACON_FLIGHTS), ...PLACEMENT_FLIGHT_IDS];

/** Flies a beacon or placement flight with these prefs. */
export function flyBeaconFixture(id: string, prefs: SonicPrefs): FrameRecord[] {
    const make = (BEACON_FLIGHTS as Record<string, () => Flight>)[id] ?? (PLACEMENT_FLIGHTS as Record<string, () => Flight>)[id];
    if (make === undefined) throw new Error(`no flight ${id}`);
    return fly(make(), prefs);
}

/** The prefs the fixture was made with: b102ce6's defaults; `beacon` added by the caller. */
export function b102ce6Prefs(): SonicPrefs {
    const { beacon: _drop, ...rest } = defaultPrefs() as SonicPrefs & { beacon?: boolean };
    return rest as SonicPrefs;
}
