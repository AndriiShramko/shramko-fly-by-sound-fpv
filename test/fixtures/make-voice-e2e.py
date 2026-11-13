#!/usr/bin/env python3
"""Synthetic recording packages for the end-to-end check of tools/listen/transcribe.py and tools/analyze.ts
(test/transcribe-e2e.test.ts; ShramkoGSFPV docs/wip/voice-feedback-plan.md 8, stage 1 item 4). Synthetic voices only:
no real recording is ever used here.

For each language of test/fixtures/voice-e2e-sentences.json the local Windows voice of the language
(test/fixtures/voice-e2e-tts.ps1) says five sentences at known times of a 45 s track and the lesson line echoKey at
ECHO_AT_S (the app's voice heard by the microphone); a little noise under it; encoded to Opus in WebM with PyAV; packed
with the flight of test/fixtures/make-session-fixture.py (the clean two-lesson flight), voiceOffsetMs OFFSET_MS and one
more speech event: the lesson line at its time on the session clock. The truth (the onset of each sentence on the
session clock, measured on the clip: the first 10 ms frame louder than a tenth of the clip's loudest) goes to
truth.json. Also, per language, the same package with the manifest offset moved by SHIFT_MS (the control), and one
English 10-minute track with a sentence every 30 s for the drift.

Run with the listener's Python (tools/listen/requirements.txt: numpy, scipy, av):
    <SHRAMKO_LISTEN_PY> -X utf8 test/fixtures/make-voice-e2e.py --work <dir outside the repository>
"""
import argparse
import importlib.util
import io
import json
import math
import os
import subprocess
import zipfile

import av
import numpy as np
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RATE = 16000
OFFSET_MS = 1500
SHIFT_MS = 2000
SENTENCE_AT_S = [3.0, 10.0, 17.0, 24.0, 31.0]
ECHO_AT_S = 38.0
SHORT_S = 45.0
LONG_S = 600.0
LONG_EVERY_S = 30.0
NOISE_RMS = 0.001  # about -60 dBFS: a quiet room (a choice, not measured)


def fixture_module():
    spec = importlib.util.spec_from_file_location('make_session_fixture', os.path.join(HERE, 'make-session-fixture.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def flat(d, p=''):
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out.update(flat(v, p + k + '.'))
        else:
            out[p + k] = v
    return out


def read_wav16(path):
    import wave
    with wave.open(path, 'rb') as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2
        x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
    return x


def onset_s(x):
    """The first 10 ms frame whose RMS is over a tenth of the loudest frame's: the start of the voice in the clip."""
    n = RATE // 100
    frames = x[: len(x) // n * n].reshape(-1, n)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    return float(np.argmax(rms > 0.1 * rms.max())) * n / RATE


def encode_webm(track, path):
    """16 kHz float mono to Opus at 48 kHz in WebM, as a browser's MediaRecorder writes it."""
    y = resample_poly(track, 3, 1).astype(np.float32)
    y = np.clip(y, -1.0, 1.0)
    with av.open(path, 'w', format='webm') as c:
        s = c.add_stream('libopus', rate=48000)
        s.layout = 'mono'
        step = 960 * 50
        pts = 0
        for k in range(0, len(y), step):
            f = av.AudioFrame.from_ndarray(y[None, k:k + step], format='flt', layout='mono')
            f.sample_rate = 48000
            f.pts = pts
            pts += f.samples
            for p in s.encode(f):
                c.mux(p)
        for p in s.encode(None):
            c.mux(p)


def package(fx, path, session_id, locale, offset_ms, voice, extra_events, end_ms):
    flight = fx.voice_flight(True)
    rows = [json.loads(line) for line in fx.voice_events(True).decode('utf-8').splitlines()]
    rows = [r for r in rows if not (r['kind'] == 'session' and r['what'] == 'end')] + extra_events
    rows.append({'t': end_ms, 'kind': 'session', 'what': 'end'})
    rows.sort(key=lambda r: r['t'])
    ev = ''.join(json.dumps(r, separators=(',', ':'), sort_keys=True) + '\n' for r in rows).encode('utf-8')
    sv = fx.voice_survey()
    doc = json.loads(fx.manifest(flight, ev, sv).decode('utf-8'))
    doc['id'] = session_id
    doc['lesson'] = {'id': 'rings-first', 'version': 1, 'path': 'full'}
    doc['device']['locale'] = locale
    doc['device']['headphones'] = 'speakers'
    doc['consent']['voice'] = True
    doc['pilot'] = {'id': 'pilotSynthetic01', 'nickname': 'SyntheticVoice'}
    doc['clock'] = {'startIso': '2026-11-07T10:00:00Z', 'frameHz': 10, 'voiceOffsetMs': offset_ms}
    doc['files'].append({'name': 'voice.webm', 'bytes': len(voice), 'sha256': fx.sha(voice)})
    man = (json.dumps(doc, indent=2, sort_keys=True) + '\n').encode('utf-8')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in [('manifest.json', man), ('flight.jsonl.gz', flight), ('events.jsonl', ev), ('survey.json', sv), ('voice.webm', voice)]:
            info = zipfile.ZipInfo(name, fx.DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    a = ap.parse_args()
    work = os.path.abspath(a.work)
    os.makedirs(os.path.join(work, 'clips'), exist_ok=True)
    fx = fixture_module()
    spec = json.load(open(os.path.join(HERE, 'voice-e2e-sentences.json'), encoding='utf-8'))
    langs = spec['languages']

    items = []
    for lang, v in langs.items():
        line = flat(json.load(open(os.path.join(ROOT, 'locales', f'{lang}.json'), encoding='utf-8')))[spec['echoKey']]
        v['line'] = line
        for i, text in enumerate(v['sentences'] + [line]):
            items.append({'voice': v['voice'], 'text': text, 'wav': os.path.join(work, 'clips', f'{lang}-{i}.wav')})
    with open(os.path.join(work, 'items.json'), 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False)
    r = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(HERE, 'voice-e2e-tts.ps1'), '-Items', os.path.join(work, 'items.json')], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'tts failed: {r.stderr.strip()[-400:]}')

    rng = np.random.default_rng(7)
    truth = {'offsetMs': OFFSET_MS, 'shiftMs': SHIFT_MS, 'languages': {}, 'long': None}

    def build(clips_at, seconds):
        track = (rng.standard_normal(int(seconds * RATE)) * NOISE_RMS).astype(np.float32)
        onsets = []
        for at, x in clips_at:
            k = int(round(at * RATE))
            track[k:k + len(x)] += x[: len(track) - k]
            onsets.append(round((at + onset_s(x)) * 1000) + OFFSET_MS)
        return track, onsets

    for lang, v in langs.items():
        clips = [read_wav16(os.path.join(work, 'clips', f'{lang}-{i}.wav')) for i in range(6)]
        track, onsets = build(list(zip(SENTENCE_AT_S + [ECHO_AT_S], clips)), SHORT_S)
        webm = os.path.join(work, f'{lang}.webm')
        encode_webm(track, webm)
        voice = open(webm, 'rb').read()
        line_t = round(ECHO_AT_S * 1000) + OFFSET_MS  # the app starts the line when it is said
        extra = [{'t': line_t, 'kind': 'speech', 'key': spec['echoKey'], 'text': v['line']}]
        package(fx, os.path.join(work, f'e2e-{lang}.zip'), f'e2eVoice{lang.upper()}01', lang, OFFSET_MS, voice, extra, round(SHORT_S * 1000) + OFFSET_MS + 200000)
        package(fx, os.path.join(work, f'e2e-{lang}-shift.zip'), f'e2eVoice{lang.upper()}Shift', lang, OFFSET_MS + SHIFT_MS, voice, extra, round(SHORT_S * 1000) + OFFSET_MS + 200000)
        truth['languages'][lang] = {'sentences': [{'text': s, 'tMs': t} for s, t in zip(v['sentences'], onsets[:5])], 'line': {'text': v['line'], 'tMs': onsets[5], 'eventMs': line_t}}

    en = [read_wav16(os.path.join(work, 'clips', f'en-{i}.wav')) for i in range(5)]
    n = int(LONG_S // LONG_EVERY_S)
    ats = [15.0 + LONG_EVERY_S * k for k in range(n)]
    track, onsets = build([(at, en[k % 5]) for k, at in enumerate(ats)], LONG_S + 15.0)
    encode_webm(track, os.path.join(work, 'long-en.webm'))
    voice = open(os.path.join(work, 'long-en.webm'), 'rb').read()
    package(fx, os.path.join(work, 'e2e-long-en.zip'), 'e2eVoiceLongEN01', 'en', OFFSET_MS, voice, [], round((LONG_S + 15.0) * 1000) + OFFSET_MS)
    truth['long'] = {'sentences': [{'text': langs['en']['sentences'][k % 5], 'tMs': t} for k, t in enumerate(onsets)]}
    with open(os.path.join(work, 'truth.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(truth, f, ensure_ascii=False, indent=1)
    print(f'make-voice-e2e: {len(langs)} languages, {len(items)} clips, long track {n} sentences, in {work}')


if __name__ == '__main__':
    main()
