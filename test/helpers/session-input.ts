// Shared test inputs for the session package tests: a valid manifest start, and synthetic frames.
import type { Consent, DeviceInfo, FlightFrame } from '../../src/contract';
import { defaultPrefs } from '../../src/prefs';
import type { ManifestInput } from '../../src/session';
import { yawQuat } from '../../src/util/vec';

export const DEVICE: DeviceInfo = {
    userAgent: 'vitest',
    locale: 'en',
    audio: { sampleRate: 48000, baseLatencyMs: 10.7, outputLatencyMs: null },
    input: 'keyboard',
    inputName: null,
    headphones: 'wired',
    gpu: null
};

export const CONSENT: Consent = { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-07T10:00:00Z' };

export const CONSENT_VOICE: Consent = { ...CONSENT, voice: true };

export function manifestInput(over: Partial<ManifestInput> = {}): ManifestInput {
    return {
        id: 'testSession0000000001',
        created: '2026-11-07T10:00:00Z',
        app: { name: 'vitest', release: 'test', sonic: 'test' },
        scene: { kind: 'none', id: 'none', version: 1, transform: [1, 0, 0, 0] },
        lesson: null,
        theme: { id: 'soft', version: 1 },
        settings: defaultPrefs(),
        device: DEVICE,
        consent: CONSENT,
        pilot: { id: 'testPilot01', nickname: null },
        clock: { startIso: '2026-11-07T10:00:00Z' },
        ...over
    };
}

/** `n` frames at `hz`, a craft circling at 2 m/s with unrounded numbers (the codec must round them). */
export function fakeFrames(n: number, hz = 30): FlightFrame[] {
    const out: FlightFrame[] = [];
    for (let i = 0; i < n; i++) {
        const t = (i * 1000) / hz;
        const a = i / 17;
        out.push({
            t,
            tick: Math.round(t),
            p: [Math.cos(a) * 3.1234567, 2.5 + 0.01 * Math.sin(a * 3), Math.sin(a) * 3.1234567],
            v: [-Math.sin(a) * 2.00049, 0, Math.cos(a) * 2.00049],
            q: yawQuat((a * 180) / Math.PI),
            s: [0.123456, -0.5, 0, 0.25],
            c: i % 3 === 0 ? ['height.tone', 'room.bed'] : ['height.tone']
        });
    }
    return out;
}
