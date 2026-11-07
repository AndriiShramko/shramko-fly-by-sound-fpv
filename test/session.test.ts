import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FlightFrame, SessionEvent } from '../src/contract';
import {
    base64Url,
    buildManifest,
    crc32,
    decodeEvent,
    decodeFrame,
    DEFAULT_CHUNK_FRAMES,
    encodeEvent,
    encodeFrame,
    gunzipMembers,
    gzipStored,
    GzipError,
    inflateRaw,
    InflateError,
    MemorySink,
    newSessionId,
    packFiles,
    packSession,
    PackageError,
    parseManifest,
    readPackage,
    readZip,
    recoverSession,
    roundEvent,
    roundFrame,
    SessionError,
    SessionWriter,
    validateEvent,
    validateFrame,
    validateManifest,
    validateSurveyAnswers,
    webGzip,
    writeManifest,
    ZipError,
    ZipWriter,
    isSafeEntryName,
    type ChunkSink,
    type GzipFn
} from '../src/session';
import { createRng, sha256Hex, utf8Decode, utf8Encode } from '../src/util';
import { yawQuat } from '../src/util/vec';
import { CONSENT, CONSENT_VOICE, fakeFrames, manifestInput } from './helpers/session-input';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(HERE, 'fixtures', name)));

/** Deterministic bytes: `compressible` text-like data or noise. */
function sampleBytes(n: number, kind: 'text' | 'noise' | 'zeros', seed = 7): Uint8Array {
    if (kind === 'zeros') return new Uint8Array(n);
    const rng = createRng(seed);
    if (kind === 'noise') return Uint8Array.from({ length: n }, () => rng.int(0, 255));
    const words = ['height.tone', 'room.bed', '"t":', '"tick":', '[0.123,2.5,-1.25]', 'safety.wall:front', '\n'];
    const parts: string[] = [];
    let size = 0;
    while (size < n) {
        const w = words[rng.int(0, words.length - 1)] as string;
        parts.push(w);
        size += w.length;
    }
    return utf8Encode(parts.join('').slice(0, n));
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const nodeGzip: GzipFn = (bytes) => Promise.resolve(new Uint8Array(zlib.gzipSync(bytes)));

describe('CRC-32', () => {
    it('matches the published check value and zlib', () => {
        expect(crc32(utf8Encode('123456789'))).toBe(0xcbf43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
        const data = sampleBytes(5000, 'noise');
        if (typeof zlib.crc32 === 'function') expect(crc32(data)).toBe(zlib.crc32(data));
        // incremental: any split gives the same answer
        for (const cut of [0, 1, 17, 2500, 5000]) expect(crc32(data.subarray(cut), crc32(data.subarray(0, cut)))).toBe(crc32(data));
    });

    it('changes when a byte changes (negative control)', () => {
        const data = sampleBytes(100, 'text');
        const flipped = data.slice();
        flipped[40] = (flipped[40] as number) ^ 1;
        expect(crc32(flipped)).not.toBe(crc32(data));
    });
});

describe('utf8 and base64url', () => {
    it('decodes what it encodes, and repairs what is broken', () => {
        const text = 'Zawiśnij na wysokości. Висите \u{1f50a} done';
        expect(utf8Decode(utf8Encode(text))).toBe(text);
        expect(utf8Decode(Uint8Array.of(0x61, 0xff, 0x62))).toBe('a�b');
        expect(utf8Decode(Uint8Array.of(0xc3))).toBe('�');
        expect(utf8Decode(Uint8Array.of(0xed, 0xa0, 0x80))).toBe('���'); // a surrogate is not UTF-8
        const long = 'x'.repeat(20000) + 'é';
        expect(utf8Decode(utf8Encode(long))).toBe(long);
    });

    it('base64url agrees with Node', () => {
        for (const n of [0, 1, 2, 3, 4, 16, 33]) {
            const b = sampleBytes(n, 'noise', n + 1);
            expect(base64Url(b)).toBe(Buffer.from(b).toString('base64url'));
        }
    });

    it('session ids are 22 URL-safe characters from the random source', () => {
        const id = newSessionId(() => Uint8Array.from({ length: 16 }, (_, i) => i * 15));
        expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(newSessionId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(newSessionId()).not.toBe(newSessionId());
    });
});

describe('inflate and gzip members', () => {
    const inputs: [string, Uint8Array][] = [
        ['empty', new Uint8Array(0)],
        ['one byte', Uint8Array.of(42)],
        ['text 100', sampleBytes(100, 'text')],
        ['text 200 000', sampleBytes(200000, 'text')],
        ['noise 70 000 (stored blocks)', sampleBytes(70000, 'noise')],
        ['zeros 1 MiB (distance 1 copies)', sampleBytes(1 << 20, 'zeros')]
    ];

    it('reads what zlib writes at every level and strategy', () => {
        for (const [, data] of inputs) {
            for (const level of [0, 1, 6, 9]) {
                const r = gunzipMembers(new Uint8Array(zlib.gzipSync(data, { level })));
                expect(same(r.data, data)).toBe(true);
                expect(r.members).toHaveLength(1);
            }
            for (const strategy of [zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY, zlib.constants.Z_RLE, zlib.constants.Z_FILTERED]) {
                expect(same(gunzipMembers(new Uint8Array(zlib.gzipSync(data, { strategy }))).data, data)).toBe(true);
            }
        }
    });

    it('reads a file of several members and says where each one ends', () => {
        const parts = [sampleBytes(1000, 'text', 1), new Uint8Array(0), sampleBytes(3000, 'text', 2), sampleBytes(10, 'noise', 3)];
        const members = parts.map((p) => new Uint8Array(zlib.gzipSync(p)));
        const file = new Uint8Array(members.reduce((n, m) => n + m.length, 0));
        let at = 0;
        const ends: number[] = [];
        for (const m of members) {
            file.set(m, at);
            at += m.length;
            ends.push(at);
        }
        const r = gunzipMembers(file);
        expect(r.members.map((m) => m.end)).toEqual(ends);
        expect(same(r.data, new Uint8Array(Buffer.concat(parts)))).toBe(true);
        // zlib itself agrees that this is one stream of members
        expect(same(new Uint8Array(zlib.gunzipSync(file)), r.data)).toBe(true);
    });

    it('reads the header fields zlib does not write (name, comment, extra, header CRC)', () => {
        const body = new Uint8Array(zlib.deflateRawSync(sampleBytes(500, 'text', 9)));
        const data = sampleBytes(500, 'text', 9);
        const name = utf8Encode('flight.jsonl\0');
        const comment = utf8Encode('a comment\0');
        const extra = Uint8Array.of(7, 0, 0x41, 0x42, 3, 0, 1, 2, 3); // XLEN 7, then one subfield
        const header = Uint8Array.of(0x1f, 0x8b, 8, 2 | 4 | 8 | 16, 1, 2, 3, 4, 0, 3);
        const hcrc = Uint8Array.of(0, 0);
        const trailer = new Uint8Array(8);
        new DataView(trailer.buffer).setUint32(0, crc32(data), true);
        new DataView(trailer.buffer).setUint32(4, data.length, true);
        const file = new Uint8Array([...header, ...extra, ...name, ...comment, ...hcrc, ...body, ...trailer]);
        expect(same(gunzipMembers(file).data, data)).toBe(true);
    });

    it('writes members zlib can read: stored fallback and the platform compressor', async () => {
        for (const [, data] of inputs) {
            expect(same(new Uint8Array(zlib.gunzipSync(gzipStored(data))), data)).toBe(true);
            expect(same(gunzipMembers(gzipStored(data)).data, data)).toBe(true);
        }
        expect(gzipStored(sampleBytes(70000, 'noise')).length).toBeGreaterThan(70000);
        const web = webGzip();
        expect(web).not.toBeNull();
        if (web !== null) {
            const data = sampleBytes(50000, 'text', 5);
            const member = await web(data);
            expect(member.length).toBeLessThan(data.length / 2);
            expect(same(new Uint8Array(zlib.gunzipSync(member)), data)).toBe(true);
            expect(same(gunzipMembers(member).data, data)).toBe(true);
            // two chunks written one after the other make one readable file
            const two = new Uint8Array([...(await web(sampleBytes(100, 'text', 1))), ...(await web(sampleBytes(100, 'text', 2)))]);
            expect(gunzipMembers(two).members).toHaveLength(2);
        }
    });

    it('stops a compression bomb at the limit', () => {
        const bomb = new Uint8Array(zlib.gzipSync(sampleBytes(1 << 20, 'zeros')));
        expect(bomb.length).toBeLessThan(2000);
        expect(() => gunzipMembers(bomb, { limit: 1000 })).toThrow(GzipError);
        expect(() => inflateRaw(new Uint8Array(zlib.deflateRawSync(sampleBytes(1 << 20, 'zeros'))), 0, 1000)).toThrow(InflateError);
        expect(gunzipMembers(bomb, { limit: 1 << 20 }).data.length).toBe(1 << 20);
    });

    it('refuses a truncated file at every length, and tolerant reading keeps the whole members', () => {
        const a = new Uint8Array(zlib.gzipSync(sampleBytes(300, 'text', 1)));
        const b = new Uint8Array(zlib.gzipSync(sampleBytes(300, 'text', 2)));
        for (let len = 1; len < a.length; len++) {
            expect(() => gunzipMembers(a.subarray(0, len))).toThrow(GzipError);
            const t = gunzipMembers(a.subarray(0, len), { tolerateTail: true });
            expect(t.validEnd).toBe(0);
            expect(t.error).not.toBeNull();
        }
        const file = new Uint8Array([...a, ...b, ...b.subarray(0, 40)]);
        const t = gunzipMembers(file, { tolerateTail: true });
        expect(t.members).toHaveLength(2);
        expect(t.validEnd).toBe(a.length + b.length);
        expect(t.error).toMatch(/member 3/);
        expect(() => gunzipMembers(file)).toThrow(/member 3/);
    });

    it('never returns wrong data for a damaged file; the CRC is what catches it (control: raw inflate would)', () => {
        const data = sampleBytes(2000, 'text', 11);
        const good = new Uint8Array(zlib.gzipSync(data));
        const rng = createRng(99);
        let silentWithoutCrc = 0;
        for (let i = 0; i < 400; i++) {
            const bad = good.slice();
            const at = rng.int(0, bad.length - 1);
            bad[at] = (bad[at] as number) ^ (1 << rng.int(0, 7));
            try {
                const r = gunzipMembers(bad);
                expect(same(r.data, data)).toBe(true); // harmless flips (mtime, os byte) still give the same bytes
            } catch (e) {
                expect(e).toBeInstanceOf(GzipError);
            }
            // control: without the trailer check, a flip in the deflate body often gives other data without any error
            if (at >= 10 && at < bad.length - 8) {
                try {
                    if (!same(inflateRaw(bad, 10).data, data)) silentWithoutCrc++;
                } catch {
                    // an invalid stream is caught by inflate itself
                }
            }
        }
        expect(silentWithoutCrc).toBeGreaterThan(0);
    });
});

describe('zip', () => {
    const entries: [string, Uint8Array][] = [
        ['manifest.json', utf8Encode('{"a":1}\n')],
        ['empty.bin', new Uint8Array(0)],
        ['dir/flight.jsonl.gz', sampleBytes(70000, 'noise', 3)],
        ['events.jsonl', sampleBytes(5000, 'text', 4)]
    ];

    function build(date?: string): ZipWriter {
        const z = new ZipWriter(date === undefined ? {} : { date });
        for (const [n, d] of entries) z.add(n, d);
        return z;
    }

    it('round-trips store-only entries, as parts or as bytes', () => {
        const z = build('2026-11-07T10:20:30Z');
        const parts = z.finish();
        const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const p of parts) {
            joined.set(p, at);
            at += p.length;
        }
        const read = readZip(joined);
        expect([...read.keys()]).toEqual(entries.map(([n]) => n));
        for (const [n, d] of entries) expect(same(read.get(n) as Uint8Array, d)).toBe(true);
        expect(same(build('2026-11-07T10:20:30Z').bytes(), joined)).toBe(true);
    });

    it('is deterministic, and the stored time is the one asked for', () => {
        expect(same(build('2026-11-07T10:20:30Z').bytes(), build('2026-11-07T10:20:30Z').bytes())).toBe(true);
        expect(same(build('2026-11-07T10:20:30Z').bytes(), build('2026-11-07T10:20:32Z').bytes())).toBe(false);
        expect(same(build().bytes(), build('1980-01-01T00:00:00Z').bytes())).toBe(true);
    });

    it('accepts parts for one entry', () => {
        const z = new ZipWriter();
        z.add('x.bin', [sampleBytes(10, 'noise', 1), sampleBytes(20, 'noise', 2)]);
        const r = readZip(z.bytes());
        expect(r.get('x.bin')).toHaveLength(30);
    });

    it('refuses unsafe and repeated names when writing', () => {
        for (const bad of ['', '../x', '/abs', 'a\\b', 'c:x', 'a//b', './a', 'a/./b', 'a/../b', 'tab\tname', 'x'.repeat(300)]) {
            expect(isSafeEntryName(bad)).toBe(false);
            expect(() => new ZipWriter().add(bad, new Uint8Array(0))).toThrow(ZipError);
        }
        expect(isSafeEntryName('flight.jsonl.gz')).toBe(true);
        const z = new ZipWriter();
        z.add('a', new Uint8Array(0));
        expect(() => z.add('a', new Uint8Array(0))).toThrow(/twice/);
    });

    it('reads archives written by another tool: Python stored, and Python deflated with data descriptors and a comment', () => {
        const stored = readZip(fixture('session-python-store.zip'));
        const deflated = readZip(fixture('session-python-deflate.zip'));
        expect([...stored.keys()]).toEqual(['manifest.json', 'flight.jsonl.gz', 'events.jsonl', 'survey.json']);
        expect([...deflated.keys()]).toEqual([...stored.keys()]);
        expect(same(stored.get('flight.jsonl.gz') as Uint8Array, deflated.get('flight.jsonl.gz') as Uint8Array)).toBe(true);
    });

    const hasPython = ((): boolean => {
        const r = spawnSync('python', ['--version']);
        return r.status === 0;
    })();

    it.skipIf(!hasPython)('writes archives another tool accepts (Python zipfile tests them)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'sonic-zip-'));
        try {
            const path = join(dir, 'ours.zip');
            writeFileSync(path, build('2026-11-07T10:20:30Z').bytes());
            const script = 'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(",".join(sorted(z.namelist())))\n';
            const r = spawnSync('python', ['-c', script, path], { encoding: 'utf8' });
            expect(r.status).toBe(0);
            expect(r.stdout.trim()).toBe(entries.map(([n]) => n).sort().join(','));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refuses damage: a changed byte (CRC), every truncation, patched headers', () => {
        const good = build().bytes();
        // a flipped byte inside stored data fails its CRC-32
        const flipped = good.slice();
        flipped[30 + 'manifest.json'.length + 1] = (flipped[30 + 'manifest.json'.length + 1] as number) ^ 0x10;
        expect(() => readZip(flipped)).toThrow(/CRC-32/);
        // every prefix of a real archive is refused with ZipError, never another error, never a result
        const py = fixture('session-python-deflate.zip');
        for (let len = 0; len < py.length; len++) {
            let threw: unknown = null;
            try {
                readZip(py.subarray(0, len));
            } catch (e) {
                threw = e;
            }
            expect(threw, `prefix of ${len} bytes`).toBeInstanceOf(ZipError);
        }
        // patched central-directory fields: an unsupported method, encryption, ZIP64 markers
        const cd = new DataView(good.buffer, good.byteOffset, good.byteLength).getUint32(good.length - 22 + 16, true);
        const patch = (f: (v: DataView) => void): Uint8Array => {
            const b = good.slice();
            f(new DataView(b.buffer, b.byteOffset, b.byteLength));
            return b;
        };
        expect(() => readZip(patch((v) => v.setUint16(cd + 10, 9, true)))).toThrow(/method 9/);
        expect(() => readZip(patch((v) => v.setUint16(cd + 8, 1, true)))).toThrow(/encrypted/);
        expect(() => readZip(patch((v) => v.setUint32(cd + 20, 0xffffffff, true)))).toThrow(/ZIP64/);
        expect(() => readZip(patch((v) => v.setUint16(good.length - 22 + 10, 0xffff, true)))).toThrow(ZipError);
        // a name that would climb out of a folder: 'dir/' becomes '../a' in the local and the central header
        const escape = Buffer.from(good);
        let from = 0;
        for (;;) {
            const i = escape.indexOf('dir/', from);
            if (i < 0) break;
            escape.write('../a', i);
            from = i + 1;
        }
        expect(() => readZip(new Uint8Array(escape))).toThrow(/safe entry name/);
        // control: the unpatched archive reads
        expect(readZip(good).size).toBe(entries.length);
    });

    it('refuses a duplicate name and an oversized entry', () => {
        const z = new ZipWriter();
        z.add('aaa', sampleBytes(10, 'noise', 1));
        z.add('bbb', sampleBytes(10, 'noise', 2));
        const bytes = Buffer.from(z.bytes());
        let from = 0;
        for (;;) {
            const i = bytes.indexOf(Buffer.from('bbb'), from);
            if (i < 0) break;
            Buffer.from('aaa').copy(bytes, i);
            from = i + 1;
        }
        expect(() => readZip(new Uint8Array(bytes))).toThrow(/twice/);
        expect(() => readZip(build().bytes(), { maxEntryBytes: 1000 })).toThrow(/limit/);
        expect(() => readZip(build().bytes(), { maxTotalBytes: 1000 })).toThrow(/limit/);
    });

    it('survives random bit flips of a real archive: an error, or only bytes some original entry had', () => {
        const py = fixture('session-python-deflate.zip');
        const want = readZip(py);
        const known = new Set([...want.values()].map((d) => sha256Hex(d)));
        const rng = createRng(5);
        let errors = 0;
        for (let i = 0; i < 300; i++) {
            const bad = py.slice();
            const at = rng.int(0, bad.length - 1);
            bad[at] = (bad[at] as number) ^ (1 << rng.int(0, 7));
            let got: Map<string, Uint8Array> | null = null;
            try {
                got = readZip(bad);
            } catch (e) {
                expect(e).toBeInstanceOf(ZipError);
                errors++;
            }
            // a flipped letter of a NAME gives an entry another name, but its bytes are still an original's
            if (got !== null) for (const d of got.values()) expect(known.has(sha256Hex(d))).toBe(true);
        }
        expect(errors).toBeGreaterThan(100);
    });
});

describe('frame codec', () => {
    const frame: FlightFrame = { t: 1234.567, tick: 1200.2, p: [1.23456, -0.0004, 99.9996], v: [0.00049, 2, -3.14159], q: yawQuat(33), s: [0.123456, -1, 0.5, 0], c: ['height.tone', 'safety.wall:front'] };

    it('rounds to the file precision and reads back exactly that', () => {
        const line = encodeFrame(frame);
        expect(line).not.toContain('\n');
        const back = decodeFrame(line);
        expect(back.ok).toBe(true);
        if (back.ok) {
            expect(back.value).toEqual(roundFrame(frame));
            expect(back.value.t).toBe(1235);
            expect(back.value.p).toEqual([1.235, 0, 100]);
            expect(back.value.s[0]).toBe(0.123);
            for (let i = 0; i < 4; i++) expect(Math.abs((back.value.q[i] as number) - (frame.q[i] as number))).toBeLessThanOrEqual(5e-5 + 1e-12);
        }
        // the layout is part of the format: pinned
        expect(encodeFrame({ t: 0, tick: 0, p: [0, 1.5, -2], v: [0, 0, 0], q: [1, 0, 0, 0], s: [0, 0, 0, 0], c: [] })).toBe('{"t":0,"tick":0,"p":[0,1.5,-2],"v":[0,0,0],"q":[1,0,0,0],"s":[0,0,0,0],"c":[]}');
    });

    it('refuses what is not a frame, with the path of each problem', () => {
        expect(() => encodeFrame({ ...frame, p: [Number.NaN, 0, 0] })).toThrow(RangeError);
        const bad = (patch: Record<string, unknown>): string => {
            const r = validateFrame({ ...JSON.parse(encodeFrame(frame)), ...patch });
            return r.ok ? 'ok' : r.issues.map((i) => i.path).join(',');
        };
        expect(bad({})).toBe('ok');
        expect(bad({ p: [1, 2] })).toBe('p');
        expect(bad({ q: [2, 0, 0, 0] })).toBe('q');
        expect(bad({ s: [0, 0, 0, 1.5] })).toBe('s');
        expect(bad({ c: [1] })).toBe('c');
        expect(bad({ t: -1 })).toBe('t');
        expect(bad({ extra: 1 })).toBe('extra');
        expect(bad({ c: Array.from({ length: 65 }, (_, i) => `c${i}`) })).toBe('c');
        expect(decodeFrame('{"t":1').ok).toBe(false);
        expect(decodeFrame('[]').ok).toBe(false);
    });
});

describe('event codec', () => {
    const all: SessionEvent[] = [
        { t: 0, kind: 'session', what: 'start' },
        { t: 10.4, kind: 'lesson', lessonId: 'hover-height', version: 1, what: 'attempt-start', attempt: 1 },
        { t: 20, kind: 'goal', index: 0, what: 'met' },
        { t: 30, kind: 'touch', material: 'wall', speed: 1.25, pos: [1.23456, 2, 3] },
        { t: 40, kind: 'gate', gateId: 'ring-1', index: 0, missM: 0.123 },
        { t: 50, kind: 'checkpoint', id: 'cp-1' },
        { t: 60, kind: 'reset', to: 'checkpoint', checkpointId: 'cp-1' },
        { t: 61, kind: 'reset', to: 'start', checkpointId: null },
        { t: 70, kind: 'speech', key: 'fly.go', text: 'Go! Вперёд' },
        { t: 80, kind: 'key', code: 'KeyR', action: 'reset.checkpoint' },
        { t: 81, kind: 'key', code: 'F13', action: null },
        { t: 90, kind: 'answer', item: 'q1', value: 2, via: 'key' },
        { t: 91, kind: 'answer', item: 'q2', value: null, via: 'skip' },
        { t: 100, kind: 'recording', what: 'mic-denied' },
        { t: 110, kind: 'send', what: 'delivered', channel: 'telegram' },
        { t: 111, kind: 'send', what: 'asked', channel: null }
    ];

    it('round-trips every kind, rounding time and position', () => {
        for (const e of all) {
            const line = encodeEvent(e);
            expect(line).not.toContain('\n');
            const back = decodeEvent(line);
            expect(back.ok, line).toBe(true);
            if (back.ok) expect(back.value).toEqual(roundEvent(e));
        }
        expect(encodeEvent(all[3] as SessionEvent)).toBe('{"kind":"touch","material":"wall","pos":[1.235,2,3],"speed":1.25,"t":30}');
        expect(new Set(all.map((e) => e.kind)).size).toBe(12);
    });

    it('refuses a field that is missing, wrong or unknown (negative controls)', () => {
        const check = (v: unknown, lenient = false): string => {
            const r = validateEvent(v, { lenient });
            return r.ok ? 'ok' : r.issues.map((i) => i.path).join(',');
        };
        expect(check({ t: 1, kind: 'gate', gateId: 'a', index: 0 })).toBe('missM');
        expect(check({ t: 1, kind: 'gate', gateId: 'a', index: 0 }, true)).toBe('missM');
        expect(check({ t: 1, kind: 'touch', material: 'glass', speed: 1, pos: [0, 0, 0] })).toBe('material');
        expect(check({ t: 1, kind: 'lesson', lessonId: 'Bad Id', version: 1, what: 'open', attempt: 0 })).toBe('lessonId');
        expect(check({ t: 1, kind: 'warp' })).toBe('kind');
        expect(check({ kind: 'session', what: 'start' })).toBe('t');
        expect(check({ t: -5, kind: 'session', what: 'start' })).toBe('t');
        expect(check({ t: 1, kind: 'answer', item: 'q', value: 1.5, via: 'key' })).toBe('value');
        expect(check({ t: 1, kind: 'send', what: 'asked', channel: 'fax' })).toBe('channel');
        expect(check('x')).toBe('');
        // an unknown key: strict refuses, lenient keeps the event
        const extra = { t: 1, kind: 'checkpoint', id: 'cp', note: 'new field' };
        expect(check(extra)).toBe('note');
        expect(check(extra, true)).toBe('ok');
        expect(decodeEvent('{"t":1,"kind":', {}).ok).toBe(false);
    });

    it('validates survey answers', () => {
        const ok = { format: 'shramko-sonic-answers/1', surveyId: 'first', version: 1, skipped: false, answers: [{ item: 'a', value: 3, via: 'key', t: 5 }] };
        expect(validateSurveyAnswers(ok).ok).toBe(true);
        const bad = validateSurveyAnswers({ ...ok, answers: [{ item: 'a', value: 3, via: 'telepathy', t: 5 }] });
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.issues[0]?.path).toBe('answers[0].via');
        expect(validateSurveyAnswers({ ...ok, skipped: 'no' }).ok).toBe(false);
    });
});

describe('manifest', () => {
    const base = (): ReturnType<typeof buildManifest> => buildManifest(manifestInput());
    const problems = (m: unknown): string[] => {
        const r = validateManifest(m);
        return r.ok ? [] : r.issues.map((i) => i.path);
    };
    const withFiles = (m: ReturnType<typeof base>, names: string[]): ReturnType<typeof base> => ({ ...m, files: names.map((name) => ({ name, bytes: 1, sha256: '0'.repeat(64) })) });

    it('builds a valid start and writes canonical text', () => {
        const m = base();
        expect(m.complete).toBe(false);
        expect(m.ended).toBeNull();
        expect(m.files).toEqual([]);
        expect(problems(m)).toEqual([]);
        const text = writeManifest(m);
        expect(text.endsWith('\n')).toBe(true);
        const parsed = parseManifest(text);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.value).toEqual(m);
        expect(writeManifest(m)).toBe(text);
        expect(buildManifest(manifestInput({ id: undefined as never }), () => new Uint8Array(16)).id).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    });

    it('refuses what the format forbids, naming the field', () => {
        const m = base();
        expect(problems({ ...m, id: 'short' })).toEqual(['id']);
        expect(problems({ ...m, created: '7 Nov 2026' })).toEqual(['created']);
        expect(problems({ ...m, complete: true })).toEqual(['ended']);
        expect(problems({ ...m, ended: '2026-11-07T09:00:00Z' })).toEqual(['ended']);
        expect(problems({ ...m, settings: { ...m.settings, speechRate: 9 } })).toEqual(['settings.speechRate']);
        expect(problems({ ...m, assists: { control: 'warp' } }).some((p) => p.startsWith('assists.'))).toBe(true);
        expect(problems({ ...m, device: { ...m.device, locale: 'de' } })).toEqual(['device.locale']);
        expect(problems({ ...m, scene: { ...m.scene, transform: [0, 0, 0, 0] } })).toEqual(['scene.transform']);
        expect(problems({ ...m, surprise: 1 })).toEqual(['surprise']);
        const { pilot: _pilot, ...missing } = m;
        expect(problems(missing)).toEqual(['pilot']);
        expect(problems({ ...m, format: 'shramko-sonic-session/2' })).toEqual(['format']);
        expect(problems(null)).toEqual(['']);
    });

    it('holds the package to the privacy rules of spec section 10', () => {
        const m = base();
        // a voice file without consent to record voice
        const voice = withFiles({ ...m, clock: { ...m.clock, voiceOffsetMs: 0 } }, ['flight.jsonl.gz', 'voice.webm']);
        expect(problems(voice)).toEqual(['files']);
        expect(problems({ ...voice, consent: CONSENT_VOICE })).toEqual([]);
        // voice consent without consent to record
        expect(problems({ ...m, consent: { ...CONSENT, recording: false, voice: true } })).toEqual(['consent.voice']);
        // a voice file with no place on the session clock
        expect(problems(withFiles({ ...m, consent: CONSENT_VOICE }, ['voice.webm']))).toEqual(['clock.voiceOffsetMs']);
        // an offset with no voice, in a complete package
        const complete = { ...m, complete: true, ended: '2026-11-07T10:05:00Z' };
        expect(problems({ ...complete, consent: CONSENT_VOICE, clock: { ...m.clock, voiceOffsetMs: 100 } })).toEqual(['clock.voiceOffsetMs']);
        expect(problems({ ...m, consent: CONSENT_VOICE, clock: { ...m.clock, voiceOffsetMs: 100 } })).toEqual([]); // unfinished: the offset is stored before the first slice
        // a minor needs the guardian's answer, an adult has none
        expect(problems({ ...m, consent: { ...CONSENT, minor: true } })).toEqual(['consent.guardianConfirmed']);
        expect(problems({ ...m, consent: { ...CONSENT, minor: true, guardianConfirmed: false } })).toEqual([]);
        expect(problems({ ...m, consent: { ...CONSENT, guardianConfirmed: true } })).toEqual(['consent.guardianConfirmed']);
        // files: unknown name, repeated name, a bad hash
        expect(problems(withFiles(m, ['manifest.json']))).toEqual(['files[0].name']);
        expect(problems(withFiles(m, ['events.jsonl', 'events.jsonl']))).toEqual(['files[1].name']);
        expect(problems({ ...m, files: [{ name: 'events.jsonl', bytes: 1, sha256: 'xyz' }] })).toEqual(['files[0].sha256']);
        // no names: a pilot id is random characters, never free text
        expect(problems({ ...m, pilot: { id: 'Jan Kowalski', nickname: null } })).toEqual(['pilot.id']);
    });
});

describe('SessionWriter', () => {
    async function record(options: { frames?: number; chunkFrames?: number; chunkMs?: number; gzip?: GzipFn; sink?: ChunkSink; withEvents?: number } = {}): Promise<{ sink: MemorySink; writer: SessionWriter; frames: FlightFrame[]; events: SessionEvent[] }> {
        const sink = new MemorySink();
        const writer = await SessionWriter.start({ sink: options.sink ?? sink, manifest: manifestInput(), ...(options.gzip === undefined ? {} : { gzip: options.gzip }), ...(options.chunkFrames === undefined ? {} : { chunkFrames: options.chunkFrames }), ...(options.chunkMs === undefined ? {} : { chunkMs: options.chunkMs }) });
        const frames = fakeFrames(options.frames ?? 1000);
        const events: SessionEvent[] = [];
        let e = 0;
        frames.forEach((f, i) => {
            writer.frame(f);
            if (e < (options.withEvents ?? 50) && i % Math.max(1, Math.floor(frames.length / (options.withEvents ?? 50))) === 0) {
                const ev: SessionEvent = { t: f.t, kind: 'key', code: 'KeyW', action: i % 2 === 0 ? 'forward' : null };
                events.push(ev);
                writer.event(ev);
                e++;
            }
        });
        return { sink, writer, frames, events };
    }

    it('round-trips a session through chunks, a manifest with hashes, and a zip', async () => {
        const { sink, writer, frames, events } = await record({ chunkFrames: DEFAULT_CHUNK_FRAMES, chunkMs: 1e9 });
        const manifest = await writer.finish({ ended: '2026-11-07T10:01:00Z' });
        expect(sink.appends.get('flight.jsonl.gz')).toBe(Math.ceil(1000 / DEFAULT_CHUNK_FRAMES));
        expect(writer.chunks).toBe(12);
        expect(manifest.complete).toBe(true);
        expect(manifest.files.map((f) => f.name)).toEqual(['flight.jsonl.gz', 'events.jsonl']);
        const zip = await packSession(sink);
        const pkg = readPackage(new Uint8Array(Buffer.concat(zip)));
        expect(pkg.problems).toEqual([]);
        expect(pkg.frames).toEqual(frames.map(roundFrame));
        expect(pkg.events).toEqual(events.map(roundEvent));
        expect(pkg.manifest).toEqual(manifest);
        expect(pkg.voice).toBeNull();
        // the members really are separate: cut the file after the 5th and the first 450 frames read
        const flight = sink.files.get('flight.jsonl.gz') as Uint8Array;
        const g = gunzipMembers(flight);
        expect(g.members).toHaveLength(12);
        const cut = gunzipMembers(flight.subarray(0, (g.members[4] as { end: number }).end));
        expect(utf8Decode(cut.data).split('\n').filter(Boolean)).toHaveLength(450);
    });

    it('closes a chunk by the session clock too (3 s of frames at 30 Hz), with any compressor', async () => {
        for (const gzip of [undefined, nodeGzip, (b: Uint8Array) => Promise.resolve(gzipStored(b))]) {
            const { sink, writer } = await record({ frames: 600, chunkFrames: 100000, chunkMs: 3000, withEvents: 0, ...(gzip === undefined ? {} : { gzip }) });
            await writer.finish();
            // 600 frames = 20 s: a chunk closes when a frame is 3 s newer than the chunk's first: every 91 frames
            expect(sink.appends.get('flight.jsonl.gz')).toBe(Math.ceil(600 / 91));
            const pkg = readPackage(new Uint8Array(Buffer.concat(await packSession(sink))));
            expect(pkg.frames).toHaveLength(600);
        }
    });

    it('writes the survey and the sim log, voice with its offset, and lists them with hashes', async () => {
        const sink = new MemorySink();
        const w = await SessionWriter.start({ sink, manifest: manifestInput({ consent: CONSENT_VOICE }), chunkFrames: 10 });
        for (const f of fakeFrames(25)) w.frame(f);
        expect(() => w.voice(Uint8Array.of(1))).toThrow(/setVoiceOffset/);
        w.setVoiceOffset(120);
        const slices = [sampleBytes(500, 'noise', 1), sampleBytes(700, 'noise', 2)];
        for (const s of slices) w.voice(s);
        w.survey({ format: 'shramko-sonic-answers/1', surveyId: 'first', version: 1, skipped: false, answers: [{ item: 'a', value: 2, via: 'key', t: 900 }] });
        const sim = utf8Encode('{"lives":[]}');
        w.simLog(sim);
        const m = await w.finish();
        expect(m.files.map((f) => f.name)).toEqual(['flight.jsonl.gz', 'events.jsonl', 'voice.webm', 'survey.json', 'sim-log.json']);
        expect(m.clock.voiceOffsetMs).toBe(120);
        const pkg = readPackage(new Uint8Array(Buffer.concat(await packSession(sink))));
        expect(same(pkg.voice as Uint8Array, new Uint8Array(Buffer.concat(slices)))).toBe(true);
        expect(same(pkg.simLog as Uint8Array, sim)).toBe(true);
        expect(pkg.survey?.answers).toHaveLength(1);
        expect(m.files.find((f) => f.name === 'voice.webm')?.sha256).toBe(sha256Hex(new Uint8Array(Buffer.concat(slices))));
    });

    it('records no voice without consent, and drops an offset that no voice used', async () => {
        const sink = new MemorySink();
        const w = await SessionWriter.start({ sink, manifest: manifestInput() });
        w.setVoiceOffset(5);
        expect(() => w.voice(Uint8Array.of(1))).toThrow(SessionError);
        const sink2 = new MemorySink();
        const w2 = await SessionWriter.start({ sink: sink2, manifest: manifestInput({ consent: CONSENT_VOICE }) });
        w2.setVoiceOffset(5);
        const m = await w2.finish();
        expect(m.clock.voiceOffsetMs).toBeNull();
        expect(m.files.some((f) => f.name === 'voice.webm')).toBe(false);
    });

    it('refuses to start with an invalid manifest, and to write after the end', async () => {
        await expect(SessionWriter.start({ sink: new MemorySink(), manifest: manifestInput({ consent: { ...CONSENT, minor: true } }) })).rejects.toThrow(/guardianConfirmed/);
        const { writer } = await record({ frames: 10, withEvents: 0 });
        await writer.finish();
        expect(() => writer.frame(fakeFrames(1)[0] as FlightFrame)).toThrow(SessionError);
        await expect(writer.finish()).rejects.toThrow(SessionError);
    });

    it('writes an empty session as readable empty files', async () => {
        const { sink, writer } = await record({ frames: 0, withEvents: 0 });
        await writer.finish();
        const pkg = readPackage(new Uint8Array(Buffer.concat(await packSession(sink))));
        expect(pkg.frames).toEqual([]);
        expect(pkg.events).toEqual([]);
    });

    it('keeps the order of chunks when the sink is slow and uneven', async () => {
        const inner = new MemorySink();
        let call = 0;
        const slow: ChunkSink = {
            append: async (name, bytes) => {
                const wait = [30, 1, 15, 2, 8][call++ % 5] as number;
                await new Promise((r) => setTimeout(r, wait));
                inner.append(name, bytes);
            },
            replace: (name, bytes) => inner.replace(name, bytes)
        };
        const { writer, frames } = await record({ frames: 500, chunkFrames: 50, sink: slow, withEvents: 20 });
        await writer.finish();
        const pkg = readPackage(new Uint8Array(Buffer.concat(await packSession(inner))));
        expect(pkg.frames).toEqual(frames.map(roundFrame));
    });

    it('reports the first failure of the sink, and writes nothing more after it', async () => {
        const inner = new MemorySink();
        let appends = 0;
        const errors: unknown[] = [];
        const broken: ChunkSink = {
            append: (name, bytes) => {
                if (++appends === 3) throw new Error('quota exceeded');
                inner.append(name, bytes);
            },
            replace: (name, bytes) => inner.replace(name, bytes)
        };
        const sink = broken;
        const w = await SessionWriter.start({ sink, manifest: manifestInput(), chunkFrames: 30, onError: (e) => errors.push(e) });
        for (const f of fakeFrames(300)) w.frame(f);
        await expect(w.flush()).rejects.toThrow(/quota exceeded/);
        expect(errors).toHaveLength(1);
        expect(inner.appends.get('flight.jsonl.gz')).toBe(2);
        await expect(w.finish()).rejects.toThrow(/quota exceeded/);
        expect(inner.appends.get('flight.jsonl.gz')).toBe(2);
    });

    it('packs only what the manifest says is there (negative controls: a changed, a missing file)', async () => {
        const { sink, writer } = await record({ frames: 100, withEvents: 5 });
        await writer.finish();
        const changed = new MemorySink();
        for (const [n, b] of sink.files) changed.replace(n, b);
        const f = (changed.files.get('events.jsonl') as Uint8Array).slice();
        f[5] = (f[5] as number) ^ 1;
        changed.replace('events.jsonl', f);
        await expect(packSession(changed)).rejects.toThrow(/SHA-256/);
        const missing = new MemorySink();
        for (const [n, b] of sink.files) if (n !== 'flight.jsonl.gz') missing.replace(n, b);
        await expect(packSession(missing)).rejects.toThrow(/no flight/);
        await expect(packSession(new MemorySink())).rejects.toThrow(PackageError);
        // the unfinished manifest lists no files: recover first
        const fresh = new MemorySink();
        await SessionWriter.start({ sink: fresh, manifest: manifestInput() });
        await expect(packSession(fresh)).rejects.toThrow(/not finished/);
    });
});

describe('recovery of an unfinished session', () => {
    async function crash(options: { frames: number; chunkFrames: number; voice?: boolean }): Promise<{ sink: MemorySink; frames: FlightFrame[] }> {
        const sink = new MemorySink();
        const w = await SessionWriter.start({ sink, manifest: manifestInput(options.voice === true ? { consent: CONSENT_VOICE } : {}), chunkFrames: options.chunkFrames, chunkMs: 1e9 });
        const frames = fakeFrames(options.frames);
        for (const f of frames) {
            w.frame(f);
            if (f.tick % 400 < 34) w.event({ t: f.t, kind: 'key', code: 'KeyA', action: null });
        }
        if (options.voice === true) {
            w.setVoiceOffset(250);
            w.voice(sampleBytes(300, 'noise', 3));
        }
        // the tab dies here: no finish, no flush. What the sink holds is what was written so far.
        const chunks = Math.floor(options.frames / options.chunkFrames);
        for (let i = 0; i < 400 && (sink.appends.get('flight.jsonl.gz') ?? 0) < chunks; i++) await new Promise((r) => setTimeout(r, 5));
        if (options.voice === true) for (let i = 0; i < 400 && (sink.appends.get('voice.webm') ?? 0) < 1; i++) await new Promise((r) => setTimeout(r, 5));
        expect(sink.appends.get('flight.jsonl.gz')).toBe(chunks);
        return { sink, frames };
    }

    it('loses at most the chunk that was open, and the package is readable', async () => {
        const { sink, frames } = await crash({ frames: 400, chunkFrames: 90 });
        const report = await recoverSession(sink);
        expect(report.frames).toBe(360);
        expect(400 - report.frames).toBeLessThanOrEqual(90);
        expect(report.droppedFlightBytes).toBe(0);
        expect(report.manifest.complete).toBe(false);
        const pkg = readPackage(new Uint8Array(Buffer.concat(await packSession(sink))));
        expect(pkg.frames).toEqual(frames.slice(0, 360).map(roundFrame));
        expect(pkg.events.at(-1)).toEqual({ t: Math.round((frames[359] as FlightFrame).t), kind: 'session', what: 'recovered' });
        expect(pkg.manifest.complete).toBe(false);
        expect(Date.parse(pkg.manifest.ended as string)).toBeGreaterThanOrEqual(Date.parse(pkg.manifest.created));
    });

    it('cuts a half-written chunk and a half-written line, and says so', async () => {
        const { sink } = await crash({ frames: 400, chunkFrames: 90 });
        const flight = sink.files.get('flight.jsonl.gz') as Uint8Array;
        sink.replace('flight.jsonl.gz', flight.subarray(0, flight.length - 37));
        sink.append('events.jsonl', utf8Encode('{"t":99999,"kind":"ke'));
        const report = await recoverSession(sink);
        expect(report.frames).toBe(270);
        expect(report.droppedFlightBytes).toBeGreaterThan(0);
        expect(report.droppedEventBytes).toBe(utf8Encode('{"t":99999,"kind":"ke').length);
        expect(report.notes).toHaveLength(2);
        const pkg = readPackage(new Uint8Array(Buffer.concat(await packSession(sink))));
        expect(pkg.frames).toHaveLength(270);
        expect(pkg.problems).toEqual([]);
        // recovering twice changes nothing but the marker
        const again = await recoverSession(sink);
        expect(again.frames).toBe(270);
        expect(again.droppedFlightBytes).toBe(0);
    });

    it('keeps the voice and its offset', async () => {
        const { sink } = await crash({ frames: 200, chunkFrames: 50, voice: true });
        const report = await recoverSession(sink);
        expect(report.manifest.clock.voiceOffsetMs).toBe(250);
        const pkg = readPackage(new Uint8Array(Buffer.concat(await packSession(sink))));
        expect(pkg.voice).toHaveLength(300);
    });

    it('refuses a store with no readable manifest', async () => {
        await expect(recoverSession(new MemorySink())).rejects.toThrow(/no manifest/);
        const bad = new MemorySink();
        bad.replace('manifest.json', utf8Encode('{"format":"shramko-sonic-session/1"}'));
        await expect(recoverSession(bad)).rejects.toThrow(SessionError);
    });
});

describe('reading a package', () => {
    const decodeText = (b: Uint8Array | undefined): string => utf8Decode(b as Uint8Array);

    it('reads packages written by Python (stored, and deflated with data descriptors), with UTF-8 text intact', () => {
        const a = readPackage(fixture('session-python-store.zip'));
        const b = readPackage(fixture('session-python-deflate.zip'));
        expect(a.problems).toEqual([]);
        expect(a.manifest.id).toBe('pyFixtureSession01');
        expect(a.manifest.complete).toBe(true);
        expect(a.frames).toHaveLength(60);
        expect(a.frames[59]?.t).toBe(1967);
        expect(a.events).toHaveLength(9);
        const speech = a.events.find((e) => e.kind === 'speech');
        expect(speech && speech.kind === 'speech' ? speech.text : '').toBe('Zawiśnij na wysokości. Висите на высоте.');
        expect(a.survey?.answers).toHaveLength(2);
        expect(a.voice).toBeNull();
        expect(b.frames).toEqual(a.frames);
        expect(b.events).toEqual(a.events);
        expect(b.survey).toEqual(a.survey);
    });

    const pyFiles = (): { manifest: Uint8Array; flight: Uint8Array; events: Uint8Array; survey: Uint8Array } => {
        const z = readZip(fixture('session-python-store.zip'));
        return { manifest: z.get('manifest.json') as Uint8Array, flight: z.get('flight.jsonl.gz') as Uint8Array, events: z.get('events.jsonl') as Uint8Array, survey: z.get('survey.json') as Uint8Array };
    };
    const repack = (f: ReturnType<typeof pyFiles>, over: Partial<ReturnType<typeof pyFiles>> = {}): Uint8Array => {
        const g = { ...f, ...over };
        return new Uint8Array(Buffer.concat(packFiles(g.manifest, { flight: g.flight, events: g.events, survey: g.survey }, '2026-11-07T10:00:00Z')));
    };

    it('repacking the Python files is readable: the manifest hashes check out (control for the next tests)', () => {
        expect(readPackage(repack(pyFiles())).problems).toEqual([]);
    });

    it('refuses a listed file that changed although the zip is consistent, and lenient reading says which', () => {
        const f = pyFiles();
        const events = f.events.slice();
        events[10] = (events[10] as number) ^ 0x01; // still a valid zip entry after repacking: only the manifest's SHA-256 can notice
        const bytes = repack(f, { events });
        expect(() => readPackage(bytes)).toThrow(PackageError);
        const lenient = readPackage(bytes, { lenient: true });
        expect(lenient.problems.map((p) => p.code)).toContain('file-hash');
    });

    it('refuses a missing file, an unlisted file and a damaged flight log', () => {
        const f = pyFiles();
        const noSurvey = new Uint8Array(Buffer.concat(packFiles(f.manifest, { flight: f.flight, events: f.events }, '2026-11-07T10:00:00Z')));
        expect(() => readPackage(noSurvey)).toThrow(/survey\.json/);
        expect(readPackage(noSurvey, { lenient: true }).problems.map((p) => p.code)).toEqual(['file-missing']);
        const extra = new ZipWriter();
        for (const [n, b] of readZip(repack(f))) extra.add(n, b);
        extra.add('voice.webm', Uint8Array.of(1, 2, 3));
        expect(readPackage(extra.bytes(), { lenient: true }).problems.map((p) => p.code)).toEqual(['file-unlisted']);
        // a flight log cut in its last member: strict refuses, lenient keeps the first member's 30 frames
        const cutFlight = f.flight.subarray(0, f.flight.length - 20);
        const bytes = repack(f, { flight: cutFlight });
        expect(() => readPackage(bytes)).toThrow(PackageError);
        const lenient = readPackage(bytes, { lenient: true });
        expect(lenient.frames).toHaveLength(30);
        expect(lenient.problems.map((p) => p.code)).toContain('flight-damaged');
    });

    it('skips a bad line in lenient mode only', () => {
        const f = pyFiles();
        const lines = decodeText(f.events).split('\n').filter(Boolean);
        lines.splice(2, 0, '{"t":5,"kind":"warp"}', 'not json');
        const events = utf8Encode(`${lines.join('\n')}\n`);
        const bytes = repack(f, { events });
        expect(() => readPackage(bytes)).toThrow(PackageError);
        const lenient = readPackage(bytes, { lenient: true });
        expect(lenient.events).toHaveLength(9);
        expect(lenient.problems.filter((p) => p.code === 'event-invalid')).toHaveLength(2);
        // frames whose time goes back are reported
        const frames = new Uint8Array(zlibGzip(utf8Encode(`${['{"t":100,"tick":100,"p":[0,0,0],"v":[0,0,0],"q":[1,0,0,0],"s":[0,0,0,0],"c":[]}', '{"t":50,"tick":50,"p":[0,0,0],"v":[0,0,0],"q":[1,0,0,0],"s":[0,0,0,0],"c":[]}'].join('\n')}\n`)));
        const back = readPackage(repack(f, { flight: frames }), { lenient: true });
        expect(back.problems.map((p) => p.code)).toContain('frame-order');
    });

    it('refuses a manifest that breaks the privacy rules, even leniently', () => {
        const f = pyFiles();
        const m = JSON.parse(decodeText(f.manifest)) as { consent: { recording: boolean }; files: { name: string }[] };
        m.files.push({ name: 'voice.webm', bytes: 3, sha256: sha256Hex(Uint8Array.of(1, 2, 3)) } as never);
        const z = new ZipWriter();
        z.add('manifest.json', utf8Encode(JSON.stringify(m)));
        z.add('flight.jsonl.gz', f.flight);
        z.add('events.jsonl', f.events);
        z.add('survey.json', f.survey);
        z.add('voice.webm', Uint8Array.of(1, 2, 3));
        expect(() => readPackage(z.bytes(), { lenient: true })).toThrow(/consent|clock/);
    });

    it('says plainly when the file is not a package', () => {
        expect(() => readPackage(utf8Encode('not a zip at all, but long enough to have a tail'))).toThrow(ZipError);
        const z = new ZipWriter();
        z.add('hello.txt', utf8Encode('hi'));
        expect(() => readPackage(z.bytes())).toThrow(/no manifest\.json/);
    });
});

function zlibGzip(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(zlib.gzipSync(bytes));
}
