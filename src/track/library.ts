// The never-in-place rule. A track version, once published, is fixed: the same id and version with
// different content is refused, and the next version must name the one it changes. checkSuccession
// is the rule for two files; TrackLibrary keeps the history of tracks and applies it on every add.
import type { TrackFile } from '../contract';
import { canonicalJson } from '../util/canonical';
import { Collector, type Issue, type Validation } from '../util/check';
import { trackDigest, validateTrack } from './validate';

/** The track without what a new version changes by definition. */
function content(t: TrackFile): string {
    const { version: _v, parent: _p, created: _c, ...rest } = t;
    return canonicalJson(rest);
}

/** Does `next` correctly succeed `prev`? Same track, the next number, the right parent, a later date, a real change. */
export function checkSuccession(prev: TrackFile, next: TrackFile): Validation<true> {
    const c = new Collector();
    if (next.id !== prev.id) c.add('id', `a new version keeps the id '${prev.id}', got '${next.id}' (a copy under a new id is a fork: version 1 with a parent)`);
    if (next.version !== prev.version + 1) c.add('version', `must be ${prev.version + 1}, the number after ${prev.version}, got ${next.version}`);
    if (next.parent === null || next.parent.id !== prev.id || next.parent.version !== prev.version) c.add('parent', `must name ${prev.id} version ${prev.version}`);
    if (Date.parse(next.created) < Date.parse(prev.created)) c.add('created', `must not be earlier than the version it changes (${prev.created})`);
    if (next.scene.kind !== prev.scene.kind || next.scene.id !== prev.scene.id) c.add('scene', 'a track stays in its scene: a course in another scene is another track');
    if (content(next) === content(prev)) c.add('', 'nothing changed: a new version needs a change');
    return c.ok ? { ok: true, value: true } : { ok: false, issues: c.issues };
}

export type AddResult = { readonly ok: true; readonly added: boolean } | { readonly ok: false; readonly issues: readonly Issue[] };

/** An in-memory collection of tracks that enforces the version rule. */
export class TrackLibrary {
    private readonly byId = new Map<string, TrackFile[]>();
    private readonly digests = new Map<string, string>();

    private key(id: string, version: number): string {
        return `${id}@${version}`;
    }

    /**
     * Adds a track (validated here). The same id and version with the same content is accepted and
     * ignored; with other content it is refused. A version above 1 needs its parent in the library
     * and must correctly succeed it.
     */
    add(input: unknown): AddResult {
        const v = validateTrack(input);
        if (!v.ok) return v;
        const track = v.value;
        const key = this.key(track.id, track.version);
        const digest = trackDigest(track);
        const known = this.digests.get(key);
        if (known !== undefined) {
            return known === digest ? { ok: true, added: false } : { ok: false, issues: [{ path: '', message: `${key} already exists with different content: a published version is never edited, publish version ${this.latest(track.id)!.version + 1}` }] };
        }
        if (track.version > 1) {
            const prev = this.get(track.id, track.version - 1);
            if (prev === undefined) return { ok: false, issues: [{ path: 'parent', message: `${this.key(track.id, track.version - 1)} is not in the library` }] };
            const s = checkSuccession(prev, track);
            if (!s.ok) return s;
        }
        const list = this.byId.get(track.id) ?? [];
        list.push(track);
        list.sort((a, b) => a.version - b.version);
        this.byId.set(track.id, list);
        this.digests.set(key, digest);
        return { ok: true, added: true };
    }

    get(id: string, version: number): TrackFile | undefined {
        return this.byId.get(id)?.find((t) => t.version === version);
    }

    latest(id: string): TrackFile | undefined {
        const list = this.byId.get(id);
        return list === undefined ? undefined : list[list.length - 1];
    }

    /** All versions of a track, oldest first. */
    history(id: string): readonly TrackFile[] {
        return this.byId.get(id) ?? [];
    }

    ids(): string[] {
        return [...this.byId.keys()].sort();
    }
}
