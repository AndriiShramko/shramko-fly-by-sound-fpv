// The session package as one .zip (spec section 7): packing a finished session's files, and reading
// a package back for replay and for the report tool. Reading checks everything it can: the zip's
// CRC-32s, the manifest against the format and the privacy rules, every listed file against its size
// and SHA-256, every line of the flight log and the event log. Strict reading (the default) refuses a
// package with any problem; lenient reading keeps what is readable and lists the problems.
import type { FlightFrame, SessionEvent, SessionManifest, SurveyAnswers } from '../contract';
import { SESSION_FILES } from '../contract';
import type { Issue } from '../util/check';
import { formatIssues } from '../util/check';
import { sha256Hex } from '../util/sha256';
import { utf8Decode } from '../util/utf8';
import { decodeEvent, decodeFrame, validateSurveyAnswers } from './codec';
import { gunzipMembers, GzipError } from './gzip';
import { LISTED_FILES, parseManifest } from './manifest';
import { readZip, ZipWriter, type ReadZipOptions } from './zip';
import type { ChunkStore } from './writer';

export class PackageError extends Error {
    readonly problems: readonly PackageProblem[];
    constructor(message: string, problems: readonly PackageProblem[] = []) {
        super(message);
        this.name = 'PackageError';
        this.problems = problems;
    }
}

/** One thing wrong with a package: a stable code, and what it means. */
export interface PackageProblem {
    readonly code: string;
    readonly message: string;
}

export interface PackageFiles {
    readonly manifest: SessionManifest;
    /** flight.jsonl.gz as written (gzip members) */
    readonly flight: Uint8Array;
    /** events.jsonl as written */
    readonly events: Uint8Array;
    readonly voice?: Uint8Array | null;
    readonly survey?: Uint8Array | null;
    readonly simLog?: Uint8Array | null;
}

/** Entry order inside the zip: the manifest first, then the files in the order the manifest lists them. */
const ENTRY_ORDER: readonly string[] = [SESSION_FILES.manifest, ...LISTED_FILES];

/**
 * The zip of a finished session as parts (`new Blob(parts)` makes the file without joining them).
 * `manifestText` is the text of manifest.json exactly as written to the store.
 */
export function packFiles(manifestText: Uint8Array, files: Omit<PackageFiles, 'manifest'>, created: string): Uint8Array[] {
    const zip = new ZipWriter({ date: created });
    const byName = new Map<string, Uint8Array | null | undefined>([
        [SESSION_FILES.manifest, manifestText],
        [SESSION_FILES.flight, files.flight],
        [SESSION_FILES.events, files.events],
        [SESSION_FILES.voice, files.voice],
        [SESSION_FILES.survey, files.survey],
        [SESSION_FILES.simLog, files.simLog]
    ]);
    for (const name of ENTRY_ORDER) {
        const bytes = byName.get(name);
        if (bytes !== null && bytes !== undefined) zip.add(name, bytes);
    }
    return zip.finish();
}

/**
 * Packs the session in a store: reads manifest.json and every file it lists, checks each against the
 * manifest's size and SHA-256 (a store that lost or changed bytes is refused), and returns the zip as parts.
 */
export async function packSession(store: ChunkStore): Promise<Uint8Array[]> {
    const manifestBytes = await store.read(SESSION_FILES.manifest);
    if (manifestBytes === null) throw new PackageError('the store has no manifest.json');
    const parsed = parseManifest(utf8Decode(manifestBytes));
    if (!parsed.ok) throw new PackageError(`manifest.json is not valid: ${formatIssues(parsed.issues)}`);
    const manifest = parsed.value;
    const got = new Map<string, Uint8Array>();
    for (const f of manifest.files) {
        const bytes = await store.read(f.name);
        if (bytes === null) throw new PackageError(`the store has no ${f.name}, which the manifest lists`);
        if (bytes.length !== f.bytes) throw new PackageError(`${f.name} has ${bytes.length} bytes, the manifest says ${f.bytes}`);
        if (sha256Hex(bytes) !== f.sha256) throw new PackageError(`${f.name} fails its SHA-256 check`);
        got.set(f.name, bytes);
    }
    const flight = got.get(SESSION_FILES.flight);
    const events = got.get(SESSION_FILES.events);
    if (flight === undefined || events === undefined) throw new PackageError('the manifest does not list the flight and event logs: the session is not finished (recover it first)');
    return packFiles(manifestBytes, { flight, events, voice: got.get(SESSION_FILES.voice) ?? null, survey: got.get(SESSION_FILES.survey) ?? null, simLog: got.get(SESSION_FILES.simLog) ?? null }, manifest.created);
}

export interface ReadPackageOptions extends ReadZipOptions {
    /**
     * false (default): any problem throws PackageError. true: a bad line is skipped, a damaged tail
     * of the flight log is dropped, a mismatch of a listed file is noted; the manifest must still be valid.
     */
    readonly lenient?: boolean;
}

export interface SessionPackage {
    readonly manifest: SessionManifest;
    readonly frames: readonly FlightFrame[];
    readonly events: readonly SessionEvent[];
    /** voice.webm as bytes, or null */
    readonly voice: Uint8Array | null;
    readonly survey: SurveyAnswers | null;
    /** sim-log.json as bytes (the simulator parses it), or null */
    readonly simLog: Uint8Array | null;
    /** empty in strict reading */
    readonly problems: readonly PackageProblem[];
}

const lines = (text: string): string[] => text.split('\n').filter((l) => l.trim() !== '');

function issueText(issues: readonly Issue[]): string {
    return formatIssues(issues.slice(0, 3)) + (issues.length > 3 ? ` (and ${issues.length - 3} more)` : '');
}

/** Reads a package. Throws ZipError for a damaged archive and PackageError for a package that does not hold. */
export function readPackage(bytes: Uint8Array, options: ReadPackageOptions = {}): SessionPackage {
    const lenient = options.lenient === true;
    const entries = readZip(bytes, options);
    const problems: PackageProblem[] = [];
    const problem = (code: string, message: string): void => {
        problems.push({ code, message });
    };

    const manifestBytes = entries.get(SESSION_FILES.manifest);
    if (manifestBytes === undefined) throw new PackageError('the package has no manifest.json');
    const parsed = parseManifest(utf8Decode(manifestBytes));
    if (!parsed.ok) throw new PackageError(`manifest.json is not valid: ${issueText(parsed.issues)}`, [{ code: 'manifest', message: formatIssues(parsed.issues) }]);
    const manifest = parsed.value;

    // the files the manifest lists, and the files it does not
    for (const f of manifest.files) {
        const data = entries.get(f.name);
        if (data === undefined) problem('file-missing', `${f.name} is listed in the manifest but not in the package`);
        else if (data.length !== f.bytes) problem('file-size', `${f.name} has ${data.length} bytes, the manifest says ${f.bytes}`);
        else if (sha256Hex(data) !== f.sha256) problem('file-hash', `${f.name} fails its SHA-256 check`);
    }
    const listed = new Set(manifest.files.map((f) => f.name));
    for (const name of entries.keys()) {
        if (name !== SESSION_FILES.manifest && !listed.has(name)) problem('file-unlisted', `${name} is in the package but not listed in the manifest`);
    }

    // the flight log: gzip members of lines
    const frames: FlightFrame[] = [];
    const flightBytes = entries.get(SESSION_FILES.flight);
    if (flightBytes === undefined) problem('flight-missing', `the package has no ${SESSION_FILES.flight}`);
    else {
        let text = '';
        try {
            const g = gunzipMembers(flightBytes, options.maxEntryBytes === undefined ? { tolerateTail: lenient } : { tolerateTail: lenient, limit: options.maxEntryBytes });
            if (g.error !== null) problem('flight-damaged', `the flight log is cut short: ${g.error}; ${flightBytes.length - g.validEnd} bytes at its end were dropped`);
            text = utf8Decode(g.data);
        } catch (e) {
            if (!(e instanceof GzipError)) throw e;
            throw new PackageError(`${SESSION_FILES.flight} cannot be read: ${e.message}`, [{ code: 'flight-damaged', message: e.message }]);
        }
        let n = 0;
        let last = -Infinity;
        for (const line of lines(text)) {
            n++;
            const f = decodeFrame(line);
            if (!f.ok) {
                problem('frame-invalid', `flight line ${n}: ${issueText(f.issues)}`);
                continue;
            }
            if (f.value.t < last) problem('frame-order', `flight line ${n}: time goes back from ${last} to ${f.value.t} ms`);
            last = f.value.t;
            frames.push(f.value);
        }
    }

    // the event log
    const events: SessionEvent[] = [];
    const eventBytes = entries.get(SESSION_FILES.events);
    if (eventBytes === undefined) problem('events-missing', `the package has no ${SESSION_FILES.events}`);
    else {
        let n = 0;
        for (const line of lines(utf8Decode(eventBytes))) {
            n++;
            const e = decodeEvent(line, { lenient });
            if (!e.ok) problem('event-invalid', `event line ${n}: ${issueText(e.issues)}`);
            else events.push(e.value);
        }
    }

    // survey and sim log
    let survey: SurveyAnswers | null = null;
    const surveyBytes = entries.get(SESSION_FILES.survey);
    if (surveyBytes !== undefined) {
        let data: unknown = null;
        try {
            data = JSON.parse(utf8Decode(surveyBytes));
        } catch {
            problem('survey-invalid', 'survey.json is not valid JSON');
        }
        if (data !== null) {
            const s = validateSurveyAnswers(data);
            if (s.ok) survey = s.value;
            else problem('survey-invalid', `survey.json: ${issueText(s.issues)}`);
        }
    }

    if (problems.length > 0 && !lenient) throw new PackageError(`the package has ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.slice(0, 3).map((p) => p.message).join('; ')}${problems.length > 3 ? '; ...' : ''}`, problems);
    return { manifest, frames, events, voice: entries.get(SESSION_FILES.voice) ?? null, survey, simLog: entries.get(SESSION_FILES.simLog) ?? null, problems };
}
