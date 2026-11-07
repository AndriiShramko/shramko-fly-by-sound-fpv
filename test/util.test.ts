import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    canonicalJson,
    CanonicalJsonError,
    createRng,
    Sha256,
    sha256Hex,
    utf8Encode,
    quatMatrix,
    quatRotate,
    yawQuat,
    quatMultiply,
    quatConjugate,
    type Vec3
} from '../src';

const nodeSha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

describe('sha256', () => {
    it('matches the FIPS 180-4 test vectors', () => {
        expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
        expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    });

    it('agrees with node:crypto on random inputs of every length around the block edges', () => {
        for (let len = 0; len <= 300; len++) {
            const data = Uint8Array.from(randomBytes(len));
            expect(sha256Hex(data), `length ${len}`).toBe(nodeSha(data));
        }
    });

    it('gives the same digest however the input is cut into updates', () => {
        const data = Uint8Array.from(randomBytes(10_000));
        const cuts = [1, 3, 63, 64, 65, 127, 128, 1000];
        for (const cut of cuts) {
            const h = new Sha256();
            for (let i = 0; i < data.length; i += cut) h.update(data.subarray(i, i + cut));
            expect(Buffer.from(h.digest()).toString('hex'), `cut ${cut}`).toBe(nodeSha(data));
        }
    });

    it('changes with one flipped bit (negative control) and refuses reuse', () => {
        const a = Uint8Array.from(randomBytes(100));
        const b = Uint8Array.from(a);
        b[50] = (b[50] as number) ^ 1;
        expect(sha256Hex(a)).not.toBe(sha256Hex(b));
        const h = new Sha256();
        h.digest();
        expect(() => h.update(a)).toThrow();
        expect(() => h.digest()).toThrow();
    });

    it('encodes UTF-8 like the platform, lone surrogates as U+FFFD', () => {
        for (const text of ['', 'abc', 'Привет, мир', 'Cześć', '¿Qué tal?', 'emoji \u{1F600} end', 'lone \ud800 high', 'lone \udc00 low', '\u0000\u007f\u0080߿ࠀ￿']) {
            expect(Buffer.from(utf8Encode(text)).toString('hex'), JSON.stringify(text)).toBe(Buffer.from(text, 'utf8').toString('hex'));
        }
    });
});

describe('canonicalJson', () => {
    it('sorts keys at every depth and writes no whitespace', () => {
        expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    });

    it('does not depend on the order keys were added', () => {
        const a: Record<string, number> = {};
        a['x'] = 1;
        a['y'] = 2;
        const b: Record<string, number> = {};
        b['y'] = 2;
        b['x'] = 1;
        expect(canonicalJson(a)).toBe(canonicalJson(b));
    });

    it('prints numbers the short way, -0 as 0, drops undefined keys', () => {
        expect(canonicalJson([1, 1.5, -0, 1e21, 0.1, 100])).toBe('[1,1.5,0,1e+21,0.1,100]');
        expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    });

    it('escapes strings like JSON', () => {
        expect(canonicalJson('a"b\\c\n\u0001')).toBe('"a\\"b\\\\c\\n\\u0001"');
        expect(canonicalJson('Привет')).toBe('"Привет"');
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['a function', () => 1],
        ['a bigint', 1n],
        ['a symbol', Symbol('x')],
        ['a Date', new Date(0)],
        ['an undefined array item', [1, undefined]]
    ])('refuses %s', (_name, value) => {
        expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
    });

    it('refuses a cycle and says where', () => {
        const a: Record<string, unknown> = { name: 'a' };
        a['self'] = a;
        expect(() => canonicalJson(a)).toThrow(/cycle at self/);
    });
});

describe('createRng', () => {
    it('is deterministic and pinned (mulberry32 of seed 1)', () => {
        const a = createRng(1);
        const first = [a.next(), a.next(), a.next()];
        const b = createRng(1);
        expect([b.next(), b.next(), b.next()]).toEqual(first);
        // pinned: the published mulberry32 sequence for seed 1; these numbers must never change, generated worlds are built from them
        expect(first.map((x) => Math.round(x * 1e9) / 1e9)).toEqual([0.627073941, 0.002735721, 0.52744704]);
    });

    it('differs between seeds', () => {
        expect(createRng(1).next()).not.toBe(createRng(2).next());
    });

    it('stays in range and has the right mean', () => {
        const r = createRng(7);
        let sum = 0;
        for (let i = 0; i < 20000; i++) {
            const x = r.range(-3, 5);
            expect(x).toBeGreaterThanOrEqual(-3);
            expect(x).toBeLessThan(5);
            sum += x;
        }
        expect(Math.abs(sum / 20000 - 1)).toBeLessThan(0.05);
        const ints = new Set<number>();
        for (let i = 0; i < 2000; i++) ints.add(r.int(2, 5));
        expect([...ints].sort()).toEqual([2, 3, 4, 5]);
        expect(new Set([r.sign(), r.sign(), r.sign(), r.sign(), r.sign(), r.sign(), r.sign(), r.sign()]).size).toBe(2);
    });
});

describe('quaternions', () => {
    const near = (a: Vec3, b: Vec3, tol = 1e-9): void => {
        expect(Math.abs(a[0] - b[0]), `x ${a} vs ${b}`).toBeLessThan(tol);
        expect(Math.abs(a[1] - b[1]), `y ${a} vs ${b}`).toBeLessThan(tol);
        expect(Math.abs(a[2] - b[2]), `z ${a} vs ${b}`).toBeLessThan(tol);
    };

    it('yaw turns the nose to the right: yaw 90 points along +X', () => {
        near(quatRotate(yawQuat(0), [0, 0, -1]), [0, 0, -1]);
        near(quatRotate(yawQuat(90), [0, 0, -1]), [1, 0, 0]);
        near(quatRotate(yawQuat(180), [0, 0, -1]), [0, 0, 1]);
        near(quatRotate(yawQuat(-90), [0, 0, -1]), [-1, 0, 0]);
        near(quatRotate(yawQuat(90), [1, 0, 0]), [0, 0, 1]); // the right hand side turns to +Z
        near(quatRotate(yawQuat(33), [0, 1, 0]), [0, 1, 0]);
    });

    it('the matrix and the rotation agree, and the conjugate undoes it', () => {
        const q = yawQuat(57);
        const m = quatMatrix(q);
        const v: Vec3 = [0.3, -1.2, 2.5];
        const viaMatrix: Vec3 = [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];
        near(quatRotate(q, v), viaMatrix);
        near(quatRotate(quatConjugate(q), quatRotate(q, v)), v);
        const twice = quatMultiply(q, q);
        near(quatRotate(twice, [0, 0, -1]), quatRotate(yawQuat(114), [0, 0, -1]));
    });
});
