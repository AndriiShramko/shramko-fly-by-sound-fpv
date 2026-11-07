// SessionWriter: records a session into an abstract chunk sink (spec section 7). In the browser the
// sink is the origin private file system, in a test or a tool it is memory. The writer is the same.
//
//   manifest.json     written at the start (not complete, no files) and again at the end
//   flight.jsonl.gz   every `chunkFrames` frames, or `chunkMs` of the session clock, one gzip member
//   events.jsonl      appended in the same rhythm
//   voice.webm        the recorder's slices as they come
//   survey.json, sim-log.json   written at the end
//
// Nothing here keeps time of its own: chunks close by the `t` of the records, and the host calls
// `flush()` from its own timer as well, so a tab closed mid-session loses at most one chunk. All sink
// operations run in order, one at a time; the first failure stops the writer, and `flush()` and
// `finish()` report it. `recoverSession` brings an unfinished sink back to a consistent state.
import type { FlightFrame, SessionEvent, SessionManifest, SurveyAnswers } from '../contract';
import { SESSION_FILES } from '../contract';
import { bytesToHex, Sha256, sha256Hex, utf8Encode } from '../util/sha256';
import { utf8Decode } from '../util/utf8';
import { decodeFrame, encodeEvent, encodeFrame, validateSurveyAnswers, writeSurveyAnswers } from './codec';
import { defaultGzip, gunzipMembers, type GzipFn } from './gzip';
import { buildManifest, LISTED_FILES, parseManifest, validateManifest, writeManifest, type ManifestInput, type RandomBytes } from './manifest';

export class SessionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionError';
    }
}

/** Where a session's files go as they are made. */
export interface ChunkSink {
    /** Adds bytes to the end of the named file (created when missing). */
    append(name: string, bytes: Uint8Array): void | Promise<void>;
    /** Replaces the named file as a whole. */
    replace(name: string, bytes: Uint8Array): void | Promise<void>;
}

/** A sink that can also be read back: what packing and recovery need. */
export interface ChunkStore extends ChunkSink {
    read(name: string): Uint8Array | null | Promise<Uint8Array | null>;
    list(): readonly string[] | Promise<readonly string[]>;
}

/** A store in memory: for tests, tools and hosts without a file system. */
export class MemorySink implements ChunkStore {
    readonly files = new Map<string, Uint8Array>();
    /** how many times append was called per file */
    readonly appends = new Map<string, number>();

    append(name: string, bytes: Uint8Array): void {
        const old = this.files.get(name);
        if (old === undefined) this.files.set(name, bytes.slice());
        else {
            const joined = new Uint8Array(old.length + bytes.length);
            joined.set(old, 0);
            joined.set(bytes, old.length);
            this.files.set(name, joined);
        }
        this.appends.set(name, (this.appends.get(name) ?? 0) + 1);
    }

    replace(name: string, bytes: Uint8Array): void {
        this.files.set(name, bytes.slice());
    }

    read(name: string): Uint8Array | null {
        return this.files.get(name) ?? null;
    }

    list(): readonly string[] {
        return [...this.files.keys()].sort();
    }
}

export interface SessionWriterOptions {
    readonly sink: ChunkSink;
    /** the session's start: the writer completes it (not complete, no files) and keeps it up to date */
    readonly manifest: ManifestInput;
    /** one-member gzip; default: CompressionStream where the platform has it, else a stored fallback */
    readonly gzip?: GzipFn;
    /** a chunk closes after this many frames (default 90: 3 s at 30 Hz) */
    readonly chunkFrames?: number;
    /** or when its first record is this much older than the newest one, ms of the session clock (default 3000) */
    readonly chunkMs?: number;
    readonly random?: RandomBytes;
    /** called once, with the first failure of the sink or the compressor */
    readonly onError?: (error: unknown) => void;
}

export const DEFAULT_CHUNK_FRAMES = 90;
export const DEFAULT_CHUNK_MS = 3000;
/** The largest sim-log.json the writer takes, bytes. */
export const MAX_SIM_LOG_BYTES = 64 * 1024 * 1024;

interface Tracked {
    readonly sha: Sha256;
    bytes: number;
}

const EMPTY = new Uint8Array(0);

export class SessionWriter {
    private manifestValue: SessionManifest;
    private readonly sink: ChunkSink;
    private readonly gzip: GzipFn;
    private readonly chunkFrames: number;
    private readonly chunkMs: number;
    private readonly onError: ((e: unknown) => void) | undefined;
    private frameLines: string[] = [];
    private eventLines: string[] = [];
    private chunkStartT: number | null = null;
    private queue: Promise<void> = Promise.resolve();
    private failure: unknown = null;
    private failed = false;
    private closed = false;
    private readonly tracked = new Map<string, Tracked>();
    private surveyBytes: Uint8Array | null = null;
    private simLogBytes: Uint8Array | null = null;
    private framesCount = 0;
    private eventsCount = 0;
    private chunksCount = 0;

    private constructor(options: SessionWriterOptions, manifest: SessionManifest) {
        this.sink = options.sink;
        this.manifestValue = manifest;
        this.gzip = options.gzip ?? defaultGzip();
        this.chunkFrames = Math.max(1, Math.trunc(options.chunkFrames ?? DEFAULT_CHUNK_FRAMES));
        this.chunkMs = Math.max(1, options.chunkMs ?? DEFAULT_CHUNK_MS);
        this.onError = options.onError;
    }

    /** Builds the manifest of the new session, validates it and writes it to the sink. */
    static async start(options: SessionWriterOptions): Promise<SessionWriter> {
        const manifest = buildManifest(options.manifest, options.random);
        const check = validateManifest(manifest);
        if (!check.ok) throw new SessionError(`the session manifest is not valid: ${check.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
        const w = new SessionWriter(options, manifest);
        await options.sink.replace(SESSION_FILES.manifest, utf8Encode(writeManifest(manifest)));
        return w;
    }

    /** The manifest as it stands now (not complete until `finish`). */
    get manifest(): SessionManifest {
        return this.manifestValue;
    }

    get frames(): number {
        return this.framesCount;
    }

    get events(): number {
        return this.eventsCount;
    }

    /** Chunks written to flight.jsonl.gz so far (one gzip member each). */
    get chunks(): number {
        return this.chunksCount;
    }

    private run(op: () => Promise<void> | void): void {
        this.queue = this.queue.then(async () => {
            if (this.failed) return;
            try {
                await op();
            } catch (e) {
                this.failed = true;
                this.failure = e;
                if (this.onError !== undefined) this.onError(e);
            }
        });
    }

    private track(name: string, bytes: Uint8Array): void {
        let t = this.tracked.get(name);
        if (t === undefined) {
            t = { sha: new Sha256(), bytes: 0 };
            this.tracked.set(name, t);
        }
        t.sha.update(bytes);
        t.bytes += bytes.length;
    }

    private guard(): void {
        if (this.closed) throw new SessionError('the session is finished');
    }

    /** Takes the buffered records out and queues their writing. */
    private kick(): void {
        if (this.frameLines.length === 0 && this.eventLines.length === 0) return;
        const frames = this.frameLines;
        const events = this.eventLines;
        this.frameLines = [];
        this.eventLines = [];
        this.chunkStartT = null;
        this.run(async () => {
            if (frames.length > 0) {
                const member = await this.gzip(utf8Encode(`${frames.join('\n')}\n`));
                await this.sink.append(SESSION_FILES.flight, member);
                this.track(SESSION_FILES.flight, member);
                this.chunksCount++;
            }
            if (events.length > 0) {
                const bytes = utf8Encode(`${events.join('\n')}\n`);
                await this.sink.append(SESSION_FILES.events, bytes);
                this.track(SESSION_FILES.events, bytes);
            }
        });
    }

    private noted(t: number): void {
        if (this.chunkStartT === null) this.chunkStartT = t;
        if (this.frameLines.length >= this.chunkFrames || t - this.chunkStartT >= this.chunkMs) this.kick();
    }

    /** Records one frame of the flight (30 Hz). */
    frame(f: FlightFrame): void {
        this.guard();
        this.frameLines.push(encodeFrame(f));
        this.framesCount++;
        this.noted(f.t);
    }

    /** Records one event. */
    event(e: SessionEvent): void {
        this.guard();
        this.eventLines.push(encodeEvent(e));
        this.eventsCount++;
        this.noted(e.t);
    }

    /** Where voice.webm starts on the session clock (ms); stored in the manifest at once, so a recovered session knows it. */
    setVoiceOffset(offsetMs: number): void {
        this.guard();
        if (!Number.isFinite(offsetMs)) throw new SessionError('the voice offset must be a finite number of milliseconds');
        this.manifestValue = { ...this.manifestValue, clock: { ...this.manifestValue.clock, voiceOffsetMs: offsetMs } };
        const bytes = utf8Encode(writeManifest(this.manifestValue));
        this.run(() => this.sink.replace(SESSION_FILES.manifest, bytes));
    }

    /** Appends a slice of the voice recording. Refused unless the pilot consented to record voice. */
    voice(bytes: Uint8Array): void {
        this.guard();
        const consent = this.manifestValue.consent;
        if (!consent.recording || !consent.voice) throw new SessionError('voice is recorded only with the pilot\'s consent to record voice');
        if (this.manifestValue.clock.voiceOffsetMs === null) throw new SessionError('call setVoiceOffset before the first slice of voice');
        const copy = bytes.slice();
        this.run(async () => {
            await this.sink.append(SESSION_FILES.voice, copy);
            this.track(SESSION_FILES.voice, copy);
        });
    }

    /** The answers of the survey, written with the package. */
    survey(answers: SurveyAnswers): void {
        this.guard();
        const check = validateSurveyAnswers(answers);
        if (!check.ok) throw new SessionError(`the survey answers are not valid: ${check.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
        this.surveyBytes = utf8Encode(writeSurveyAnswers(check.value));
    }

    /** The simulator's own input log (sim-log.json), as the bytes of the JSON text. */
    simLog(bytes: Uint8Array): void {
        this.guard();
        if (bytes.length > MAX_SIM_LOG_BYTES) throw new SessionError(`sim-log.json is larger than ${MAX_SIM_LOG_BYTES} bytes`);
        this.simLogBytes = bytes.slice();
    }

    /** Writes everything buffered and waits until the sink has it. Throws the first failure. */
    async flush(): Promise<void> {
        this.kick();
        await this.queue;
        if (this.failed) throw this.failure;
    }

    /**
     * Ends the session: writes what is buffered, the survey and the sim log, then the final manifest
     * with the list of files (bytes and SHA-256 of each) and `complete`. Returns that manifest.
     */
    async finish(options: { readonly ended?: string; readonly complete?: boolean } = {}): Promise<SessionManifest> {
        this.guard();
        this.closed = true;
        this.kick();
        const sink = this.sink;
        this.run(async () => {
            if (!this.tracked.has(SESSION_FILES.flight)) {
                const member = await this.gzip(EMPTY);
                await sink.append(SESSION_FILES.flight, member);
                this.track(SESSION_FILES.flight, member);
            }
            if (!this.tracked.has(SESSION_FILES.events)) {
                await sink.replace(SESSION_FILES.events, EMPTY);
                this.track(SESSION_FILES.events, EMPTY);
            }
            if (this.surveyBytes !== null) await sink.replace(SESSION_FILES.survey, this.surveyBytes);
            if (this.simLogBytes !== null) await sink.replace(SESSION_FILES.simLog, this.simLogBytes);
        });
        await this.queue;
        if (this.failed) throw this.failure;
        const files: { name: string; bytes: number; sha256: string }[] = [];
        for (const name of LISTED_FILES) {
            const t = this.tracked.get(name);
            if (t !== undefined) files.push({ name, bytes: t.bytes, sha256: bytesToHex(t.sha.digest()) });
            else if (name === SESSION_FILES.survey && this.surveyBytes !== null) files.push({ name, bytes: this.surveyBytes.length, sha256: sha256Hex(this.surveyBytes) });
            else if (name === SESSION_FILES.simLog && this.simLogBytes !== null) files.push({ name, bytes: this.simLogBytes.length, sha256: sha256Hex(this.simLogBytes) });
        }
        const m = this.manifestValue;
        const hasVoice = (this.tracked.get(SESSION_FILES.voice)?.bytes ?? 0) > 0;
        const final: SessionManifest = {
            ...m,
            ended: options.ended ?? new Date().toISOString(),
            complete: options.complete ?? true,
            clock: { ...m.clock, voiceOffsetMs: hasVoice ? m.clock.voiceOffsetMs : null },
            files
        };
        const check = validateManifest(final);
        if (!check.ok) throw new SessionError(`the final manifest is not valid: ${check.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
        await sink.replace(SESSION_FILES.manifest, utf8Encode(writeManifest(final)));
        this.manifestValue = final;
        return final;
    }
}

// ------------------------------------------------------------------ recovery

export interface RecoveryReport {
    readonly manifest: SessionManifest;
    /** frames and events that survived */
    readonly frames: number;
    readonly events: number;
    /** bytes cut from the end of flight.jsonl.gz (a damaged or cut chunk) and of events.jsonl (a half line) */
    readonly droppedFlightBytes: number;
    readonly droppedEventBytes: number;
    /** the session clock at the last record that survived, ms */
    readonly lastT: number;
    readonly notes: readonly string[];
}

const countLines = (bytes: Uint8Array): number => {
    let n = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) n++;
    return n;
};

/**
 * Brings the store of an unfinished session (a closed tab, a crash) to a consistent state: a damaged
 * tail of the flight log is cut off at the last whole chunk, a half-written event line is dropped, a
 * `recovered` event is appended, and manifest.json is rewritten as `complete: false` with the list of
 * files. Throws SessionError when there is no readable manifest.
 */
export async function recoverSession(store: ChunkStore, options: { readonly gzip?: GzipFn } = {}): Promise<RecoveryReport> {
    const notes: string[] = [];
    const manifestBytes = await store.read(SESSION_FILES.manifest);
    if (manifestBytes === null) throw new SessionError('there is no manifest.json to recover from');
    const parsed = parseManifest(utf8Decode(manifestBytes));
    if (!parsed.ok) throw new SessionError(`manifest.json cannot be read: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    const manifest = parsed.value;
    const gzip = options.gzip ?? defaultGzip();

    // flight: keep whole members
    let flight = (await store.read(SESSION_FILES.flight)) ?? EMPTY;
    const read = gunzipMembers(flight, { tolerateTail: true });
    const droppedFlightBytes = flight.length - read.validEnd;
    if (droppedFlightBytes > 0) {
        flight = flight.subarray(0, read.validEnd);
        await store.replace(SESSION_FILES.flight, flight);
        notes.push(`cut ${droppedFlightBytes} damaged bytes from the end of the flight log (${read.error ?? 'unknown damage'})`);
    }
    if (flight.length === 0) {
        flight = await gzip(EMPTY);
        await store.replace(SESSION_FILES.flight, flight);
    }
    const frames = countLines(read.data);
    let lastT = 0;
    if (read.data.length > 0) {
        const lines = utf8Decode(read.data).split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i] as string;
            if (line === '') continue;
            const f = decodeFrame(line);
            if (f.ok) lastT = f.value.t;
            break;
        }
    }

    // events: keep whole lines
    let events = (await store.read(SESSION_FILES.events)) ?? EMPTY;
    let droppedEventBytes = 0;
    if (events.length > 0 && events[events.length - 1] !== 10) {
        let cut = events.length;
        while (cut > 0 && events[cut - 1] !== 10) cut--;
        droppedEventBytes = events.length - cut;
        events = events.subarray(0, cut);
        notes.push(`dropped a half-written event line of ${droppedEventBytes} bytes`);
    }
    const eventCount = countLines(events);
    if (events.length > 0) {
        const text = utf8Decode(events).split('\n');
        for (let i = text.length - 1; i >= 0; i--) {
            const line = text[i] as string;
            if (line === '') continue;
            try {
                const t = (JSON.parse(line) as { t?: unknown }).t;
                if (typeof t === 'number' && Number.isFinite(t)) lastT = Math.max(lastT, t);
            } catch {
                // an unreadable last line only leaves lastT as it is
            }
            break;
        }
    }
    const recovered = `${encodeEvent({ t: Math.round(lastT), kind: 'session', what: 'recovered' })}\n`;
    const recoveredBytes = utf8Encode(recovered);
    const joined = new Uint8Array(events.length + recoveredBytes.length);
    joined.set(events, 0);
    joined.set(recoveredBytes, events.length);
    await store.replace(SESSION_FILES.events, joined);

    // the files the manifest lists
    const files: { name: string; bytes: number; sha256: string }[] = [];
    for (const name of LISTED_FILES) {
        const bytes = name === SESSION_FILES.flight ? flight : name === SESSION_FILES.events ? joined : await store.read(name);
        if (bytes !== null) files.push({ name, bytes: bytes.length, sha256: sha256Hex(bytes) });
    }
    const endedMs = Math.max(Date.parse(manifest.clock.startIso) + lastT, Date.parse(manifest.created));
    const final: SessionManifest = { ...manifest, ended: new Date(endedMs).toISOString(), complete: false, files };
    const check = validateManifest(final);
    if (!check.ok) throw new SessionError(`the recovered manifest is not valid: ${check.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    await store.replace(SESSION_FILES.manifest, utf8Encode(writeManifest(final)));
    return { manifest: final, frames, events: eventCount + 1, droppedFlightBytes, droppedEventBytes, lastT, notes };
}
