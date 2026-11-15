// Owner, message 53 (simulator lane onecourse, D7): "If I flew past a gate and then want to come back to that gate,
// you shout at me that I fly the wrong way. How am I to come back to the gate then?" "Wrong way" is judged against the
// pilot's goal, the gate that counts next: while the craft comes nearer to that gate, or to its line-up point in front
// of it, nothing says "wrong way". A gate passed beside it or over it is said once, where it is ("The gate is behind
// you"), and it still counts when it is passed from its front after the return. "Wrong way" stays for a pilot who
// turns round between two gates and flies nose-first back along the course away from the next gate; backing up and
// sliding stay silent (message 48).
//
// The four cases fly an open course (no walls) of four rings 20 m apart along -Z. With D7_OUT set, the lines said in
// each case and their times (s from the start of the case) are written to that file (the measurement of the stage).
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SonicObject, TrackFile, Vec3 } from '../src/contract';
import { getLesson, lineUpM } from '../src/lesson';
import { parseTrack, trackToObjects } from '../src/track';
import { quatRotate, yawQuat } from '../src/util/vec';
import { ScriptedPilot } from './helpers/pilot';

const GAP_M = 20;
const Y = 1.5;

/** four rings of the Winter Garden's track (their shape), 20 m apart along -Z, fronts toward +Z: gate k at z = -10 - 20 (k - 1) */
const RINGS: SonicObject[] = (() => {
    const r = parseTrack(readFileSync(new URL('./fixtures/track-7a475d38-rings-v1.json', import.meta.url), 'utf8'));
    if (!r.ok) throw new Error('the Winter Garden track does not parse');
    const template = trackToObjects(r.value as TrackFile)[0] as SonicObject;
    return [0, 1, 2, 3].map((k) => ({ ...template, id: `ring-${k + 1}`, order: k + 1, pos: [0, Y, -10 - GAP_M * k] as Vec3, quat: yawQuat(0) }));
})();

const at = (g: SonicObject, l: Vec3): Vec3 => {
    const r = quatRotate(g.quat, l);
    return [g.pos[0] + r[0], g.pos[1] + r[1], g.pos[2] + r[2]];
};
/** beyond the ring's frame and its near miss (2 m) by `m` metres */
const clear = (g: SonicObject, m: number): number => (g.shape as { diameter: number }).diameter / 2 + 2 * (g.shape as { tube: number }).tube + 2 + m;

interface Said { readonly key: string; readonly s: number }
interface Flight { readonly p: ScriptedPilot; readonly said: Said[] }

function fly(): Flight {
    const p = new ScriptedPilot(getLesson('free-garden'), { objects: RINGS, start: { pos: [0, Y, 5], yawDeg: 0 } }, null);
    p.begin();
    p.until(() => p.run.phase === 'flying', 60);
    const said: Said[] = [];
    const t0 = p.t;
    let seen = p.actions.length;
    const tick = p.tick.bind(p);
    p.tick = () => {
        tick();
        for (; seen < p.actions.length; seen++) {
            const a = p.actions[seen];
            if (a?.kind === 'say' && a.line.key.startsWith('fly.')) said.push({ key: a.line.key, s: Math.round((p.t - t0) / 100) / 10 });
        }
    };
    // ring 1, forward
    p.flyTo(at(RINGS[0] as SonicObject, [0, 0, 3]), 4);
    p.flyTo(at(RINGS[0] as SonicObject, [0, 0, -2]), 4);
    return { p, said };
}

const count = (f: Flight, key: string): number => f.said.filter((x) => x.key === key).length;
const gates = (f: Flight): string[] => f.p.of('gate').map((g) => g.gateId);
const record: Record<string, Said[]> = {};
const done = (name: string, f: Flight): void => {
    record[name] = f.said.filter((x) => x.key !== 'fly.gate' && !x.key.startsWith('fly.stage'));
    if (process.env['D7_OUT']) writeFileSync(process.env['D7_OUT'], JSON.stringify(record, null, 1));
};

describe('coming back to a gate that was missed (owner, message 53; D7)', () => {
    const r2 = RINGS[1] as SonicObject;
    const lineUp = lineUpM(GAP_M);

    it.each([
        ['a: 3 m beside ring 2, 10 m past, back to its line-up point', 3],
        ['a-wide: 9 m beside ring 2, 10 m past, back to its line-up point', 9]
    ] as const)('%s: no "wrong way", "the gate is behind you" once, ring 2 counts after the return', (name, beside) => {
        const f = fly();
        const x = clear(r2, beside);
        f.p.flyTo(at(r2, [x, 0, 3]), 5);
        f.p.flyTo(at(r2, [x, 0, -10]), 5); // past it beside, 10 m
        f.p.turnTo(f.p.yaw + 180);
        f.p.flyTo(at(r2, [0, 0, lineUp]), 5); // nose-first back to the place in front of it
        f.p.face(r2.pos);
        f.p.flyTo(at(r2, [0, 0, -3]), 5); // and through it
        done(name, f);
        expect(gates(f)).toEqual(['ring-1', 'ring-2']);
        expect(count(f, 'fly.wrong-way')).toBe(0);
        expect(count(f, 'fly.gate-behind')).toBe(1);
    }, 60000);

    it('a-near: 3 m from ring 2\'s centre (inside its near miss), 10 m past, back: what is said (measured, the attempt ends at a near miss)', () => {
        const f = fly();
        f.p.flyTo(at(r2, [3, 0, 3]), 5);
        f.p.flyTo(at(r2, [3, 0, -10]), 5);
        f.p.turnTo(f.p.yaw + 180);
        f.p.flyTo(at(r2, [0, 0, lineUp]), 5);
        f.p.face(r2.pos);
        f.p.flyTo(at(r2, [0, 0, -3]), 5);
        done(`a-near: 3 m from ring 2's centre (edge ${clear(r2, -2).toFixed(2)} m), 10 m past, back; phase ${f.p.run.phase}, gates ${gates(f).join(' ')}`, f);
        expect(count(f, 'fly.wrong-way')).toBe(0);
    }, 60000);

    it('b: over ring 2, back and through it: no "wrong way", "the gate is behind you" once, ring 2 counts', () => {
        const f = fly();
        const y = clear(r2, 1);
        f.p.flyTo(at(r2, [0, y, 3]), 5);
        f.p.flyTo(at(r2, [0, y, -6]), 5); // over it
        f.p.turnTo(f.p.yaw + 180);
        f.p.flyTo(at(r2, [0, 0, lineUp]), 5);
        f.p.face(r2.pos);
        f.p.flyTo(at(r2, [0, 0, -3]), 5);
        done('b: over ring 2, back to its line-up point', f);
        expect(gates(f)).toEqual(['ring-1', 'ring-2']);
        expect(count(f, 'fly.wrong-way')).toBe(0);
        expect(count(f, 'fly.gate-behind')).toBe(1);
    }, 60000);

    it('c (control): turned round between ring 1 and ring 2, nose-first back along the course away from ring 2: "wrong way" is said', () => {
        const f = fly();
        f.p.flyTo(at(r2, [0, 0, GAP_M - 6]), 4); // 6 m past ring 1
        f.p.turnTo(f.p.yaw + 180);
        f.p.flyTo(at(RINGS[0] as SonicObject, [0, 0, 8]), 4); // back over ring 1 and 8 m on
        done('c: turned round between ring 1 and ring 2, back along the course', f);
        expect(count(f, 'fly.wrong-way')).toBeGreaterThanOrEqual(1);
        expect(count(f, 'fly.gate-behind')).toBe(0);
    }, 60000);

    it('d (control): backing up and sliding between ring 1 and ring 2 stay silent', () => {
        const f = fly();
        f.p.flyTo(at(r2, [0, 0, GAP_M - 6]), 4);
        const yaw = f.p.yaw;
        f.p.flyTo(at(RINGS[0] as SonicObject, [0, 0, -3]), 3, false); // backing up, nose forward
        f.p.turnTo(yaw + 90);
        f.p.flyTo(at(r2, [0, 0, GAP_M - 6]), 3, false); // sliding forward along the course, nose across it
        f.p.flyTo(at(RINGS[0] as SonicObject, [0, 0, -3]), 3, false); // sliding back
        done('d: backing up and sliding between ring 1 and ring 2', f);
        expect(f.p.yaw).toBe(yaw + 90);
        expect(count(f, 'fly.wrong-way')).toBe(0);
        expect(count(f, 'fly.gate-behind')).toBe(0);
    }, 60000);
});
