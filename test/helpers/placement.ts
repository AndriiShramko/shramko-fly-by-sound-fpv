// The placement of the cues that mean up or down, flown through the cue planner frame by frame (lane s13-elev,
// owner's message 42): scripted flights and previews whose plans the elevation tests compare. With the up/down
// direction off the plans must be v0.13's exactly: test/fixtures/placement-v013.json holds the hash of every frame's
// plan as the v0.13 planner (main 16c01a1, before this lane) made it from the same flights.
//
// A frame's record is everything the planner hands the engine for that frame: the moving voices (direction, notes,
// rhythm, level, filter, the shape trace), the voices it dropped, the height, speed and room plans, the urgency, the
// active cues, the free way (its v0.13 fields) and the notes of the one-off events sent at that frame.
import type { CueEvent, FlightSample, LessonLayers, SonicObject, SonicPrefs, SonicWorld, Vec3 } from '../../src/contract';
import { CuePlanner, type FramePlan, type NotePlan } from '../../src/cues';
import { courseGates, getLesson, toLocal, worldCheckpoints } from '../../src/lesson';
import { defaultPrefs } from '../../src/prefs/prefs';
import { getBuiltinTheme, type BuiltinThemeId } from '../../src/theme';
import { canonicalJson, sha256Hex } from '../../src/util';
import { quatRotate, yawQuat } from '../../src/util/vec';
import { createAnalyticWorld, type AnalyticWorldInfo } from '../../src/world';

export const FRAME_MS = 1000 / 60;

export interface FrameRecord {
    readonly t: number;
    readonly pos: Vec3;
    readonly yawDeg: number;
    readonly plan: FramePlan;
    readonly notes: readonly NotePlan[];
}

/** One frame of a scripted flight: where the craft is, how it moves, what the target is, which events come now. */
interface Step {
    readonly pos: Vec3;
    readonly vel: Vec3;
    readonly yawDeg: number;
    readonly target: SonicObject | null;
    readonly events?: readonly CueEvent[];
}

interface Flight {
    readonly theme: BuiltinThemeId;
    readonly layers?: LessonLayers;
    readonly world: SonicWorld | null;
    readonly floorY: number;
    readonly steps: readonly Step[];
}

const sample = (t: number, s: Step): FlightSample => ({ t, tick: Math.round(t), pos: s.pos, vel: s.vel, quat: yawQuat(s.yawDeg), rate: [0, 0, 0], yawDeg: s.yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false });

/** Flies `flight` through one planner with `prefs`: one record a frame. */
function fly(flight: Flight, prefs: SonicPrefs): FrameRecord[] {
    const planner = new CuePlanner({ theme: getBuiltinTheme(flight.theme), prefs, ...(flight.layers === undefined ? {} : { layers: flight.layers }) });
    const out: FrameRecord[] = [];
    flight.steps.forEach((s, i) => {
        const t = i * FRAME_MS;
        const input = { sample: sample(t, s), world: flight.world, target: s.target, floorY: flight.floorY };
        // a one-off event is sent between frames, as a host does: after the frame before it was planned
        const notes = (s.events ?? []).flatMap((e) => planner.cue(e, t));
        out.push({ t, pos: s.pos, yawDeg: s.yawDeg, plan: planner.plan(input), notes });
    });
    return out;
}

/** Straight legs between points at `speed` m/s, nose along each horizontal leg (held when the leg is vertical). */
function legs(points: readonly Vec3[], speed: number, startYaw: number, target: (pos: Vec3) => SonicObject | null = () => null): Step[] {
    const out: Step[] = [];
    let yaw = startYaw;
    for (let k = 0; k + 1 < points.length; k++) {
        const a = points[k] as Vec3;
        const b = points[k + 1] as Vec3;
        const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        if (len < 1e-9) continue;
        if (Math.hypot(d[0], d[2]) > 1e-6) yaw = (Math.atan2(d[0], -d[2]) * 180) / Math.PI;
        const vel: Vec3 = [(d[0] / len) * speed, (d[1] / len) * speed, (d[2] / len) * speed];
        const n = Math.max(1, Math.round((len / speed) * 60));
        for (let i = 0; i < n; i++) {
            const u = i / n;
            const pos: Vec3 = [a[0] + d[0] * u, a[1] + d[1] * u, a[2] + d[2] * u];
            out.push({ pos, vel, yawDeg: yaw, target: target(pos) });
        }
    }
    return out;
}

const held = (pos: Vec3, yawDeg: number, seconds: number, target: SonicObject | null = null): Step[] => Array.from({ length: Math.round(seconds * 60) }, () => ({ pos, vel: [0, 0, 0] as Vec3, yawDeg, target }));

function lessonWorld(id: string): AnalyticWorldInfo {
    const w = getLesson(id).world;
    if (w.kind !== 'analytic') throw new Error(`${id} has no analytic world`);
    return createAnalyticWorld(w.spec);
}

/** tunnel-gaps along its world's own track at 2 m/s: the open-way chime above, to the right, below and to the left. */
function tunnelGaps(theme: BuiltinThemeId): Flight {
    const world = lessonWorld('tunnel-gaps');
    const track = worldCheckpoints(world);
    if (track === null) throw new Error('tunnel-gaps has a track');
    return { theme, layers: getLesson('tunnel-gaps').layers, world, floorY: world.floorY, steps: legs(track.map((p) => p.pos), 2, 0) };
}

/** hover-height: the craft held at heights in and out of the band (2 to 3 m), turning a little at each. */
function hoverHeight(): Flight {
    const world = lessonWorld('hover-height');
    const steps: Step[] = [];
    [2.5, 2.2, 1.6, 3.4, 2.9, 2.0].forEach((h, k) => steps.push(...held([0, world.floorY + h, 0], k * 30 - 60, 1)));
    return { theme: 'soft', layers: getLesson('hover-height').layers, world, floorY: world.floorY, steps };
}

/** rings-heights: 4 m before and 4 m past each ring at 2 m/s (the truth bot's line), the next ring the target. */
function ringsHeights(): Flight {
    const world = lessonWorld('rings-heights');
    const gates = courseGates(world.objects(), 'all');
    const points: Vec3[] = [getLesson('rings-heights').start.pos];
    for (const g of gates) {
        const f = quatRotate(g.quat, [0, 0, 1]);
        points.push([g.pos[0] + f[0] * 4, g.pos[1] + f[1] * 4, g.pos[2] + f[2] * 4], [g.pos[0] - f[0] * 4, g.pos[1] - f[1] * 4, g.pos[2] - f[2] * 4]);
    }
    let next = 0;
    const target = (pos: Vec3): SonicObject | null => {
        while (next < gates.length && toLocal(gates[next] as SonicObject, pos)[2] < 0) next++;
        return gates[next] ?? null;
    };
    return { theme: 'soft', layers: getLesson('rings-heights').layers, world, floorY: world.floorY, steps: legs(points, 2, 0, target) };
}

/** walls-hall: down to 0.2 m over the floor at 1 m/s, a hold, up to 0.25 m under the ceiling, a hold. */
function floorAndCeiling(): Flight {
    const world = lessonWorld('walls-hall');
    const x = 0, z = 0, f = world.floorY;
    const top = (world.castRay([x, f + 1.5, z], [0, 1, 0], 50) as NonNullable<ReturnType<SonicWorld['castRay']>>).point[1];
    const steps = [...legs([[x, f + 1.5, z], [x, f + 0.2 + 0.12, z]], 1, 0), ...held([x, f + 0.32, z], 0, 1), ...legs([[x, f + 0.32, z], [x, top - 0.25 - 0.12, z]], 1, 0), ...held([x, top - 0.37, z], 0, 1)];
    return { theme: 'soft', layers: getLesson('walls-hall').layers, world, floorY: f, steps };
}

/** The previews and plays of a lesson's named sounds: the chime from no side, above and below, the target note, floor and ceiling. */
function previews(theme: BuiltinThemeId): Flight {
    const events: readonly (readonly CueEvent[])[] = [
        [{ kind: 'preview', cue: 'safety.free', dir: null }],
        [{ kind: 'repeat-cue', cue: 'safety.free', dir: [0, 1, 0], index: 1, of: 3, durS: 2.5 }],
        [{ kind: 'repeat-cue', cue: 'safety.free', dir: [0, -1, 0], index: 1, of: 3, durS: 2.5 }],
        [{ kind: 'repeat-cue', cue: 'safety.free', dir: [-1, 0, 0], index: 1, of: 3, durS: 2.5 }],
        [{ kind: 'preview', cue: 'height.target', dir: null }],
        [{ kind: 'repeat-cue', cue: 'height.target', index: 1, of: 3, durS: 2.5 }],
        [{ kind: 'preview', cue: 'safety.floor', dir: null }],
        [{ kind: 'preview', cue: 'safety.ceiling', dir: null }],
        [{ kind: 'repeat-cue', cue: 'safety.ceiling', dir: [0, 1, 0], index: 1, of: 3, durS: 1.2 }]
    ];
    const steps: Step[] = [];
    for (const e of events) {
        const block = held([0, 1.5, 0], 0, 3.2);
        steps.push({ ...(block[0] as Step), events: e }, ...block.slice(1));
    }
    return { theme, world: null, floorY: 0, steps };
}

export const PLACEMENT_FLIGHTS = {
    'tunnel-gaps-soft': () => tunnelGaps('soft'),
    'tunnel-gaps-race': () => tunnelGaps('race'),
    'hover-height': hoverHeight,
    'rings-heights': ringsHeights,
    'walls-hall-floor-ceiling': floorAndCeiling,
    'previews-soft': () => previews('soft'),
    'previews-clear': () => previews('clear')
} as const;
export type PlacementFlightId = keyof typeof PLACEMENT_FLIGHTS;
export const PLACEMENT_FLIGHT_IDS = Object.keys(PLACEMENT_FLIGHTS) as PlacementFlightId[];

/** The prefs of each flight's v0.13 record: the defaults, or a variant that walks other branches (calm, the polarity turned over). */
export function v013Prefs(id: PlacementFlightId): Omit<SonicPrefs, 'heightDirection'> {
    const base = defaultPrefs() as SonicPrefs & { heightDirection?: boolean };
    const { heightDirection: _drop, ...rest } = base;
    return id === 'tunnel-gaps-race' ? { ...rest, calm: true, heightPolarity: 'up-lower' } : rest;
}

/** Flies one of the flights with these prefs. */
export function flyPlacement(id: PlacementFlightId, prefs: SonicPrefs): FrameRecord[] {
    return fly(PLACEMENT_FLIGHTS[id](), prefs);
}

/** A number as the record keeps it: 1e-9 (the last bits of a sum are not the placement), -0 as 0. */
const round = (x: number): number => {
    const r = Math.round(x * 1e9) / 1e9;
    return r === 0 ? 0 : r;
};

function rounded(v: unknown): unknown {
    if (typeof v === 'number') return Number.isFinite(v) ? round(v) : String(v);
    if (Array.isArray(v)) return v.map(rounded);
    if (v !== null && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = rounded(x);
        return out;
    }
    return v;
}

/** What a frame hands the engine, as one canonical text (the free way by its v0.13 fields). */
export function frameText(r: FrameRecord): string {
    const p = r.plan;
    const free = p.freeWay === null ? null : { side: p.freeWay.side, offsetM: p.freeWay.offsetM, obstacleM: p.freeWay.obstacleM, ttcS: p.freeWay.ttcS };
    return canonicalJson(rounded({ t: r.t, voices: p.voices, dropped: p.dropped, height: p.height, speed: p.speed, room: p.room, urgent: p.urgent, cues: p.cues, freeWay: free, notes: r.notes }));
}

/** Frames per block of PlacementHashes.blocks: half a second. */
export const PLACEMENT_BLOCK_FRAMES = 30;

export interface PlacementHashes {
    readonly frames: number;
    /** sha256 of every frame's text, one per line */
    readonly hash: string;
    /** the first 12 hex digits of the sha256 of each half second's frames (a mismatch names where it starts) */
    readonly blocks: readonly string[];
}

export function placementHashes(records: readonly FrameRecord[]): PlacementHashes {
    const texts = records.map(frameText);
    const blocks: string[] = [];
    for (let i = 0; i < texts.length; i += PLACEMENT_BLOCK_FRAMES) blocks.push(sha256Hex(texts.slice(i, i + PLACEMENT_BLOCK_FRAMES).join('\n')).slice(0, 12));
    return { frames: texts.length, hash: sha256Hex(texts.join('\n')), blocks };
}
