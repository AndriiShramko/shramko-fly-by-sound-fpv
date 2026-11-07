// Runs a TypeScript tool of tools/ under plain Node: `node tools/run-tool.mjs <tool> [arguments]`, as in
// `pnpm report <package.zip>`. The tool's `main(argv)` is called with the arguments and its return value
// is the exit code. Plain Node cannot load tools/*.ts because src/ imports without file extensions and
// reads JSON files, so the tool is loaded through Vite's server-side module loader, which is already a
// development dependency (no tsx, no build step, nothing written to disk).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [tool, ...args] = process.argv.slice(2);
if (tool === undefined || !/^[a-z0-9-]+$/.test(tool)) {
    process.stderr.write('usage: node tools/run-tool.mjs <tool> [arguments]   (a tool is tools/<name>.ts with an exported main(argv))\n');
    process.exit(2);
}

const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }
});
let code = 1;
try {
    const mod = await server.ssrLoadModule(`/tools/${tool}.ts`);
    if (typeof mod.main !== 'function') throw new Error(`tools/${tool}.ts exports no main(argv)`);
    code = await mod.main(args);
} catch (e) {
    process.stderr.write(`${tool}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    code = 1;
} finally {
    await server.close();
}
process.exit(code);
