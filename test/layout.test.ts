import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { checkLayout, findIdentifiers, findImports, NETWORK_IDENTIFIERS } from '../tools/check-layout';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Type-check `text` as a source file of src/ under the options of tsconfig.core.json; returns error codes. */
function coreDiagnosticCodes(text: string): number[] {
    const configPath = join(ROOT, 'tsconfig.core.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
    const virtual = join(ROOT, 'src', '__virtual__.ts').split('\\').join('/');
    const host = ts.createCompilerHost(parsed.options);
    const isVirtual = (name: string): boolean => name.split('\\').join('/') === virtual;
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersionOrOptions, ...rest) =>
        isVirtual(name) ? ts.createSourceFile(name, text, languageVersionOrOptions) : getSourceFile(name, languageVersionOrOptions, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (name) => isVirtual(name) || fileExists(name);
    const readFile = host.readFile.bind(host);
    host.readFile = (name) => (isVirtual(name) ? text : readFile(name));
    const program = ts.createProgram({ rootNames: [virtual], options: parsed.options, host });
    return ts.getPreEmitDiagnostics(program).map((d) => d.code);
}

describe('repository layout', () => {
    it('holds in this repository', () => {
        expect(checkLayout(ROOT)).toEqual([]);
    });

    it('syntax scan sees identifiers, not comments or strings', () => {
        const source = ['// fetch in a comment', 'const s = "WebSocket in a string";', 'const x = 1;'].join('\n');
        expect(findIdentifiers(source, NETWORK_IDENTIFIERS)).toEqual([]);
        // negative control: real uses are found
        const bad = 'const r = await fetch("x"); const w = new WebSocket("y"); navigator.sendBeacon("z");';
        expect(findIdentifiers(bad, NETWORK_IDENTIFIERS)).toEqual(['WebSocket', 'fetch', 'sendBeacon']);
    });

    it('import scan sees import statements, not strings that look like them', () => {
        expect(findImports("const s = \"import x from 'playwright'\";")).toEqual([]);
        expect(findImports("import a from 'playwright'; export * from './b'; const c = import('node:fs');")).toEqual(['./b', 'node:fs', 'playwright']);
    });
});

describe('the DOM-free rule of tsconfig.core.json', () => {
    it('accepts plain ES code', () => {
        expect(coreDiagnosticCodes('export const f = (a: number): number => Math.sqrt(a) + [1, 2].length;')).toEqual([]);
    });

    it('refuses DOM globals (negative control)', () => {
        // 2584: Cannot find name 'document'; 2304: Cannot find name
        const codes = coreDiagnosticCodes('export const t = document.title;');
        expect(codes.length).toBeGreaterThan(0);
        expect(codes.some((c) => c === 2584 || c === 2304)).toBe(true);
    });

    it('refuses Node modules (types are empty)', () => {
        expect(coreDiagnosticCodes('import { readFileSync } from "node:fs"; export const f = readFileSync;').length).toBeGreaterThan(0);
    });
});

describe('layout rules refuse a broken repository (negative controls)', () => {
    const dirs: string[] = [];
    afterAll(() => {
        for (const d of dirs) rmSync(d, { recursive: true, force: true });
    });

    function write(root: string, file: string, text: string): void {
        const path = join(root, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
    }

    it('names every violated rule', () => {
        const root = mkdtempSync(join(tmpdir(), 'sonic-layout-'));
        dirs.push(root);
        write(root, 'package.json', JSON.stringify({ license: 'GPL-3.0', dependencies: { left: '1' }, devDependencies: { typescript: '^5.0.0' } }));
        write(root, 'tsconfig.core.json', JSON.stringify({ compilerOptions: { lib: ['ES2022', 'DOM'] }, exclude: [] }));
        write(root, 'src/net.ts', 'export const get = (u: string) => fetch(u);');
        write(root, 'test/browser.test.ts', "import { chromium } from 'playwright';\nexport const c = chromium;");
        write(root, 'README.md', 'A readme that names nothing.');
        const rules = new Set(checkLayout(root).map((p) => p.rule));
        for (const rule of [
            'required-file',
            'no-runtime-dependencies',
            'license',
            'dev-dependency',
            'core-dom-free',
            'core-scope',
            'no-network',
            'test-node-only',
            'readme-names-simulator'
        ]) {
            expect(rules.has(rule), rule).toBe(true);
        }
    });
});
