// Review B2 of sonic-keys (gsfpv-v03 docs/wip/sonic-keys-review.md): the answer's sound and words, the reminders and the
// spoken skip are derived in every lesson that asks a question, so a recording of such a lesson made before sonic-keys
// does not re-derive with this runner. Each of those lessons is version 3, and its old recording is reported as made with
// an older build ('older-build'), never as a broken one ('fail').
// The fixtures test/fixtures/session-v2-<lesson>.zip were written by test/helpers/record.ts with the code of 09535b7
// (the package's main before sonic-keys); on that build both replay as 'pass'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LessonDef } from '../src/contract';
import { getLesson, SHIPPED_LESSON_IDS } from '../src/lesson';
import { checkSession, formatReplayCheck } from '../src/replay';
import { readPackage } from '../src/session';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const load = (lessonId: string): ReturnType<typeof readPackage> => readPackage(new Uint8Array(readFileSync(join(FIXTURES, `session-v2-${lessonId}.zip`))));

/** The runner asks a question in this lesson: the game's rounds, the headphone check's trials, a shape to name. */
const asks = (l: LessonDef): boolean =>
    l.goals.some((g) => g.kind === 'name-shape' || (g.kind === 'name-cues' && (g.trials ?? 0) > 0) || (g.kind === 'locate' && !l.goals.some((o) => o.kind === 'name-cues')));

/** The lesson version since sonic-keys changed what the runner says and sounds around a question. */
const SONIC_KEYS_VERSION = 3;

describe('lessons with questions after sonic-keys (review B2)', () => {
    it('every lesson that asks a question is version 3 or newer', () => {
        const asking = SHIPPED_LESSON_IDS.map((id) => getLesson(id)).filter(asks);
        expect(asking.map((l) => l.id).sort()).toEqual(['ears-game', 'ears-headphones', 'shapes-cube']);
        for (const l of asking) expect(l.version, l.id).toBeGreaterThanOrEqual(SONIC_KEYS_VERSION);
    });

    it.each(['ears-game', 'shapes-cube'])('a recording of %s version 2 (the runner before sonic-keys) is an older build, not a failure', (id) => {
        const pkg = load(id);
        expect(pkg.problems).toEqual([]);
        expect(pkg.manifest.lesson?.version).toBe(2);
        expect(pkg.events.some((e) => e.kind === 'answer')).toBe(true);
        const { check } = checkSession(pkg);
        const line = formatReplayCheck(check);
        expect(check.verdict, line).toBe('older-build');
        expect(line).toContain(`lesson ${id} is version ${getLesson(id).version} here, the session was flown with 2`);
        expect(line).not.toMatch(/FAIL/);
    });

    it.each(['ears-game', 'shapes-cube'])('control: the same %s recording replayed as this build\'s own version does not re-derive (FAIL)', (id) => {
        // what made the version necessary: this runner says and sounds more around the answers than the recording has
        const pkg = load(id);
        const { check } = checkSession(pkg, { lessons: { [id]: { ...getLesson(id), version: 2 } } });
        expect(check.verdict).toBe('fail');
        expect(formatReplayCheck(check)).toMatch(/^replay check FAIL: /);
    });
});
