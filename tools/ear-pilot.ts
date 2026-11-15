// The ear pilot's speed ladder over the package's courses (sonic3 plan section 4).
//   node tools/run-tool.mjs ear-pilot [--lessons corridor,rings-course] [--seeds 1,2,3] [--rungs 1,2,3] [--out file.json] [--ref name] [--attend-hum] [--turn deg/s] [--budget on|off] [--line on|off]
// Prints one line per course (median top speed, top per seed) and writes every flight to --out.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getLesson } from '../src/lesson';
import { ladder, LADDER_MPS } from '../src/pilot/ladder';

const arg = (argv: readonly string[], name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};

export function main(argv: readonly string[]): number {
    const lessons = (arg(argv, 'lessons') ?? 'corridor,rings-course').split(',');
    const seeds = (arg(argv, 'seeds') ?? '1,2,3').split(',').map(Number);
    const rungs = arg(argv, 'rungs')?.split(',').map(Number) ?? LADDER_MPS;
    const out = arg(argv, 'out');
    const results = [];
    for (const id of lessons) {
        const t0 = Date.now();
        const r = ladder(getLesson(id), seeds, rungs, { ...(argv.includes('--attend-hum') ? { hearing: { attendHum: true } } : {}), ...(arg(argv, 'turn') !== undefined ? { pilot: { turnDps: Number(arg(argv, 'turn')) } } : {}), ...(arg(argv, 'budget') !== undefined ? { budget: arg(argv, 'budget') === 'on' } : {}), ...(arg(argv, 'line') !== undefined ? { line: arg(argv, 'line') === 'on' } : {}) });
        results.push(r);
        const why = r.flights.map((f) => `${f.speedMps}:${f.why}`).join(' ');
        process.stdout.write(`${id}: median top ${r.medianTopMps} m/s, by seed ${r.topBySeed.join(' ')} (${((Date.now() - t0) / 1000).toFixed(0)} s) ${why}\n`);
    }
    if (out !== undefined) {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify({ ref: arg(argv, 'ref') ?? null, attendHum: argv.includes('--attend-hum'), turnDps: arg(argv, 'turn') ?? null, budget: arg(argv, 'budget') ?? null, line: arg(argv, 'line') ?? null, rungs, seeds, results }, null, 1)}\n`);
    }
    return 0;
}
