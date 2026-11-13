// Free flight over any scan (train 2, the owner: "if I already fly by sound I just want to try other interiors and exteriors"):
// the template lessons/scan-free.json made into a lesson on the pilot's scan at the pilot's size, with no track.
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../src/contract';
import { createTranslator, DICTS, LESSON_TEMPLATES, lessonKeys } from '../src/i18n';
import { lessonPaths, scanFreeLesson, SCAN_FREE_ID, SHIPPED_LESSON_IDS } from '../src/lesson';

describe('scanFreeLesson', () => {
    it('flies the scan it is given at the size it is given, with no track and no target', () => {
        const l = scanFreeLesson('887f27aa', [3, 0, 0.5, 0]);
        expect(l.id).toBe(SCAN_FREE_ID);
        expect(l.world).toEqual({ kind: 'scan', sceneId: '887f27aa', sceneVersion: null, transform: [3, 0, 0.5, 0], track: null });
        expect(l.layers.on).toContain('safety');
        expect(l.layers.on).toContain('height');
        expect(l.layers.on).not.toContain('target');
        expect(l.checkpoints).toEqual([]);
    });

    it('stays open: no time limit, no touch limit, one goal no flight reaches', () => {
        const l = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        expect(l.attemptLimitS).toBeNull();
        expect(l.pass.maxTouches).toBeNull();
        expect(l.goals).toEqual([{ kind: 'fly-distance', metres: 5000 }]);
    });

    it('is on no path and is not a shipped lesson', () => {
        expect(SHIPPED_LESSON_IDS).not.toContain(SCAN_FREE_ID);
        expect(lessonPaths().full).not.toContain(SCAN_FREE_ID);
        expect(lessonPaths().fast).not.toContain(SCAN_FREE_ID);
    });

    it('refuses an empty scene or a size not above zero', () => {
        expect(() => scanFreeLesson('', [1, 0, 0, 0])).toThrow();
        expect(() => scanFreeLesson('887f27aa', [0, 0, 0, 0])).toThrow();
    });

    it('has every line in every language', () => {
        const spec = LESSON_TEMPLATES.find((s) => s.id === SCAN_FREE_ID);
        expect(spec).toBeDefined();
        for (const locale of LOCALES) {
            const problems: string[] = [];
            const tr = createTranslator(locale, DICTS, (p) => problems.push(`${p.key}: ${p.message}`));
            for (const key of lessonKeys(spec!)) expect(tr.text({ key }).length, `${locale} ${key}`).toBeGreaterThan(0);
            expect(problems, locale).toEqual([]);
        }
    });
});
