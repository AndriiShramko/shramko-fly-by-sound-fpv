import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/** Every text file of the repository that a person writes (no node_modules, caches, locks, binaries). */
function textFiles(dir = ROOT, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git' || name === '.cache' || name === 'dist' || name === 'pnpm-lock.yaml') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) textFiles(path, out);
        else if (/\.(md|ts|mjs|json|html|css|py|yml|yaml|txt)$/.test(name)) out.push(relative(ROOT, path).split('\\').join('/'));
    }
    return out;
}

/** The targets of the relative Markdown links of a file, as repository paths. */
function localLinks(file: string): string[] {
    const links: string[] = [];
    for (const m of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = (m[1] as string).split('#')[0] as string;
        if (target === '' || /^[a-z]+:/i.test(target)) continue;
        links.push(relative(ROOT, join(ROOT, dirname(file), target)).split('\\').join('/'));
    }
    return links;
}

describe('the README', () => {
    const readme = read('README.md');

    it('says what the project is, who it is for, how to run the demo, and where it links', () => {
        for (const text of [
            'Fly by Sound',
            'Who it is for',
            'pnpm demo',
            'https://github.com/AndriiShramko/ShramkoGSFPV',
            'https://gsfpv.flyreelstudio.eu',
            'docs/research',
            'docs/testing',
            'MIT licence',
            'CC BY 4.0',
            'Andrii Shramko together with the spatial-audio researcher Bart\u0142omiej Mr\u00f3z (Gdansk University of Technology)'
        ]) {
            expect(readme, text).toContain(text);
        }
    });

    it('uses the Polish letters of the researcher\'s name here and nowhere else', () => {
        const hits = textFiles().filter((f) => /Bart\u0142omiej|Mr\u00f3z/.test(read(f)));
        expect(hits.filter((f) => f !== 'test/docs.test.ts')).toEqual(['README.md']);
    });

    it('links only to files that exist, and its layout table names real paths', () => {
        for (const file of ['README.md', 'docs/LICENSE.md', 'docs/testing/consent-template.md', 'docs/testing/test-protocol.md', 'docs/testing/school-loudness-sheet.md']) {
            for (const target of localLinks(file)) expect(existsSync(join(ROOT, target)), `${file} links to ${target}`).toBe(true);
        }
        const table = readme.slice(readme.indexOf('## Layout'), readme.indexOf('## Development'));
        const paths = [...table.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1] as string);
        expect(paths.length).toBeGreaterThanOrEqual(9);
        for (const p of paths) expect(existsSync(join(ROOT, p)), p).toBe(true);
    });

    it('names the scripts it tells people to run, and they exist', () => {
        const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
        for (const name of ['demo', 'demo:build', 'report', 'typecheck', 'test', 'proof:audio']) expect(scripts[name], name).toBeTypeOf('string');
    });
});

describe('docs/testing', () => {
    const consent = read('docs/testing/consent-template.md');
    const protocol = read('docs/testing/test-protocol.md');
    const sheet = read('docs/testing/school-loudness-sheet.md');

    it('the consent template is marked as not legal advice, in English and in Polish', () => {
        expect(consent).toContain('NOT LEGAL ADVICE');
        expect(consent).toContain('NIE JEST PORAD\u0104 PRAWN\u0104');
        // marked before anything else is said
        expect(consent.indexOf('NOT LEGAL ADVICE')).toBeLessThan(consent.indexOf('## How to use it'));
    });

    it('holds both languages with the same four separate consents and the same parts', () => {
        const english = consent.slice(consent.indexOf('# Part A. English'), consent.indexOf('# Cz\u0119\u015b\u0107 B. Po polsku'));
        const polish = consent.slice(consent.indexOf('# Cz\u0119\u015b\u0107 B. Po polsku'));
        expect(english.length).toBeGreaterThan(3000);
        expect(polish.length).toBeGreaterThan(3000);
        for (const [text, parts] of [
            [english, ['A1.', 'A2.', 'A3.', 'A4.']],
            [polish, ['B1.', 'B2.', 'B3.', 'B4.']]
        ] as const) {
            for (const p of parts) expect(text, p).toContain(`## ${p}`);
        }
        const rows = (text: string): number => text.split('\n').filter((l) => /^\| \*\*(Part|Cz\u0119\u015b\u0107) [1-4]\.\*\*/.test(l)).length;
        expect(rows(english)).toBe(4);
        expect(rows(polish)).toBe(4);
        // each consent row offers a yes and a no box
        for (const text of [english, polish]) for (const l of text.split('\n')) if (/^\| \*\*(Part|Cz\u0119\u015b\u0107) [1-4]\.\*\*/.test(l)) expect((l.match(/\[ \]/g) ?? []).length).toBe(2);
        // the manifest fields the form maps to
        for (const field of ['recording', 'voice', 'send', 'speechRecognition', 'minor', 'guardianConfirmed']) expect(consent).toContain(`\`${field}\``);
        // a child is asked as well, and a name is never needed
        expect(english).toContain('Assent of the child');
        expect(polish).toContain('Zgoda dziecka');
        expect(english).toMatch(/random participant code/);
        expect(polish).toMatch(/losowy kod uczestnika/);
    });

    it('the loudness sheet and the protocol give 75 dBA for children and 80 dBA for adults', () => {
        for (const text of [sheet, protocol]) {
            expect(text).toContain('75 dBA');
            expect(text).toContain('80 dBA');
        }
        expect(sheet).toMatch(/\*\*Children\*\* \| \*\*75 dBA\*\*/);
        expect(sheet).toMatch(/\*\*Adults\*\* \| \*\*80 dBA\*\*/);
        expect(sheet).toMatch(/not a certified calibration/);
        // the hours per week follow 40 x 10^((reference - L) / 10)
        for (const [reference, level, hours] of [
            [75, 80, 12.6],
            [75, 85, 4.0],
            [80, 90, 4.0],
            [80, 85, 12.6]
        ] as const) {
            expect(40 * 10 ** ((reference - level) / 10)).toBeCloseTo(hours, 0);
            expect(sheet).toContain(hours.toFixed(1) + ' h');
        }
    });

    it('the protocol names both groups and the metrics the report produces', () => {
        for (const text of ['First-time session', 'Returning session', 'first-time testers', 'returning testers', 'pnpm report', 'Path deviation', 'Per-gate and per-leg times', 'Targets are not findings']) {
            expect(protocol.toLowerCase(), text).toContain(text.toLowerCase());
        }
        // every survey item the protocol mentions is a real survey item
        const survey = read('src/survey/defs.ts');
        for (const m of protocol.matchAll(/`((?:fun|mental|temporal|performance|effort|frustration|fear|up-direction|ears-tired|came-back|child-fun|child-scary))`/g)) expect(survey, m[1] as string).toContain(`'${m[1] as string}'`);
    });
});
