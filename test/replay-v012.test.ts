// Recordings made with v0.12 (test/fixtures/session-v012-*.zip, written by the test host with the code of
// 7d4b4b9, before any v0.13 change) must either still verify or be reported as recorded with an older build,
// never as a failure and never silently. v0.13 changed what sounds in a frame (the height glide and its target
// tone, the bed in every flying lesson, walls by time to contact, the open-way chime) and what the runner
// derives (lesson format 2, the three plays of a named sound, the progress lines): their cue ids no longer match
// frame by frame, and besides the lesson events' version their goal, gate, reset and speech events differ too
// (rings-first: 2 of 10 events re-derived, walls-hall: 5 of 14). The theme (version 2) and the lessons (version
// 2) say why, so the check's verdict is 'older-build', "recorded with an older build", naming the versions
// (review m7 of lane s13-sound, merge note 1 of lane s13-lessons). Its negative control: a recording that
// claims this build's versions and does not re-derive is still a FAIL. Since the s13-worlds merge the lessons' worlds
// changed too (the rooms of v0.13), so that control is replayed on the recording's own walls: the lesson it is handed
// carries v0.12's world, start, assists and goals (test/fixtures/v012-lesson-geometry.json, lane s13-worlds).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LessonDef, SessionManifest } from '../src/contract';
import { getLesson } from '../src/lesson';
import { checkSession, formatReplayCheck } from '../src/replay';
import { readPackage } from '../src/session';
import { getBuiltinTheme } from '../src/theme';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const load = (name: string): ReturnType<typeof readPackage> => readPackage(new Uint8Array(readFileSync(join(FIXTURES, name))));
/** v0.12's world, start, assists and goals of each lesson v0.12 shipped with an analytic world (lane s13-worlds' fixture) */
const V012_GEOMETRY = (JSON.parse(readFileSync(join(FIXTURES, 'v012-lesson-geometry.json'), 'utf8')) as { lessons: Record<string, Partial<LessonDef>> }).lessons;

describe('a session recorded with v0.12', () => {
    it.each(['session-v012-rings-first.zip', 'session-v012-walls-hall.zip'])('%s verifies, or is reported as recorded with an older build, naming the versions, never as FAIL', (name) => {
        const pkg = load(name);
        expect(pkg.problems).toEqual([]);
        expect(pkg.manifest.theme.version).toBe(1);
        expect(pkg.manifest.lesson?.version).toBe(1);
        const lessonId = pkg.manifest.lesson?.id as string;
        const { check } = checkSession(pkg);
        const line = formatReplayCheck(check);
        expect(['pass', 'older-build'], line).toContain(check.verdict);
        expect(line).not.toMatch(/FAIL/);
        if (check.verdict === 'older-build') {
            expect(check.ok).toBe(false);
            expect(line).toMatch(/^replay check: recorded with an older build \(/);
            expect(line).toContain(`lesson ${lessonId} is version ${getLesson(lessonId).version} here, the session was flown with 1`);
            expect(line).toContain(`theme soft is version ${getBuiltinTheme('soft').version} here, the session was flown with 1`);
        }
    });

    it('control: the same recording claiming the current versions does not re-derive and is a FAIL, without a word about another build', () => {
        const pkg = load('session-v012-rings-first.zip');
        const m = pkg.manifest;
        const lesson = m.lesson as NonNullable<SessionManifest['lesson']>;
        const claimed: SessionManifest = { ...m, theme: { id: m.theme.id, version: getBuiltinTheme('soft').version }, lesson: { ...lesson, version: getLesson(lesson.id).version } };
        // on the recording's own walls: this build's lesson with v0.12's world (the world's id is then the recorded one)
        const ownWalls: LessonDef = { ...getLesson(lesson.id), ...V012_GEOMETRY[lesson.id] };
        const { check, setup } = checkSession({ ...pkg, manifest: claimed }, { lessons: { [lesson.id]: ownWalls } });
        expect(setup.notes).toEqual([]);
        expect(setup.exact).toBe(true);
        expect(check.ok).toBe(false);
        expect(check.verdict).toBe('fail');
        expect(formatReplayCheck(check)).toMatch(/^replay check FAIL: /);
        expect(formatReplayCheck(check)).not.toMatch(/older build|not the recording's own build/);
    });

    it('control: a recording that claims a newer version than this build is not told as an older build: FAIL, with the versions', () => {
        const pkg = load('session-v012-rings-first.zip');
        const m = pkg.manifest;
        const lesson = m.lesson as NonNullable<SessionManifest['lesson']>;
        const newer: SessionManifest = { ...m, theme: { id: m.theme.id, version: getBuiltinTheme('soft').version }, lesson: { ...lesson, version: getLesson(lesson.id).version + 1 } };
        const { check } = checkSession({ ...pkg, manifest: newer });
        expect(check.ok).toBe(false);
        expect(check.verdict).toBe('fail');
        expect(formatReplayCheck(check)).toMatch(/^replay check FAIL: .*not the recording's own build: lesson rings-first is version \d+ here, the session was flown with \d+/);
    });
});
