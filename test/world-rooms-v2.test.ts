// Version 2 of the room generators (src/world/rooms-v2.ts): rooms at the scale of a micro drone, the
// start a set distance in front of the back wall, gates near the floor and under the ceiling, and gates
// at given heights (M41-22). Closed-form checks of each rule, and goldens: any change here is a new version.
import { describe, expect, it } from 'vitest';
import type { AnalyticWorldSpec, Vec3 } from '../src/contract';
import { canonicalJson } from '../src/util/canonical';
import { createRng } from '../src/util/rng';
import { sha256Hex } from '../src/util/sha256';
import { createAnalyticWorld, FLOOR_MARGIN_M, makeSpec, NEWEST_VERSION, WALL_MARGIN_M, WorldSpecError, type AnalyticWorldInfo } from '../src/world';

const v2 = (generator: AnalyticWorldSpec['generator'], params: AnalyticWorldSpec['params'] = {}, seed = 0): AnalyticWorldInfo => createAnalyticWorld(makeSpec(generator, params, seed, 2));
const close = (a: number, b: number, tol = 1e-3): void => {
    expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol);
};

function fingerprint(w: AnalyticWorldInfo): string {
    const rng = createRng(2024);
    const [lo, hi] = [w.bounds.min, w.bounds.max];
    const values: number[] = [];
    for (let i = 0; i < 600; i++) {
        const p: Vec3 = [rng.range(lo[0], hi[0]), rng.range(lo[1], hi[1]), rng.range(lo[2], hi[2])];
        values.push(Math.round(w.sdf(...p) * 1e4));
    }
    return sha256Hex(canonicalJson(values));
}

describe('version 2 of the rooms', () => {
    it('is the newest version of the five room generators; makeSpec still writes version 1 unless asked', () => {
        for (const g of ['hall', 'pillars', 'rings', 'squares', 'cube-frames'] as const) {
            expect(NEWEST_VERSION[g]).toBe(2);
            expect(makeSpec(g).version).toBe(1);
        }
    });

    it('the hall: a room 10 x 12 x 3.2 m around the start, in closed form', () => {
        const w = v2('hall');
        expect(w.start.pos).toEqual([0, 1.5, 0]);
        for (const [dir, d, material] of [
            [[0, 0, -1], 6, 'wall'],
            [[0, 0, 1], 6, 'wall'],
            [[1, 0, 0], 5, 'wall'],
            [[-1, 0, 0], 5, 'wall'],
            [[0, 1, 0], 1.7, 'ceiling'],
            [[0, -1, 0], 1.5, 'floor']
        ] as [Vec3, number, string][]) {
            const hit = w.castRay(w.start.pos, dir, 50)!;
            close(hit.distance, d);
            expect(hit.material).toBe(material);
        }
        // a version-2 hall of version 1's size has version 1's walls, under another digest
        const big = v2('hall', { widthM: 40, depthM: 60, heightM: 12 });
        const old = createAnalyticWorld(makeSpec('hall', {}, 0, 1));
        expect(fingerprint(big)).toBe(fingerprint(old));
        expect(big.digest).not.toBe(old.digest);
    });

    it('the pillars: the start 1.5 m in front of the back wall, the pillar 5.5 m ahead, a row 1 m clear of the walls', () => {
        const one = v2('pillars');
        expect(one.start.pos).toEqual([0, 1.5, 12.5 / 2 - 1.5]);
        expect(one.objects()[0]).toMatchObject({ id: 'pillar-1', pos: [0, 1.6, 12.5 / 2 - 1.5 - 5.5], shape: { kind: 'pillar', radius: 0.3, height: 3.2 } });
        const row = v2('pillars', { layout: 'row' });
        expect(row.objects().map((o) => o.pos[0])).toEqual([-4.6, -2.3, 0, 2.3, 4.6]);
        expect(() => v2('pillars', { layout: 'row', widthM: 11.7 })).toThrow(/does not fit a room 11.7 m wide/);
        const scatter = v2('pillars', { layout: 'scatter', count: 6, widthM: 10, depthM: 16 }, 5);
        const os = scatter.objects();
        expect(os).toHaveLength(6);
        for (const o of os) {
            expect(Math.abs(o.pos[0]) + 0.3 + WALL_MARGIN_M).toBeLessThanOrEqual(5 + 1e-6);
            expect(o.pos[2]).toBeLessThanOrEqual(scatter.start.pos[2] - 2 + 1e-6);
        }
        for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) expect(Math.hypot(os[i]!.pos[0] - os[j]!.pos[0], os[i]!.pos[2] - os[j]!.pos[2])).toBeGreaterThanOrEqual(2 * 0.3 + 1.5 - 1e-6);
        expect(() => v2('pillars', { startBackM: 12.4 })).toThrow(/start 12.4 m from the back wall does not fit/);
    });

    it('gates: the start 1.5 m in front of the back wall at gateY; a gate may come 0.3 m to the floor (version 1 kept 1 m)', () => {
        const ring = v2('rings');
        expect(ring.start.pos).toEqual([0, 3, 24.5 / 2 - 1.5]);
        expect(ring.objects()[0]!.pos).toEqual([0, 3, 24.5 / 2 - 1.5 - 5.5]);
        // a 3 m ring reaches 1.7 m from its centre: at y = 2.0 it is 0.3 m above the floor
        expect(v2('rings', { gateY: 2 }).objects()[0]!.pos[1]).toBe(2);
        expect(() => v2('rings', { gateY: 1.9 })).toThrow(WorldSpecError);
        expect(() => createAnalyticWorld(makeSpec('rings', { gateY: 2 }, 0, 1))).toThrow(/does not fit/);
        expect(FLOOR_MARGIN_M).toBe(0.3);
    });

    it('gates at levels: floor as low as the gate fits, ceiling as high, middle half the room; the start at the first one', () => {
        const w = v2('rings', { layout: 'line', count: 4, sizeM: 2, heightM: 5, depthM: 31, heights: 'middle,floor,ceiling' });
        // a 2 m ring reaches 1.2 m up and down: floor 0.3 + 1.2, ceiling 5 - 0.3 - 1.2; the last level repeats
        expect(w.objects().map((o) => o.pos[1])).toEqual([2.5, 1.5, 3.5, 3.5]);
        expect(w.start.pos[1]).toBe(2.5);
        expect(w.resolved['heights']).toBe('middle,floor,ceiling');
        // each gate's own size decides its floor and ceiling: a ring reaches diameter / 2 + 2 tubes from its centre
        const sized = v2('rings', { layout: 'line', sizes: [3, 1], heightM: 5, heights: 'floor, floor' });
        expect(sized.objects().map((o) => o.pos[1])).toEqual([2, 1]);
        expect(sized.resolved['heights']).toBe('floor,floor');
        // metres
        expect(v2('rings', { layout: 'line', count: 3, sizeM: 2, heightM: 5, heights: [1.6, 3.4] }).objects().map((o) => o.pos[1])).toEqual([1.6, 3.4, 3.4]);
        // a course keeps its random walk and only takes the heights
        const walk = v2('rings', { layout: 'course', count: 5, sizeM: 2, heightM: 5, depthM: 40 }, 4);
        const lifted = v2('rings', { layout: 'course', count: 5, sizeM: 2, heightM: 5, depthM: 40, heights: 'floor,ceiling' }, 4);
        expect(lifted.objects().map((o) => [o.pos[0], o.pos[2], o.quat])).toEqual(walk.objects().map((o) => [o.pos[0], o.pos[2], o.quat]));
        expect(lifted.objects().map((o) => o.pos[1])).toEqual([1.5, 3.5, 3.5, 3.5, 3.5]);
    });

    it.each([
        ['an unknown level', { heights: 'floor,attic' }, /floor, middle, ceiling joined by commas/],
        ['a level in capitals', { heights: 'Floor' }, /floor, middle, ceiling/],
        ['a height out of range', { heights: [0.1] }, /between 0.3 and 99/],
        ['too many', { heights: Array.from({ length: 25 }, () => 2) }, /at most 24/],
        ['a height the gate does not fit', { heights: [4.9] }, /does not fit/]
    ] as [string, AnalyticWorldSpec['params'], RegExp][])('refuses %s', (_name, params, reason) => {
        expect(() => v2('rings', params)).toThrow(reason);
    });
});

describe('golden worlds of version 2: any change here means a new generator version', () => {
    const GOLDEN: { name: string; generator: AnalyticWorldSpec['generator']; params: AnalyticWorldSpec['params']; seed: number; digest: string; objects: string; field: string }[] = [
        { name: 'hall', generator: 'hall', params: {}, seed: 0, digest: '4fed66a6560be01bb8fa7bc9ffe3f77b22d9bf04d4210e746cac948d2ddd8c6e', objects: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', field: 'ab68741a604e6dbc12065334c7580492ee68ea27897402c29824ff9bd0f8e51d' },
        { name: 'pillars', generator: 'pillars', params: {}, seed: 0, digest: '67f96f9f5c6a83dce312612511b3e53751fea5e5690fd266b6ad2ff50e5dab0c', objects: '753327873ec7ea5b0d52f184fd043ba6e6d425e824dc8809202032de92184212', field: '8e18fb03cb87e67247034474de37ef7a097fcb281d0dd890ac603db972dbc2f8' },
        { name: 'pillars row', generator: 'pillars', params: { layout: 'row' }, seed: 0, digest: 'f98b466f6e3c4fc5137c918d0e8aa6a59c1cff6ff4cb02c38c95aec30e01c999', objects: '92d9789c41f63880b54242d9d07d30d9fe5b4f3737d9c4fc11f087a30e538a1e', field: 'f09739b367383252cf16557e73d2dd371f051768d311476b73479fabe34e7e4e' },
        { name: 'pillars scatter', generator: 'pillars', params: { layout: 'scatter', count: 6, widthM: 10, depthM: 16 }, seed: 5, digest: '5758d17fb8ba37e2eda9ba1489e2ca8bd30642203016c69b36747e9b5c1e1190', objects: 'cd825bd34c53b664b65fbee8307945ad5dfbe28523e9faab723d11a1015b7a90', field: '30a226ce420bcf70597819f18c2fda29b70fd946bc9881cbb33278b08412348b' },
        { name: 'rings', generator: 'rings', params: {}, seed: 0, digest: 'e71644d2d7727f92b50557abc24d5f5f9830147bb1f56d30fe6fbf01b121bf9d', objects: 'b5204499faeeb0c17bceb2d29e0fc3ab76d3476f30cb1e5b8b04ed7bf5379dc9', field: '52a72262a00b8cb5d1029711256b004459af7147cc30348913569ab50a5bc972' },
        { name: 'rings levels', generator: 'rings', params: { layout: 'line', count: 4, sizeM: 2, heightM: 5, depthM: 31, heights: 'middle,floor,ceiling' }, seed: 0, digest: 'f90983f751e81148cfd66d331b7ac582092c1e7ea4f27ed51ab848235cc69646', objects: 'ede549e35f4d9b39b71e9c714182c7d1b6d60fe6018bf03b9ffa0078843beec8', field: '24d6274d63669c57685a4f0fa68a9a89b1b0e1d3cba46265d5e15b0c61b0f14d' },
        { name: 'rings course', generator: 'rings', params: { layout: 'course', count: 6, depthM: 45 }, seed: 4, digest: 'f7b3f6c0b43656f6808a0430bbb19c0074807a3f0c2d610ed2df495e9fffb680', objects: 'ba5f4ea8a950770d052b25d948024d7bdef7ec6b4b5c60a1e48d1df60e96a0e2', field: '1f2939c3e655ca169338b8a4cecc71b9a3bd3aedc01a863f65b833488105848e' },
        { name: 'squares turn', generator: 'squares', params: { layout: 'turn', count: 4, widthM: 22, depthM: 31 }, seed: 0, digest: '470469d46cb9cd17bb71b5d37608dd7d9335465d1e9884958876bd37eaf60f99', objects: '9617092804be9e335bdc0c6758b70842ed60b14337a4752f1c95a9c5b4fb62d1', field: 'd266f4edaf87251bb6c811d8277c567f0007553c4b40a30bb734259174700ba6' },
        { name: 'cube-frames', generator: 'cube-frames', params: {}, seed: 0, digest: '38962cf0a32e28a8eb3f318449729458ad6f92bbf76710245b4f158acf5e6423', objects: 'e66af0dbb3123bf7b04db67260e649399905ec3cd2e6627948b7482bdc6b4233', field: 'a2df88ef1282fb5570621f3a1224c0ac28c770df2414a3091853fe145271603a' }
    ];

    it('the fingerprints see a change of a version-2 room (negative control)', () => {
        const hall = GOLDEN.find((g) => g.name === 'hall')!;
        expect(fingerprint(v2('hall', { widthM: 10.01 }))).not.toBe(hall.field);
        expect(fingerprint(v2('hall', { heightM: 3.25 }))).not.toBe(hall.field);
        const levels = GOLDEN.find((g) => g.name === 'rings levels')!;
        expect(sha256Hex(canonicalJson(v2('rings', { ...levels.params, heights: 'middle,floor,middle' }).objects()))).not.toBe(levels.objects);
    });

    it.each(GOLDEN)('$name', (g) => {
        const w = v2(g.generator, g.params, g.seed);
        const got = { digest: w.digest, objects: sha256Hex(canonicalJson(w.objects())), field: fingerprint(w) };
        expect(got).toEqual({ digest: g.digest, objects: g.objects, field: g.field });
    });
});
