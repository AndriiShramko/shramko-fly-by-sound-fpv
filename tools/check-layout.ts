// Repository layout rules of ShramkoSonicFPV (plan section 4.1, step 1), run by test/layout.test.ts.
// Node only: this file is compiled by tsconfig.node.json and never shipped to the browser.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface LayoutProblem {
    /** stable rule name */
    readonly rule: string;
    /** repository-relative path with forward slashes */
    readonly file: string;
    readonly detail: string;
}

/** Network access is forbidden everywhere in src/: the engine must work with no network at runtime. */
export const NETWORK_IDENTIFIERS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'RTCPeerConnection', 'WebTransport'] as const;

/** The development tools stay at the simulator's versions (plan step 1). */
export const EXPECTED_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
    '@types/node': '^22.19.0',
    playwright: '1.63.0',
    typescript: '~6.0.3',
    vite: '^8.3.1',
    vitest: '^5.0.1'
};

export const REQUIRED_FILES = [
    'LICENSE',
    'README.md',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'tsconfig.core.json',
    'tsconfig.node.json',
    'vitest.config.ts',
    'docs/dev/status-stage-1.md'
] as const;

/** Identifier names of `source` that appear in `banned`, found on the syntax tree (comments and strings do not count). */
export function findIdentifiers(source: string, banned: readonly string[]): string[] {
    const file = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.ES2022, true);
    const found = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && banned.includes(node.text)) found.add(node.text);
        ts.forEachChild(node, visit);
    };
    visit(file);
    return [...found].sort();
}

/** Module names imported by `source` (static and dynamic with a literal), found on the syntax tree. */
export function findImports(source: string): string[] {
    const file = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.ES2022, true);
    const found = new Set<string>();
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            found.add(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const arg = node.arguments[0];
            if (arg !== undefined && ts.isStringLiteralLike(arg)) found.add(arg.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return [...found].sort();
}

/** Every file below `dir` whose name ends with `suffix`, as absolute paths in a stable order. */
export function listFiles(dir: string, suffix: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...listFiles(path, suffix));
        else if (name.endsWith(suffix)) out.push(path);
    }
    return out;
}

function rel(root: string, path: string): string {
    return relative(root, path).split('\\').join('/');
}

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** All layout problems of the repository at `root`; an empty list means the layout holds. */
export function checkLayout(root: string): LayoutProblem[] {
    const problems: LayoutProblem[] = [];
    const add = (rule: string, file: string, detail: string): void => {
        problems.push({ rule, file, detail });
    };

    for (const f of REQUIRED_FILES) {
        if (!existsSync(join(root, f))) add('required-file', f, 'missing');
    }

    // package.json: no runtime dependencies, MIT, tools at the simulator's versions.
    const pkgPath = join(root, 'package.json');
    if (existsSync(pkgPath)) {
        const pkg = readJson(pkgPath);
        if (isRecord(pkg)) {
            for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
                if (key in pkg) add('no-runtime-dependencies', 'package.json', `"${key}" must not exist`);
            }
            if (pkg.license !== 'MIT') add('license', 'package.json', 'license must be MIT');
            const dev = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
            for (const [name, range] of Object.entries(EXPECTED_DEV_DEPENDENCIES)) {
                if (dev[name] !== range) add('dev-dependency', 'package.json', `${name} must be ${range}, found ${String(dev[name])}`);
            }
        } else add('package-json', 'package.json', 'not an object');
    }

    // tsconfig.core.json: no DOM library, and only src/audio is left out.
    const corePath = join(root, 'tsconfig.core.json');
    if (existsSync(corePath)) {
        const core = readJson(corePath);
        const options = isRecord(core) && isRecord(core.compilerOptions) ? core.compilerOptions : {};
        const lib = Array.isArray(options.lib) ? options.lib.map((x) => String(x).toLowerCase()) : [];
        if (lib.length === 0 || lib.some((x) => x.includes('dom') || x.includes('webworker'))) {
            add('core-dom-free', 'tsconfig.core.json', `lib must list ES libraries only, found ${JSON.stringify(options.lib)}`);
        }
        const exclude = isRecord(core) && Array.isArray(core.exclude) ? core.exclude : [];
        if (JSON.stringify(exclude) !== JSON.stringify(['src/audio/**'])) {
            add('core-scope', 'tsconfig.core.json', `exclude must be exactly ["src/audio/**"], found ${JSON.stringify(exclude)}`);
        }
    }

    // src/: no network anywhere.
    for (const file of listFiles(join(root, 'src'), '.ts')) {
        const hits = findIdentifiers(readFileSync(file, 'utf8'), NETWORK_IDENTIFIERS);
        if (hits.length > 0) add('no-network', rel(root, file), `uses ${hits.join(', ')}`);
    }

    // test/: Node only (browser proofs live in test-audio/, outside the simulator's vitest glob).
    for (const file of listFiles(join(root, 'test'), '.ts')) {
        if (findImports(readFileSync(file, 'utf8')).some((m) => m === 'playwright' || m === 'playwright-core')) {
            add('test-node-only', rel(root, file), 'imports playwright: browser proofs belong in test-audio/');
        }
    }

    const readme = join(root, 'README.md');
    if (existsSync(readme) && !readFileSync(readme, 'utf8').includes('ShramkoGSFPV')) {
        add('readme-names-simulator', 'README.md', 'must name ShramkoGSFPV');
    }

    return problems;
}
