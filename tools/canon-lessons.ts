// Rewrites lessons/<id>.json in the canonical form of src/lesson/validate.ts writeLesson.
//   node tools/run-tool.mjs canon-lessons speed-1 speed-2
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLesson, writeLesson } from '../src/lesson/validate';

export function main(argv: readonly string[]): number {
    for (const id of argv) {
        const p = new URL(`../lessons/${id}.json`, import.meta.url);
        const r = parseLesson(readFileSync(p, 'utf8'));
        if (!r.ok) {
            process.stderr.write(`${id}: ${JSON.stringify(r.issues)}\n`);
            return 1;
        }
        writeFileSync(p, writeLesson(r.value));
    }
    return 0;
}
