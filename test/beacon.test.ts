// The target hum as a beacon (lane sonic-beacon, owner's complaint of 2026-11-10: "in the tunnels we do not understand
// where to fly"). With SonicPrefs.beacon on (absent or true) the hum's direction is folded into the front half circle and
// it is an octave higher on course; with it off every plan is the plan of package b102ce6 exactly: the beacon and
// placement flights (test/helpers/beacon-flights.ts) against the hashes b102ce6's planner made of them
// (test/fixtures/beacon-b102ce6.json). What this cannot show: whether a person hears the side and the octave (the
// virtual listener's rig, pnpm listen, stage S4 of the lane).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SonicPrefs, Vec3 } from '../src/contract';
import { beaconBearing, beaconPointIndex, BEACON_AHEAD_M, CORNER_DEG, foldToFront, ON_COURSE_DEG, trackCorners, turnDeg, type VoicePlan } from '../src/cues';
import { defaultPrefs, validatePrefs } from '../src/prefs';
import { BEACON_BEARINGS, BEACON_FIXTURE_IDS, BEACON_HOLD_FRAMES, b102ce6Prefs, flyBeaconFixture } from './helpers/beacon-flights';
import { placementHashes, type FrameRecord } from './helpers/placement';

const DEG = Math.PI / 180;
/** A unit direction of the listener frame at `azDeg` from the nose (positive right) and `elDeg` above the horizon. */
const dirAt = (azDeg: number, elDeg = 0): Vec3 => [Math.sin(azDeg * DEG) * Math.cos(elDeg * DEG), Math.sin(elDeg * DEG), -Math.cos(azDeg * DEG) * Math.cos(elDeg * DEG)];
const near = (a: Vec3, b: Vec3, eps = 1e-9): void => a.forEach((x, i) => expect(x).toBeCloseTo(b[i] as number, -Math.log10(eps)));

describe('bearing and fold (src/cues/beacon.ts)', () => {
    it('the bearing from the nose: right positive, behind beyond 90 degrees, on course within 8', () => {
        for (const az of [0, 5, -5, 8, -8, 9, 45, -89, 90, 91, -91, 150, -179]) {
            const b = beaconBearing(dirAt(az, 20));
            expect(b.azimuthDeg).toBeCloseTo(az, 9);
            expect(b.elevationDeg).toBeCloseTo(20, 9);
            expect(b.behind).toBe(Math.abs(az) > 90);
            expect(b.onCourse).toBe(Math.abs(az) <= ON_COURSE_DEG);
        }
        expect(ON_COURSE_DEG).toBe(8);
        // straight above: no side, not on course
        expect(beaconBearing([0, 1, 0])).toEqual({ azimuthDeg: 0, elevationDeg: 90, behind: false, onCourse: false });
    });

    it('89 degrees is untouched, 91 becomes 90, 179 becomes 90 on the same side, the elevation kept', () => {
        for (const el of [0, 25, -40]) {
            near(foldToFront(dirAt(89, el)), dirAt(89, el));
            near(foldToFront(dirAt(-89, el)), dirAt(-89, el));
            near(foldToFront(dirAt(91, el)), dirAt(90, el));
            near(foldToFront(dirAt(-91, el)), dirAt(-90, el));
            near(foldToFront(dirAt(179, el)), dirAt(90, el));
            near(foldToFront(dirAt(-179, el)), dirAt(-90, el));
            near(foldToFront(dirAt(-150, el)), dirAt(-90, el));
            const f = foldToFront(dirAt(135, el));
            expect(Math.hypot(...f)).toBeCloseTo(1, 12);
            expect(beaconBearing(f).elevationDeg).toBeCloseTo(el, 9);
        }
        // exactly behind: one ear, never undecided
        near(foldToFront([0, 0, 1]), [1, 0, 0]);
    });

    it('corners: the inner points where the way turns by more than 20 degrees', () => {
        expect(CORNER_DEG).toBe(20);
        expect(turnDeg([0, 0, 0], [0, 0, -1], [0, 0, -2])).toBeCloseTo(0, 9);
        expect(turnDeg([0, 0, 0], [0, 0, -1], [1, 0, -1])).toBeCloseTo(90, 9);
        const at = (deg: number): Vec3 => [Math.sin(deg * DEG) * 3, 0, -3 - Math.cos(deg * DEG) * 3];
        // straight 3 m, then a leg turned by 19, then by 21 (to the leg before), then straight on
        const p19: Vec3 = at(19);
        const dir21 = (19 + 21) * DEG;
        const p40: Vec3 = [p19[0] + Math.sin(dir21) * 3, 0, p19[2] - Math.cos(dir21) * 3];
        const p40b: Vec3 = [p40[0] + Math.sin(dir21) * 3, 0, p40[2] - Math.cos(dir21) * 3];
        expect(trackCorners([[0, 0, 0], [0, 0, -3], p19, p40, p40b])).toEqual([2]);
        // a climb is a turn too
        expect(trackCorners([[0, 0, 0], [0, 0, -3], [0, 2, -5], [0, 4, -7]])).toEqual([1]);
        expect(trackCorners([[0, 0, 0], [0, 0, -1]])).toEqual([]);
    });

    it('the beacon point: the next corner or the first point 6 m ahead, else the last; null when all are passed', () => {
        expect(BEACON_AHEAD_M).toBe(6);
        const straight: Vec3[] = [0, 2, 4, 6, 8, 10].map((z) => [0, 0, -z]);
        expect(beaconPointIndex(straight, 1, [0, 0, 0])).toBe(3); // 6 m ahead
        expect(beaconPointIndex(straight, 4, [0, 0, -7])).toBe(5); // the last
        expect(beaconPointIndex(straight, 6, [0, 0, -11])).toBeNull();
        const bend: Vec3[] = [[0, 0, 0], [0, 0, -2], [0, 0, -4], [3, 0, -4], [6, 0, -4]];
        expect(beaconPointIndex(bend, 1, [0, 0, 0])).toBe(2); // the corner comes before 6 m: never through the wall
    });
});

describe('the preference beacon (src/prefs)', () => {
    it('on by default; true and false are valid, a document without it is valid, anything else is not', () => {
        expect(defaultPrefs().beacon).toBe(true);
        expect(validatePrefs({ ...defaultPrefs(), beacon: false }).ok).toBe(true);
        expect(validatePrefs(b102ce6Prefs()).ok).toBe(true);
        expect(validatePrefs({ ...defaultPrefs(), beacon: 'yes' }).ok).toBe(false);
    });
});

interface Fixture {
    readonly made: string;
    readonly flights: Readonly<Record<string, { readonly frames: number; readonly hash: string; readonly blocks: readonly string[] }>>;
}
const B102 = JSON.parse(readFileSync(new URL('./fixtures/beacon-b102ce6.json', import.meta.url), 'utf8')) as Fixture;
const withBeacon = (on: boolean | undefined): SonicPrefs => (on === undefined ? b102ce6Prefs() : ({ ...b102ce6Prefs(), beacon: on } as SonicPrefs));
const cache = new Map<string, FrameRecord[]>();
const flown = (id: string, on: boolean | undefined): FrameRecord[] => {
    const key = `${id}:${String(on)}`;
    if (!cache.has(key)) cache.set(key, flyBeaconFixture(id, withBeacon(on)));
    return cache.get(key) as FrameRecord[];
};
const hum = (r: FrameRecord): VoicePlan => {
    const v = r.plan.voices.find((x) => x.cue === 'target.hum');
    if (v === undefined) throw new Error(`no hum at t ${r.t}`);
    return v;
};
/** The hum of the bearing flight in the middle of the hold at `bearingDeg`. */
const humAt = (rs: readonly FrameRecord[], bearingDeg: number): VoicePlan => hum(rs[BEACON_BEARINGS.indexOf(bearingDeg as (typeof BEACON_BEARINGS)[number]) * BEACON_HOLD_FRAMES + BEACON_HOLD_FRAMES / 2] as FrameRecord);

describe('the setting off gives back b102ce6 exactly', () => {
    it('the fixture is b102ce6\'s and holds every flight', () => {
        expect(B102.made).toBe('b102ce6');
        expect(Object.keys(B102.flights).sort()).toEqual([...BEACON_FIXTURE_IDS].sort());
    });

    it.each(BEACON_FIXTURE_IDS)('%s: every frame\'s plan is b102ce6\'s, voice for voice, note for note', (id) => {
        const h = placementHashes(flown(id, false));
        const want = B102.flights[id] as Fixture['flights'][string];
        expect(h.frames).toBe(want.frames);
        const first = h.blocks.findIndex((b, i) => b !== want.blocks[i]);
        expect(first, `first block that differs: frames ${first * 30} to ${first * 30 + 29}`).toBe(-1);
        expect(h.hash).toBe(want.hash);
    });

    it.each(['beacon-bearings', 'beacon-turn', 'beacon-pass', 'beacon-previews', 'rings-heights'])('control: %s with the beacon on (absent) differs from b102ce6', (id) => {
        expect(placementHashes(flown(id, undefined)).hash).not.toBe((B102.flights[id] as Fixture['flights'][string]).hash);
    });
});

describe('the beacon on', () => {
    it('absent and true plan alike', () => {
        expect(placementHashes(flown('beacon-bearings', undefined)).hash).toBe(placementHashes(flown('beacon-bearings', true)).hash);
    });

    it('a target 150 degrees left sounds from 90 degrees left (b102ce6: from 150 left); 150 right from 90 right', () => {
        const on = flown('beacon-bearings', true);
        const off = flown('beacon-bearings', false);
        near(humAt(on, -150).dir as Vec3, [-1, 0, 0], 1e-6);
        near(humAt(on, 150).dir as Vec3, [1, 0, 0], 1e-6);
        near(humAt(off, -150).dir as Vec3, dirAt(-150), 1e-6);
    });

    it('every bearing: the true direction up to 90 degrees, beyond it the ear of its side', () => {
        const on = flown('beacon-bearings', true);
        for (const b of BEACON_BEARINGS) {
            if (Math.abs(b) === 180) continue; // exactly behind: one ear (the fold test)
            const want = Math.abs(b) <= 90 ? dirAt(b) : dirAt(Math.sign(b) * 90);
            near(humAt(on, b).dir as Vec3, want, 1e-6);
        }
    });

    it('a target at 0 and at 5 degrees is an octave above one at 12, on the scale; at 8 on course, at 12 not', () => {
        const on = flown('beacon-bearings', true);
        const at12 = humAt(on, 12);
        for (const b of [0, 5, -5, 8]) {
            const v = humAt(on, b);
            expect(v.hz / at12.hz).toBeCloseTo(2, 9);
            expect(v.noteIndex).toBe((at12.noteIndex as number) + 5);
        }
        expect(humAt(on, -12).hz).toBe(at12.hz);
        // off: one note at every bearing
        const off = flown('beacon-bearings', false);
        expect(humAt(off, 0).hz).toBe(humAt(off, 12).hz);
        expect(humAt(off, 0).hz).toBe(at12.hz);
    });

    it('tempo, level and filter stay b102ce6\'s at every bearing', () => {
        const on = flown('beacon-bearings', true);
        const off = flown('beacon-bearings', false);
        for (const b of BEACON_BEARINGS) {
            const a = humAt(on, b);
            const o = humAt(off, b);
            expect([a.periodS, a.gainDb, a.lowpassHz, a.distance, a.beatHz]).toEqual([o.periodS, o.gainDb, o.lowpassHz, o.distance, o.beatHz]);
        }
    });

    it('turning on the spot: the hum never comes from behind, and it keeps its elevation', () => {
        for (const r of flown('beacon-turn', true)) {
            const d = hum(r).dir as Vec3;
            expect(d[2]).toBeLessThanOrEqual(1e-9);
            expect(d[1]).toBeCloseTo(2 / Math.hypot(2, 10), 9);
        }
    });
});
