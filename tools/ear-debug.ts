import { getLesson } from '../src/lesson';
import { flyLesson } from '../src/pilot/ladder';

export function main(argv: readonly string[]): number {
    const id = argv[0] ?? 'corridor';
    const v = Number(argv[1] ?? '1');
    const every = Number(argv[2] ?? '500');
    const lines: string[] = [];
    const r = flyLesson(getLesson(id), v, 1, {
        ...(argv.includes('--attend-hum') ? { hearing: { attendHum: true } } : {}),
        trace: (f) => {
            if (f.t % every !== 0) return;
            const s = f.heard.streams.map((x) => `${x.cue}[${x.side}${x.behind ? 'B' : ''}${x.onCourse ? 'O' : ''}e${x.elevSteps} ${x.levelDb.toFixed(0)}]`).join(' ');
            const all = f.plan.voices.map((x) => `${x.cue}(${x.dir.map((d) => d.toFixed(2)).join(',')})`).join(' ');
            lines.push(`${(f.t / 1000).toFixed(1)} p=${f.pos.map((x) => x.toFixed(1)).join(',')} y=${f.yaw.toFixed(0)} u=${f.heard.urgent ? 1 : 0} | ${s} | cmd f${f.cmd.forwardMps.toFixed(1)} l${f.cmd.lateralMps.toFixed(1)} c${f.cmd.climbMps.toFixed(1)} y${f.cmd.yawDps.toFixed(0)} || ${all}`);
        }
    });
    process.stdout.write(lines.slice(-Number(argv[3] ?? '30')).join('\n') + `\n${JSON.stringify(r)}\n`);
    return 0;
}
