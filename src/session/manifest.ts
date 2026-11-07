// manifest.json of a session package (contract SessionManifest, spec section 7): builder, strict
// validator and canonical writer. The validator also holds the package to the privacy rules of
// spec section 10: a voice recording needs the pilot's consent to record and to record voice, a
// minor's package says whether a guardian's signed consent was confirmed, and no field takes a name.
import type { Consent, DeviceInfo, LessonAssists, Locale, SessionManifest, SonicPrefs, TrackRef } from '../contract';
import { FORMATS, LOCALES, SESSION_FILES } from '../contract';
import { validateAssists } from '../lesson/validate';
import { validatePrefs } from '../prefs/prefs';
import { THEME_ID } from '../theme/schema';
import { canonicalPretty } from '../util/canonical';
import { Collector, isIsoDate, joinPath, type Issue, type Validation } from '../util/check';

export const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const PILOT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const LESSON_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The names of the files a manifest lists (every file of the package but the manifest itself). */
export const LISTED_FILES: readonly string[] = [SESSION_FILES.flight, SESSION_FILES.events, SESSION_FILES.voice, SESSION_FILES.survey, SESSION_FILES.simLog];

/** Where random bytes come from (default: the platform's crypto.getRandomValues). */
export type RandomBytes = (n: number) => Uint8Array;

function platformRandom(n: number): Uint8Array {
    const c = (globalThis as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
    if (c === undefined || typeof c.getRandomValues !== 'function') throw new Error('no crypto.getRandomValues on this platform: pass a random source');
    return c.getRandomValues(new Uint8Array(n));
}

/** Bytes as unpadded base64url (URL-safe, 4 characters per 3 bytes). */
export function base64Url(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i] as number;
        const b = bytes[i + 1];
        const c = bytes[i + 2];
        out += B64URL[a >> 2] as string;
        out += B64URL[((a & 3) << 4) | ((b ?? 0) >> 4)] as string;
        if (b !== undefined) out += B64URL[((b & 15) << 2) | ((c ?? 0) >> 6)] as string;
        if (c !== undefined) out += B64URL[c & 63] as string;
    }
    return out;
}

/** A random, URL-safe session id of 22 characters: no name or time in it. */
export function newSessionId(random: RandomBytes = platformRandom): string {
    return base64Url(random(16));
}

/** A random pilot id of 11 characters. */
export function newPilotId(random: RandomBytes = platformRandom): string {
    return base64Url(random(8));
}

export interface ManifestInput {
    /** default: a new random id */
    readonly id?: string;
    /** ISO 8601 */
    readonly created: string;
    readonly app: SessionManifest['app'];
    readonly scene: SessionManifest['scene'];
    readonly track?: TrackRef | null;
    readonly lesson?: SessionManifest['lesson'];
    readonly theme: SessionManifest['theme'];
    readonly settings: SonicPrefs;
    readonly assists?: LessonAssists | null;
    readonly device: DeviceInfo;
    readonly consent: Consent;
    readonly pilot: SessionManifest['pilot'];
    readonly clock: { readonly startIso: string; readonly frameHz?: number; readonly voiceOffsetMs?: number | null };
}

/** The manifest of a session that has just started: not complete, not ended, no files yet. */
export function buildManifest(input: ManifestInput, random?: RandomBytes): SessionManifest {
    return {
        format: FORMATS.session,
        id: input.id ?? newSessionId(random),
        created: input.created,
        ended: null,
        complete: false,
        app: input.app,
        scene: input.scene,
        track: input.track ?? null,
        lesson: input.lesson ?? null,
        theme: input.theme,
        settings: input.settings,
        assists: input.assists ?? null,
        device: input.device,
        consent: input.consent,
        pilot: input.pilot,
        clock: { startIso: input.clock.startIso, frameHz: input.clock.frameHz ?? 30, voiceOffsetMs: input.clock.voiceOffsetMs ?? null },
        files: []
    };
}

const TOP_KEYS = ['format', 'id', 'created', 'ended', 'complete', 'app', 'scene', 'track', 'lesson', 'theme', 'settings', 'assists', 'device', 'consent', 'pilot', 'clock', 'files'] as const;

function iso(c: Collector, v: unknown, path: string): string | undefined {
    const s = c.string(v, path, { max: 40 });
    if (s !== undefined && !isIsoDate(s)) {
        c.add(path, 'must be an ISO 8601 date and time with a zone, like 2026-11-07T10:30:00Z');
        return undefined;
    }
    return s;
}

function nullableNumber(c: Collector, v: unknown, path: string, min: number, max: number): number | null | undefined {
    return v === null ? null : c.number(v, path, { min, max });
}

function nullableString(c: Collector, v: unknown, path: string, max: number): string | null | undefined {
    return v === null ? null : c.string(v, path, { min: 1, max });
}

function pushIssues(c: Collector, prefix: string, issues: readonly Issue[]): void {
    for (const i of issues) c.add(i.path === '' ? prefix : i.path.startsWith('[') ? `${prefix}${i.path}` : joinPath(prefix, i.path), i.message);
}

/** Strict: every field present and valid, nothing else, and the privacy rules hold. */
export function validateManifest(input: unknown): Validation<SessionManifest> {
    const c = new Collector();
    const root = c.record(input, '');
    if (root === null) return { ok: false, issues: c.issues };
    c.keys(root, '', TOP_KEYS);
    // a key that is missing is reported once, by keys(): the sub-checks skip it
    const rec = (parent: Record<string, unknown>, key: string, path: string): Record<string, unknown> | null => (parent[key] === undefined ? null : c.record(parent[key], path));
    if (root['format'] !== FORMATS.session && root['format'] !== undefined) c.add('format', `must be '${FORMATS.session}', got ${JSON.stringify(root['format'])}`);
    const id = c.string(root['id'], 'id', { pattern: SESSION_ID, patternHint: 'must be 16 to 64 URL-safe characters (letters, digits, - and _)' });
    const created = iso(c, root['created'], 'created');
    const ended = root['ended'] === null ? null : iso(c, root['ended'], 'ended');
    const complete = c.boolean(root['complete'], 'complete');
    if (complete === true && root['ended'] === null) c.add('ended', 'a complete session must say when it ended');
    if (created !== undefined && typeof ended === 'string' && Date.parse(ended) < Date.parse(created)) c.add('ended', 'must not be before created');

    // app
    const app = rec(root, 'app', 'app');
    if (app !== null) {
        c.keys(app, 'app', ['name', 'release', 'sonic']);
        c.string(app['name'], 'app.name', { min: 1, max: 60 });
        c.string(app['release'], 'app.release', { min: 1, max: 80 });
        c.string(app['sonic'], 'app.sonic', { min: 1, max: 80 });
    }

    // scene and track
    const scene = rec(root, 'scene', 'scene');
    if (scene !== null) {
        c.keys(scene, 'scene', ['kind', 'id', 'version', 'transform']);
        c.oneOf(scene['kind'], 'scene.kind', ['none', 'analytic', 'scan'] as const);
        c.string(scene['id'], 'scene.id', { min: 1, max: 80 });
        c.number(scene['version'], 'scene.version', { integer: true, min: 0 });
        const tr = scene['transform'];
        if (!Array.isArray(tr) || tr.length !== 4 || !tr.every((x) => typeof x === 'number' && Number.isFinite(x)) || !((tr[0] as number) > 0)) c.add('scene.transform', 'must be [s, tx, ty, tz] with s > 0');
    }
    if (root['track'] !== null && root['track'] !== undefined) {
        const track = c.record(root['track'], 'track');
        if (track !== null) {
            c.keys(track, 'track', ['id', 'version']);
            c.string(track['id'], 'track.id', { min: 1, max: 80 });
            c.number(track['version'], 'track.version', { integer: true, min: 1 });
        }
    }
    if (root['lesson'] !== null && root['lesson'] !== undefined) {
        const lesson = c.record(root['lesson'], 'lesson');
        if (lesson !== null) {
            c.keys(lesson, 'lesson', ['id', 'version', 'path']);
            c.string(lesson['id'], 'lesson.id', { min: 1, max: 80, pattern: LESSON_ID });
            c.number(lesson['version'], 'lesson.version', { integer: true, min: 1 });
            c.oneOf(lesson['path'], 'lesson.path', ['full', 'fast'] as const);
        }
    }
    const theme = rec(root, 'theme', 'theme');
    if (theme !== null) {
        c.keys(theme, 'theme', ['id', 'version']);
        c.string(theme['id'], 'theme.id', { min: 1, max: 40, pattern: THEME_ID });
        c.number(theme['version'], 'theme.version', { integer: true, min: 1 });
    }

    // settings and assists reuse the strict validators of their own modules
    if (root['settings'] !== undefined) {
        const s = validatePrefs(root['settings']);
        if (!s.ok) pushIssues(c, 'settings', s.issues);
    }
    if (root['assists'] !== null && root['assists'] !== undefined) {
        const a = validateAssists(root['assists']);
        if (!a.ok) pushIssues(c, 'assists', a.issues);
    }

    // device
    const device = rec(root, 'device', 'device');
    if (device !== null) {
        c.keys(device, 'device', ['userAgent', 'locale', 'audio', 'input', 'inputName', 'headphones', 'gpu']);
        c.string(device['userAgent'], 'device.userAgent', { max: 500 });
        c.oneOf<Locale>(device['locale'], 'device.locale', LOCALES);
        const audio = rec(device, 'audio', 'device.audio');
        if (audio !== null) {
            c.keys(audio, 'device.audio', ['sampleRate', 'baseLatencyMs', 'outputLatencyMs']);
            c.number(audio['sampleRate'], 'device.audio.sampleRate', { min: 8000, max: 384000 });
            nullableNumber(c, audio['baseLatencyMs'], 'device.audio.baseLatencyMs', 0, 10000);
            nullableNumber(c, audio['outputLatencyMs'], 'device.audio.outputLatencyMs', 0, 10000);
        }
        c.oneOf(device['input'], 'device.input', ['keyboard', 'gamepad', 'radio', 'touch'] as const);
        nullableString(c, device['inputName'], 'device.inputName', 120);
        c.oneOf(device['headphones'], 'device.headphones', ['wired', 'bluetooth', 'speakers', 'unknown'] as const);
        nullableString(c, device['gpu'], 'device.gpu', 200);
    }

    // consent: spec section 10
    let consent: Record<string, unknown> | null = null;
    const rawConsent = rec(root, 'consent', 'consent');
    if (rawConsent !== null) {
        c.keys(rawConsent, 'consent', ['recording', 'voice', 'send', 'speechRecognition', 'minor', 'guardianConfirmed', 'at']);
        const recording = c.boolean(rawConsent['recording'], 'consent.recording');
        const voice = c.boolean(rawConsent['voice'], 'consent.voice');
        const send = c.boolean(rawConsent['send'], 'consent.send');
        const speechRecognition = c.boolean(rawConsent['speechRecognition'], 'consent.speechRecognition');
        const minor = c.boolean(rawConsent['minor'], 'consent.minor');
        const guardian = rawConsent['guardianConfirmed'] === null ? null : c.boolean(rawConsent['guardianConfirmed'], 'consent.guardianConfirmed');
        iso(c, rawConsent['at'], 'consent.at');
        if (voice === true && recording === false) c.add('consent.voice', 'voice cannot be consented to without consent to record');
        if (minor === true && guardian === null) c.add('consent.guardianConfirmed', 'for a minor this must say whether a guardian\'s signed consent was confirmed (true or false)');
        if (minor === false && guardian !== null && guardian !== undefined) c.add('consent.guardianConfirmed', 'must be null for an adult');
        // spec section 10 and docs/testing: for anyone under 18 a parent's signed consent, confirmed by the helper, comes first.
        // Local recording stays local, but what leaves the device (the package, or audio for the browser's speech recognition) needs it
        if (minor === true && guardian === false && (send === true || speechRecognition === true)) c.add('consent.guardianConfirmed', 'for a minor, consent to send the package or to use speech recognition (the audio goes to the browser vendor) needs a guardian\'s signed consent confirmed by the helper (true)');
        consent = rawConsent;
    }

    // pilot: no names
    const pilot = rec(root, 'pilot', 'pilot');
    if (pilot !== null) {
        c.keys(pilot, 'pilot', ['id', 'nickname']);
        c.string(pilot['id'], 'pilot.id', { pattern: PILOT_ID, patternHint: 'must be 8 to 64 URL-safe characters: a random id, never a name' });
        const nick = nullableString(c, pilot['nickname'], 'pilot.nickname', 40);
        if (typeof nick === 'string' && /[\u0000-\u001f\u007f]/.test(nick)) c.add('pilot.nickname', 'must not contain control characters');
    }

    // clock
    let voiceOffset: number | null | undefined;
    const clock = rec(root, 'clock', 'clock');
    if (clock !== null) {
        c.keys(clock, 'clock', ['startIso', 'frameHz', 'voiceOffsetMs']);
        iso(c, clock['startIso'], 'clock.startIso');
        c.number(clock['frameHz'], 'clock.frameHz', { min: 1, max: 240 });
        voiceOffset = nullableNumber(c, clock['voiceOffsetMs'], 'clock.voiceOffsetMs', -60000, 3600000);
    }

    // files
    const files = root['files'] === undefined ? null : c.array(root['files'], 'files', { max: LISTED_FILES.length });
    const listed = new Set<string>();
    (files ?? []).forEach((raw, i) => {
        const path = joinPath('files', i);
        const f = c.record(raw, path);
        if (f === null) return;
        c.keys(f, path, ['name', 'bytes', 'sha256']);
        const name = c.oneOf(f['name'], joinPath(path, 'name'), LISTED_FILES);
        if (name !== undefined) {
            if (listed.has(name)) c.add(joinPath(path, 'name'), `'${name}' is listed twice`);
            listed.add(name);
        }
        c.number(f['bytes'], joinPath(path, 'bytes'), { integer: true, min: 0 });
        c.string(f['sha256'], joinPath(path, 'sha256'), { pattern: SHA256_HEX, patternHint: 'must be 64 lower-case hex characters' });
    });
    if (listed.has(SESSION_FILES.voice)) {
        if (consent !== null && (consent['voice'] !== true || consent['recording'] !== true)) c.add('files', 'a voice recording is in the package but the consent does not allow recording voice');
        if (voiceOffset === null) c.add('clock.voiceOffsetMs', 'must say where voice.webm starts on the session clock when the package holds a voice recording');
    } else if (typeof voiceOffset === 'number' && complete === true) c.add('clock.voiceOffsetMs', 'must be null when a complete package holds no voice recording');

    if (!c.ok) return { ok: false, issues: c.issues };
    return { ok: true, value: root as unknown as SessionManifest };
}

/** Parses the text of manifest.json (strict). */
export function parseManifest(text: string): Validation<SessionManifest> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return { ok: false, issues: [{ path: '', message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    return validateManifest(data);
}

/** The canonical text of manifest.json: keys sorted, two spaces of indent, a final newline. */
export function writeManifest(manifest: SessionManifest): string {
    return `${canonicalPretty(manifest)}\n`;
}
