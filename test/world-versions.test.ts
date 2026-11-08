// Versions that keep old recordings (lane s13-worlds step 2): a generator builds every version it ever
// published, exactly as published. The v0.12 build itself (sound repo 7d4b4b9) wrote the fixtures:
// test/fixtures/v012-worlds.json (every v0.12 lesson's world spec with the id, digest, objects and a
// 600-point field fingerprint that build gave it) and test/fixtures/v012-session-walls-hall.zip (a
// session flown on walls-hall and recorded by that build's test host). This build must give the same
// walls for those specs, rebuild the recording on them, and say plainly when a recording was flown
// with another lesson version; a version it does not have must fail with a reason, never silently.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnalyticWorldSpec, LessonDef, Vec3 } from '../src/contract';
import { WORLD_GENERATORS } from '../src/contract';
import { getLesson, validateLesson } from '../src/lesson';
import { checkSession, formatReplayCheck, rebuildSession, ReplayError } from '../src/replay';
import { readPackage } from '../src/session';
import { canonicalJson } from '../src/util/canonical';
import { createRng } from '../src/util/rng';
import { sha256Hex } from '../src/util/sha256';
import { buildsVersion, createAnalyticWorld, GENERATOR_VERSION, GENERATOR_VERSIONS, makeSpec, WorldSpecError, type AnalyticWorldInfo } from '../src/world';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

interface V012World {
    readonly lessonVersion: number;
    readonly spec: AnalyticWorldSpec;
    readonly id: string;
    readonly digest: string;
    readonly objects: string;
    readonly field: string;
    readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
}
const V012 = (JSON.parse(fixture('v012-worlds.json')) as { worlds: Record<string, V012World> }).worlds;

/** The signed distance at 600 fixed points of the bounds (the goldens' fingerprint, as the v0.12 build computed it). */
function fingerprint(w: AnalyticWorldInfo): string {
    const rng = createRng(2024);
    const [lo, hi] = [w.bounds.min, w.bounds.max];
    const values: number[] = [];
    for (let i = 0; i < 600; i++) {
        const p: Vec3 = [rng.range(lo[0], hi[0]), rng.range(lo[1], hi[1]), rng.range(lo[2], hi[2])];
        values.push(Math.round(w.sdf(...p) * 1e4));
    }
    return sha256Hex(canonicalJson(values));
}

function v012Lesson(): LessonDef {
    const v = validateLesson(JSON.parse(fixture('v012-lesson-walls-hall.json')));
    if (!v.ok) throw new Error(JSON.stringify(v.issues));
    return v.value;
}

describe('every version a generator published still builds', () => {
    it('every generator builds version 1 and its current version', () => {
        for (const g of WORLD_GENERATORS) {
            expect(GENERATOR_VERSIONS[g][0], g).toBe(1);
            expect(GENERATOR_VERSIONS[g], g).toContain(GENERATOR_VERSION[g]);
            for (const v of GENERATOR_VERSIONS[g]) expect(buildsVersion(g, v)).toBe(true);
            expect(createAnalyticWorld(makeSpec(g, {}, 0, 1)).version, g).toBe(1);
        }
    });

    it.each(Object.entries(V012))('the v0.12 world of %s: same id, digest, objects and field as the v0.12 build gave', (_id, v) => {
        expect(v.spec.version).toBe(1);
        const w = createAnalyticWorld(v.spec);
        expect(w.id).toBe(v.id);
        expect(w.digest).toBe(v.digest);
        expect(sha256Hex(canonicalJson(w.objects()))).toBe(v.objects);
        expect(fingerprint(w)).toBe(v.field);
        expect(w.bounds).toEqual(v.bounds);
    });

    it('the fixture holds every v0.12 lesson with an analytic world (15 of the 21)', () => {
        expect(Object.keys(V012)).toHaveLength(15);
        expect(Object.keys(V012)).toContain('corridor');
        expect(Object.keys(V012)).toContain('walls-hall');
    });

    it('control: the same comparison fails for walls 1 cm off', () => {
        const hall = V012['walls-hall'] as V012World;
        const off = createAnalyticWorld({ ...hall.spec, params: { ...hall.spec.params, widthM: 40.01 } });
        expect(off.digest).not.toBe(hall.digest);
        expect(fingerprint(off)).not.toBe(hall.field);
        const corridor = V012['corridor'] as V012World;
        const narrow = createAnalyticWorld({ ...corridor.spec, params: { ...corridor.spec.params, widthM: 4.99 } });
        expect(fingerprint(narrow)).not.toBe(corridor.field);
    });

    it('a version this build does not have fails with the versions it does have', () => {
        const spec = (V012['walls-hall'] as V012World).spec;
        for (const version of [0, 99, 1.5, -1]) {
            const build = (): unknown => createAnalyticWorld({ ...spec, version });
            expect(build).toThrow(WorldSpecError);
            expect(build).toThrow(new RegExp(`builds versions? ${GENERATOR_VERSIONS.hall.join(', ')} here.*asks for ${version}`));
        }
        expect(() => makeSpec('hall', {}, 0, 99)).toThrow(/builds versions? .* here.*asks for 99/);
        expect(buildsVersion('hall', 99)).toBe(false);
        expect(buildsVersion('hall', '1')).toBe(false);
    });
});

describe('a session recorded with v0.12', () => {
    const pkg = readPackage(new Uint8Array(readFileSync(new URL('./fixtures/v012-session-walls-hall.zip', import.meta.url))));

    it('rebuilds on its own walls: the world of its lesson\'s v0.12 spec is the recorded scene', () => {
        expect(pkg.manifest.lesson).toMatchObject({ id: 'walls-hall', version: 1 });
        const lesson = v012Lesson();
        const setup = rebuildSession(pkg.manifest, { lessons: { 'walls-hall': lesson } });
        const world = setup.world as AnalyticWorldInfo;
        expect(world.id).toBe(pkg.manifest.scene.id);
        expect(world.digest).toBe((V012['walls-hall'] as V012World).digest);
        expect(fingerprint(world)).toBe((V012['walls-hall'] as V012World).field);
        expect(setup.notes.map((n) => n.code)).not.toContain('world-id');
        // the walls decide the first attempt (fly to a wall, stop within 3 m of it): it is met when it was recorded
        const { check } = checkSession(pkg, { lessons: { 'walls-hall': lesson } });
        expect(check.events.byKind.goal.matched).toBeGreaterThanOrEqual(1);
        const firstMet = pkg.events.find((e) => e.kind === 'goal' && e.what === 'met');
        expect(firstMet).toBeDefined();
        expect(check.events.diffs.some((d) => d.recorded === firstMet)).toBe(false);
    });

    it('replayed with the shipped lesson, it is reported as flown with an older lesson version, never silently', () => {
        const shipped = getLesson('walls-hall');
        const { setup, check } = checkSession(pkg);
        expect(setup.exact).toBe(false);
        const codes = setup.notes.map((n) => n.code);
        expect(codes).toContain('lesson-version');
        const shippedWorld = shipped.world.kind === 'analytic' ? createAnalyticWorld(shipped.world.spec) : null;
        if (shippedWorld !== null && shippedWorld.id !== pkg.manifest.scene.id) expect(codes).toContain('world-id');
        // merge item d of s13-merge: an older lesson (and theme) version is the verdict 'older-build', told as such, with the
        // versions and the walls it was flown in
        const line = formatReplayCheck(check);
        expect(check.verdict).toBe('older-build');
        expect(line).toMatch(/^replay check: recorded with an older build \(lesson walls-hall is version \d+ here, the session was flown with 1/);
        if (codes.includes('world-id')) expect(line).toContain(`the session was flown in ${pkg.manifest.scene.id}`);
    });

    it('control: the same recording on other walls does not meet its first goal when it was recorded', () => {
        // a hall of 200 x 200 m: the pilot stops 27.5 m from the start, now 72 m from any wall
        const lesson = v012Lesson();
        const other: LessonDef = { ...lesson, world: { kind: 'analytic', spec: makeSpec('hall', { widthM: 200, depthM: 200, heightM: 20 }, 0, 1) } };
        const { setup, check } = checkSession(pkg, { lessons: { 'walls-hall': other } });
        expect(setup.notes.map((n) => n.code)).toContain('world-id');
        const firstMet = pkg.events.find((e) => e.kind === 'goal' && e.what === 'met');
        expect(check.events.diffs.some((d) => d.recorded === firstMet)).toBe(true);
    });

    it('a lesson whose world asks for a version this build lacks cannot be replayed, and says why', () => {
        const lesson = v012Lesson();
        const spec = lesson.world.kind === 'analytic' ? lesson.world.spec : makeSpec('hall');
        const broken: LessonDef = { ...lesson, world: { kind: 'analytic', spec: { ...spec, version: 99 } } };
        let err: unknown = null;
        try {
            rebuildSession(pkg.manifest, { lessons: { 'walls-hall': broken } });
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(ReplayError);
        expect((err as ReplayError).code).toBe('world');
        expect((err as Error).message).toMatch(/cannot be built: generator 'hall' builds versions? .* here.*asks for 99/);
    });
});
