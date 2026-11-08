// Recordings made with v0.12 (test/fixtures/session-v012-*.zip, written by the test host with the code of
// 7d4b4b9, before any v0.13 change) must either still verify or be reported as recorded with an older build,
// never break silently. The v0.13 sound changed what sounds in a frame (the height glide and its target tone,
// the bed in every flying lesson, walls by time to contact, the open-way chime), so their cue ids no longer
// match frame by frame; the themes (version 2) and the changed lessons (version 2) say so.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SessionManifest } from '../src/contract';
import { getLesson } from '../src/lesson';
import { checkSession, formatReplayCheck } from '../src/replay';
import { readPackage } from '../src/session';
import { getBuiltinTheme } from '../src/theme';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const load = (name: string): ReturnType<typeof readPackage> => readPackage(new Uint8Array(readFileSync(join(FIXTURES, name))));

describe('a session recorded with v0.12', () => {
    it.each(['session-v012-rings-first.zip', 'session-v012-walls-hall.zip'])('%s verifies, or is reported as recorded with an older build', (name) => {
        const pkg = load(name);
        expect(pkg.problems).toEqual([]);
        expect(pkg.manifest.theme.version).toBe(1);
        const { check, setup } = checkSession(pkg);
        const older = !setup.exact && setup.notes.some((n) => n.code === 'theme-version' || n.code === 'lesson-version');
        expect(check.ok || older, formatReplayCheck(check)).toBe(true);
        if (!check.ok) {
            const line = formatReplayCheck(check);
            expect(line).toMatch(/not the recording's own build/);
            expect(line).toMatch(/theme soft is version 2 here, the session was flown with 1/);
        }
        // the lesson's own events differ only by the lesson version they carry (rings-first@1 recorded, @2 derived):
        // nothing else of what the runner derives changed in this lane
        for (const d of check.events.diffs) {
            expect(d.kind, d.detail).toBe('lesson');
            const e = (d.recorded ?? d.derived) as { version: number };
            expect(e.version).toBe(d.recorded !== null ? pkg.manifest.lesson?.version : getLesson(pkg.manifest.lesson?.id as string).version);
        }
        const strip = (list: readonly { kind: string; what?: string; attempt?: number }[]): string[] => list.filter((e) => e.kind === 'lesson').map((e) => `${e.what}:${e.attempt}`);
        expect(strip(check.events.diffs.filter((d) => d.problem === 'missing').map((d) => d.recorded as never))).toEqual(strip(check.events.diffs.filter((d) => d.problem === 'extra').map((d) => d.derived as never)));
    });

    it('control: the same recording claiming the current versions would fail without a word about why', () => {
        const pkg = load('session-v012-rings-first.zip');
        const m = pkg.manifest;
        const lesson = m.lesson as NonNullable<SessionManifest['lesson']>;
        const claimed: SessionManifest = { ...m, theme: { id: m.theme.id, version: getBuiltinTheme('soft').version }, lesson: { ...lesson, version: getLesson(lesson.id).version } };
        const { check, setup } = checkSession({ ...pkg, manifest: claimed });
        expect(setup.exact).toBe(true);
        expect(check.ok).toBe(false);
        expect(formatReplayCheck(check)).not.toMatch(/not the recording's own build/);
    });
});
