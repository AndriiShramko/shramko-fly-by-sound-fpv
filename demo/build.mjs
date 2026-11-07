// Builds the stand-alone demo and Sound Lab into a folder of three files (index.html, demo.css,
// demo.js) that any static server, or a plain double click, opens: the script is an IIFE, not a module,
// so it also runs from file://. No network at build time or at run time.
//
//   node demo/build.mjs                    build into demo/dist
//   node demo/build.mjs --out <folder>     build into another folder
//   node demo/build.mjs --serve [--port n] build, then serve the folder at http://127.0.0.1:5173/
//
// pnpm demo:build and pnpm demo run these.
import { copyFileSync, createReadStream, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERE = join(ROOT, 'demo');

export async function buildDemo(outDir) {
    mkdirSync(outDir, { recursive: true });
    await build({
        configFile: false,
        logLevel: 'warn',
        root: ROOT,
        publicDir: false,
        build: {
            outDir,
            emptyOutDir: false,
            target: 'es2022',
            minify: true,
            sourcemap: false,
            lib: { entry: join(HERE, 'main.ts'), formats: ['iife'], name: 'SonicDemo', fileName: () => 'demo.js' }
        }
    });
    copyFileSync(join(HERE, 'index.html'), join(outDir, 'index.html'));
    copyFileSync(join(HERE, 'demo.css'), join(outDir, 'demo.css'));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

/** A static file server on the loopback address only. Resolves with the server once it listens. */
export function serveFolder(dir, port) {
    const base = resolve(dir);
    const server = createServer((req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = resolve(base, `.${path.endsWith('/') ? `${path}index.html` : path}`);
        if (file !== base && !file.startsWith(base + sep)) {
            res.writeHead(403).end();
            return;
        }
        try {
            if (!statSync(file).isFile()) throw new Error('not a file');
        } catch {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        createReadStream(file).pipe(res);
    });
    return new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, '127.0.0.1', () => done(server));
    });
}

async function main(argv) {
    let out = join(HERE, 'dist');
    let serve = false;
    let port = 5173;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out') out = resolve(argv[++i] ?? '');
        else if (argv[i] === '--serve') serve = true;
        else if (argv[i] === '--port') port = Number(argv[++i]);
        else {
            process.stderr.write(`unknown argument ${argv[i]}\nusage: node demo/build.mjs [--out folder] [--serve] [--port n]\n`);
            return 2;
        }
    }
    await buildDemo(out);
    process.stdout.write(`demo built in ${out}\n`);
    if (serve) {
        const server = await serveFolder(out, port);
        process.stdout.write(`serving http://127.0.0.1:${server.address().port}/  (Ctrl+C to stop)\n`);
        await new Promise(() => undefined);
    }
    return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (e) => {
            process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
            process.exit(1);
        }
    );
}
