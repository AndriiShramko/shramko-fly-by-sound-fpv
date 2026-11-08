"""Shramko Virtual Listener, the first measuring rig: the measurements (docs/design/virtual-listener.md,
VL-0 and a cheap part of VL-2 and VL-6). Reads the renders the driver (tools/listen.ts) wrote, measures,
and prints one JSON document of checks. Every check carries its controls: a check is valid only when each
control (the engine or the host broken on purpose) fails it, and it passes only when it is valid.

    python -X utf8 tools/listen/measure.py --renders <dir> --clips <dir> --out <results.json>

A render is <job>.wav (float32, 4 channels: ears L, ears R, pre-chain L, pre-chain R) with <job>.json
(the truth per frame, the speech spans, the request). What this cannot show: how any of it feels to a
person; the voice and level Chrome really uses (the clips are the Windows desktop voice); a listener's
own ears (no HRTF panel here).
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly

MEASURE_VERSION = 1
RATE = 48000

# thresholds (kind: standard, calibrated on controls, proposal)
PITCH_STEP_MAX_CENTS = 25.0  # largest pitch change between hops 10 ms apart in a smooth climb (proposal; the plan moves under 4 cents a hop)
PITCH_FOLLOW_MAX_CENTS = 15.0  # median distance of the measured track from the planned glide
ONSET_TTC_MIN_S = 2.0  # owner's message 41 via the v13 plan
TRUE_PEAK_MAX_DBTP = -1.0  # EBU R128
SPEECH_OVER_MIN_LU = 3.0  # proposal (design VL-6)
SPEECH_OVER_MAX_LU = 6.0
MOTOR_MARGIN_MIN_DB = 6.0  # the v13 plan
STEMS_RESIDUAL_MAX_DB = -90.0  # design VL-0b
STEMS_CONTROL_MIN_DB = -30.0
SAPI_DB_PER_STEP = 0.25  # measured: SAPI desktop voices lose 2.5 dB per 10 steps of volume (0 to 100), linear in dB


def load(dirname, job):
    x, fs = sf.read(os.path.join(dirname, job + '.wav'), dtype='float32', always_2d=True)
    assert fs == RATE, fs
    with open(os.path.join(dirname, job + '.json'), encoding='utf8') as f:
        meta = json.load(f)
    return x, meta


def db(x):
    return 20.0 * math.log10(max(float(x), 1e-12))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)))) if len(x) else 0.0


def true_peak_dbtp(x2):
    """4 times oversampled peak of every channel (ITU-R BS.1770-4 annex 2 style), dBTP."""
    peak = 0.0
    for c in range(x2.shape[1]):
        up = resample_poly(x2[:, c].astype(np.float64), 4, 1)
        peak = max(peak, float(np.max(np.abs(up))))
    return db(peak)


METER = pyln.Meter(RATE)


def lufs(x2):
    if x2.shape[0] < int(0.4 * RATE):
        return -70.0
    v = METER.integrated_loudness(x2.astype(np.float64))
    return float(v) if np.isfinite(v) else -70.0


def short_term_lufs(x2):
    """Loudness of a stretch as one block (BS.1770 K-weighting, no gating): the short-term reading of 3 s."""
    if x2.shape[0] < int(0.4 * RATE):
        return -70.0
    filtered = x2.astype(np.float64).copy()
    # the meter's K-weighting, channel by channel (as Meter.integrated_loudness applies it)
    for stage in METER._filters.values():
        for ch in range(filtered.shape[1]):
            filtered[:, ch] = stage.apply_filter(filtered[:, ch])
    z = np.mean(np.square(filtered), axis=0)
    p = float(np.sum(z))
    return -0.691 + 10.0 * math.log10(max(p, 1e-12))


def sapi_gain(volume):
    """Level change of a SAPI desktop voice for an utterance volume 0..1 (Chrome passes volume x 100 to SAPI), linear factor."""
    return 10.0 ** (SAPI_DB_PER_STEP * (100.0 * volume - 100.0) / 20.0)


def with_speech(ears, spans, clips_dir, volume_override=None):
    """The ears' signal with every spoken line's clip added at its start, at the engine's (or the given) volume."""
    out = ears.astype(np.float64).copy()
    lines = []
    for s in spans:
        clip, fs = sf.read(os.path.join(clips_dir, s['clipFile']), dtype='float32', always_2d=True)
        assert fs == RATE, fs
        vol = s['volume'] if volume_override is None else volume_override
        g = sapi_gain(vol)
        mono = clip[:, 0].astype(np.float64) * g
        i0 = int(round(s['t0'] * RATE))
        i1 = min(len(out), i0 + len(mono))
        if i1 > i0:
            out[i0:i1, 0] += mono[: i1 - i0]
            out[i0:i1, 1] += mono[: i1 - i0]
        lines.append({'key': s['key'], 't0': s['t0'], 'volume': vol, 'gainDb': round(db(g), 2), 'clip': mono})
    return out, lines


# ------------------------------------------------------------------ checks


# Two renders differ by float32 rounding (1.8e-7 measured, the first run): Chrome sums a node's inputs in an
# order that can change from run to run, so "bit-identical" (the design's first wording) is within 1e-6 here.
SAME_MAX_ABS = 1e-6


def check_determinism(d):
    a, _ = load(d, 'flight-soft')
    b, _ = load(d, 'flight-soft-again')
    c, _ = load(d, 'flight-soft-seed-2')
    same = float(np.max(np.abs(a.astype(np.float64) - b.astype(np.float64))))
    other = float(np.max(np.abs(a.astype(np.float64) - c.astype(np.float64))))
    return {
        'id': 'VL-0a',
        'claim': 'two renders of one scenario are the same within float32 rounding (control: another noise seed differs by more than 1e-3)',
        'thresholds': {'maxAbsDiff': {'value': SAME_MAX_ABS, 'kind': 'design, float32 rounding allowed'}},
        'measured': {'maxAbsDiff': same},
        'controls': [{'name': 'noise seed 2', 'measured': {'maxAbsDiff': round(other, 6)}, 'ok': other > 1e-3}],
        'valid': other > 1e-3,
        'pass': same <= SAME_MAX_ABS and other > 1e-3,
    }


STEMS = ['safety', 'height', 'target', 'shape', 'room', 'motor']


def check_stems(d):
    mix, _ = load(d, 'flight-soft')
    pre = mix[:, 2:4].astype(np.float64)
    parts = {s: load(d, 'flight-soft-solo-' + s)[0][:, 2:4].astype(np.float64) for s in STEMS}
    total = sum(parts.values())
    res = db(rms(pre - total) / max(rms(pre), 1e-12))
    loudest = max(STEMS, key=lambda s: rms(parts[s]))
    without = total - parts[loudest]
    res_ctrl = db(rms(pre - without) / max(rms(pre), 1e-12))
    return {
        'id': 'VL-0b',
        'claim': 'the solo stems (safety, height, target, shape, room, motor) sum to the pre-chain mix',
        'thresholds': {'residualDb': {'value': STEMS_RESIDUAL_MAX_DB, 'kind': 'design'}, 'controlResidualDb': {'value': STEMS_CONTROL_MIN_DB, 'kind': 'design'}},
        'measured': {'residualDb': round(res, 1), 'stemRmsDb': {s: round(db(rms(parts[s])), 1) for s in STEMS}},
        'controls': [{'name': 'the ' + loudest + ' stem left out of the sum', 'measured': {'residualDb': round(res_ctrl, 1)}, 'ok': res_ctrl > STEMS_CONTROL_MIN_DB}],
        'valid': res_ctrl > STEMS_CONTROL_MIN_DB,
        'pass': res <= STEMS_RESIDUAL_MAX_DB and res_ctrl > STEMS_CONTROL_MIN_DB,
    }


def pitch_track(mono, t0, t1, hop=0.01, n=4096, fmin=150.0, fmax=2000.0):
    """Frequency of the strongest spectral peak between fmin and fmax, every hop: Hann window, parabolic interpolation on the log magnitude."""
    win = np.hanning(n)
    freqs = np.fft.rfftfreq(n, 1.0 / RATE)
    lo = int(np.searchsorted(freqs, fmin))
    hi = int(np.searchsorted(freqs, fmax))
    out = []
    t = t0
    while t + n / RATE <= t1:
        i = int(round(t * RATE))
        spec = np.abs(np.fft.rfft(mono[i : i + n] * win))
        k = lo + int(np.argmax(spec[lo:hi]))
        a, b, c = (math.log(max(spec[k + j], 1e-20)) for j in (-1, 0, 1))
        delta = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
        out.append((t + n / (2 * RATE), (k + delta) * RATE / n))
        t += hop
    return out


def climb_pitch(d, job):
    x, meta = load(d, job)
    mono = x[:, 2:4].mean(axis=1).astype(np.float64)
    truth = meta['truth']
    track = pitch_track(mono, 1.2, 8.8)
    tt = np.array([r['t'] for r in truth])
    planned = np.array([r['heightHz'] if r['heightHz'] is not None else np.nan for r in truth])
    steps = [abs(1200 * math.log2(track[i][1] / track[i - 1][1])) for i in range(1, len(track))]
    follow = [abs(1200 * math.log2(f / float(np.interp(t, tt, planned)))) for t, f in track]
    return {'hops': len(track), 'maxStepCents': round(max(steps), 1), 'p99StepCents': round(float(np.percentile(steps, 99)), 1), 'medianOffPlanCents': round(float(np.median(follow)), 2), 'rangeHz': [round(min(f for _, f in track), 1), round(max(f for _, f in track), 1)]}


def check_pitch(d):
    shipped = climb_pitch(d, 'height-climb-soft')
    stepped = climb_pitch(d, 'height-climb-soft-stepped')
    ok = shipped['maxStepCents'] <= PITCH_STEP_MAX_CENTS and shipped['medianOffPlanCents'] <= PITCH_FOLLOW_MAX_CENTS
    ctrl_fails = stepped['maxStepCents'] > PITCH_STEP_MAX_CENTS
    return {
        'id': 'VL-pitch',
        'claim': 'the pitch track of the height stem is continuous while the height changes smoothly (a climb from 0.5 to 4.5 m at 0.5 m/s): no change over 25 cents between hops 10 ms apart, and the track follows the planned glide (control: the v0.12 stepped mapping jumps)',
        'thresholds': {'maxStepCents': {'value': PITCH_STEP_MAX_CENTS, 'kind': 'proposal'}, 'medianOffPlanCents': {'value': PITCH_FOLLOW_MAX_CENTS, 'kind': 'proposal'}},
        'measured': shipped,
        'controls': [{'name': 'v0.12 stepped height tone (rounded to whole notes)', 'measured': stepped, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def onset(d, job):
    x, meta = load(d, job)
    mono = x[:, 2:4].mean(axis=1).astype(np.float64)
    hop = int(0.005 * RATE)
    env = np.sqrt(np.convolve(np.square(mono), np.ones(hop) / hop, mode='valid'))
    idx = np.nonzero(env > 10 ** (-80 / 20))[0]
    if len(idx) == 0:
        return {'onsetS': None, 'ttcAtOnsetS': None}
    t_on = float(idx[0]) / RATE
    truth = meta['truth']
    tt = np.array([r['t'] for r in truth])
    hull = np.array([r['frontHullM'] for r in truth])
    speed = float(truth[0]['speedMps'])
    h = float(np.interp(t_on, tt, hull))
    return {'onsetS': round(t_on, 3), 'hullAtOnsetM': round(h, 2), 'ttcAtOnsetS': round(h / speed, 3), 'speedMps': speed}


def check_onset(d):
    rows = {v: onset(d, f'approach-{v}-soft') for v in (1, 3, 5)}
    ctrl = onset(d, 'approach-5-soft-distance-only')
    ok = all(r['ttcAtOnsetS'] is not None and r['ttcAtOnsetS'] >= ONSET_TTC_MIN_S for r in rows.values())
    ctrl_fails = ctrl['ttcAtOnsetS'] is not None and ctrl['ttcAtOnsetS'] < ONSET_TTC_MIN_S
    return {
        'id': 'VL-onset',
        'claim': 'the hazard stem starts at least 2 s before impact when flying straight at a wall at 1, 3 and 5 m/s (control: a distance-only rule, v0.12 front 6 m, starts later at 5 m/s)',
        'thresholds': {'ttcAtOnsetS': {'value': ONSET_TTC_MIN_S, 'kind': 'owner (v13 plan, M41-13)'}},
        'measured': {f'{v} m/s': r for v, r in rows.items()},
        'controls': [{'name': 'distance-only rule at 5 m/s', 'measured': ctrl, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def speech_lines(d, theme, clips_dir, volume_override=None):
    """The voice against the flight: the integrated loudness of all its lines (as spoken, at their volumes) over the
    integrated loudness of the ears' engine output from the end of the fade-in on; per line, its own loudness over
    the 3 s before it (information: a busy and a quiet moment of one flight differ by up to 10 LU)."""
    x, meta = load(d, 'flight-' + theme)
    ears = x[:, 0:2].astype(np.float64)
    spans = meta['speech']
    full, lines = with_speech(ears, spans, clips_dir, volume_override)
    voice = np.concatenate([ln['clip'] for ln in lines])
    voice_lufs = lufs(np.stack([voice, voice], axis=1))
    mix_lufs = lufs(ears[int(1.2 * RATE) :])
    per_line = []
    for ln in lines:
        i0 = int(round(ln['t0'] * RATE))
        sp = lufs(np.stack([ln['clip'], ln['clip']], axis=1))
        before = short_term_lufs(ears[i0 - 3 * RATE : i0]) if i0 >= 3 * RATE else None
        per_line.append({'key': ln['key'], 't0': round(ln['t0'], 2), 'volume': round(ln['volume'], 3), 'speechLufs': round(sp, 2), 'over3sBeforeLu': None if before is None else round(sp - before, 2)})
    row = {'voiceLufs': round(voice_lufs, 2), 'mixLufs': round(mix_lufs, 2), 'overLu': round(voice_lufs - mix_lufs, 2), 'volume': lines[0]['volume'] if lines else None, 'lines': per_line}
    return full, row


def check_speech_and_peak(d, clips_dir, themes):
    speech_rows = {}
    peak_rows = {}
    ctrl_speech = {}
    ctrl_peak = {}
    for th in themes:
        full, rows = speech_lines(d, th, clips_dir)
        speech_rows[th] = rows
        x, _ = load(d, 'flight-' + th)
        peak_rows[th] = {'mixWithSpeechDbtp': round(true_peak_dbtp(full), 2), 'engineOnlyDbtp': round(true_peak_dbtp(x[:, 0:2]), 2), 'engineLufs': round(lufs(x[:, 0:2]), 2)}
        full1, rows1 = speech_lines(d, th, clips_dir, volume_override=1.0)
        ctrl_speech[th] = rows1
        ctrl_peak[th] = round(true_peak_dbtp(full1), 2)
    sp_ok = all(SPEECH_OVER_MIN_LU <= r['overLu'] <= SPEECH_OVER_MAX_LU for r in speech_rows.values())
    sp_ctrl = any(r['overLu'] > SPEECH_OVER_MAX_LU for r in ctrl_speech.values())
    pk_ok = all(r['mixWithSpeechDbtp'] <= TRUE_PEAK_MAX_DBTP for r in peak_rows.values())
    pk_ctrl = any(v > TRUE_PEAK_MAX_DBTP for v in ctrl_peak.values())
    return [
        {
            'id': 'VL-6-speech',
            'claim': 'the voice (all its lines, at the engine\'s utterance volume, the Windows desktop voice) is 3 to 6 LU over the flight\'s mix, in every theme (control: the v0.12 utterance volume 1)',
            'thresholds': {'overLu': {'value': [SPEECH_OVER_MIN_LU, SPEECH_OVER_MAX_LU], 'kind': 'proposal (design VL-6)'}},
            'measured': speech_rows,
            'controls': [{'name': 'utterance volume 1 (v0.12)', 'measured': ctrl_speech, 'ok': sp_ctrl}],
            'valid': sp_ctrl,
            'pass': sp_ok and sp_ctrl,
        },
        {
            'id': 'VL-6-peak',
            'claim': 'the true peak of what reaches the ears (the engine and the voice) is at most -1 dBTP in every theme (control: the v0.12 utterance volume 1)',
            'thresholds': {'truePeakDbtp': {'value': TRUE_PEAK_MAX_DBTP, 'kind': 'standard (EBU R128)'}},
            'measured': peak_rows,
            'controls': [{'name': 'utterance volume 1 (v0.12)', 'measured': ctrl_peak, 'ok': pk_ctrl}],
            'valid': pk_ctrl,
            'pass': pk_ok and pk_ctrl,
        },
    ]


def third_octave_power(mono, frame_s=0.1):
    """Power per third-octave band (centres 100 Hz to 16 kHz) per frame, by FFT bins: an array frames x bands."""
    n = int(frame_s * RATE)
    centres = [1000.0 * 2 ** (k / 3.0) for k in range(-10, 13)]
    freqs = np.fft.rfftfreq(n, 1.0 / RATE)
    edges = [(c * 2 ** (-1 / 6.0), c * 2 ** (1 / 6.0)) for c in centres]
    win = np.hanning(n)
    frames = len(mono) // n
    out = np.zeros((frames, len(centres)))
    for i in range(frames):
        spec = np.abs(np.fft.rfft(mono[i * n : (i + 1) * n] * win)) ** 2
        for j, (lo, hi) in enumerate(edges):
            out[i, j] = float(np.sum(spec[(freqs >= lo) & (freqs < hi)]))
    return centres, out


CUES = ['safety', 'height', 'target', 'shape']


def motor_margins(d, motor_job):
    motor = load(d, motor_job)[0][:, 2:4].mean(axis=1).astype(np.float64)
    centres, mp = third_octave_power(motor)
    rows = {}
    for cue in CUES:
        stem = load(d, 'flight-soft-solo-' + cue)[0][:, 2:4].mean(axis=1).astype(np.float64)
        _, cp = third_octave_power(stem)
        frame_power = cp.sum(axis=1)
        if frame_power.max() <= 0:
            continue
        active = frame_power > frame_power.max() * 10 ** (-30 / 10)
        cue_band = cp[active].mean(axis=0)
        mot_band = mp[active].mean(axis=0)
        strongest = cue_band.max()
        own = [j for j in range(len(centres)) if cue_band[j] >= strongest * 10 ** (-10 / 10)]
        margins = {f'{centres[j]:.0f}': round(10 * math.log10(cue_band[j] / max(mot_band[j], 1e-20)), 1) for j in own}
        rows[cue] = {'activeFrames': int(active.sum()), 'ownBandsHz': list(margins.keys()), 'minMarginDb': min(margins.values()), 'marginsDb': margins}
    return rows


def check_motor(d):
    shipped = motor_margins(d, 'flight-soft-solo-motor')
    raw = motor_margins(d, 'flight-soft-motor-raw-60-solo-motor')
    ok = all(r['minMarginDb'] >= MOTOR_MARGIN_MIN_DB for r in shipped.values()) and len(shipped) == len(CUES)
    ctrl_fails = any(r['minMarginDb'] < MOTOR_MARGIN_MIN_DB for r in raw.values())
    mix, _ = load(d, 'flight-soft')
    cue_sum = sum(load(d, 'flight-soft-solo-' + c)[0][:, 2:4].astype(np.float64) for c in CUES)
    motor = load(d, 'flight-soft-solo-motor')[0][:, 2:4].astype(np.float64)
    raw_motor = load(d, 'flight-soft-motor-raw-60-solo-motor')[0][:, 2:4].astype(np.float64)
    level = {'cuesLufs': round(lufs(cue_sum), 2), 'motorLufs': round(lufs(motor), 2), 'motorUnderCuesLu': round(lufs(cue_sum) - lufs(motor), 2), 'rawMotor60Lufs': round(lufs(raw_motor), 2)}
    return {
        'id': 'VL-2-motor',
        'claim': 'every cue (safety, height, target, shape) is at least 6 dB over the motor in its own third-octave bands, where it sounds (control: the v0.12 path, the raw motor at the slider at 60 %)',
        'thresholds': {'minMarginDb': {'value': MOTOR_MARGIN_MIN_DB, 'kind': 'v13 plan'}, 'ownBands': {'value': 'within 10 dB of the cue\'s strongest band', 'kind': 'proposal'}},
        'measured': {'margins': shipped, 'level': level},
        'controls': [{'name': 'raw motor at 60 % (no low-pass, no leveller, as v0.12 auxInput)', 'measured': raw, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--renders', required=True)
    ap.add_argument('--clips', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--themes', default='soft,clear,race')
    a = ap.parse_args()
    themes = a.themes.split(',')
    checks = [check_determinism(a.renders), check_stems(a.renders), check_pitch(a.renders), check_onset(a.renders)]
    checks += check_speech_and_peak(a.renders, a.clips, themes)
    checks.append(check_motor(a.renders))
    versions = {'python': sys.version.split()[0], 'numpy': np.__version__, 'scipy': __import__('scipy').__version__, 'soundfile': sf.__version__, 'pyloudnorm': getattr(pyln, '__version__', '0.2.0')}
    with open(a.out, 'w', encoding='utf8') as f:
        json.dump({'measure': MEASURE_VERSION, 'tools': versions, 'checks': checks}, f, indent=1)
    for c in checks:
        print(f"{c['id']}: {'PASS' if c['pass'] else ('FAIL' if c['valid'] else 'INVALID')}")
    return 0 if all(c['pass'] for c in checks) else 1


if __name__ == '__main__':
    sys.exit(main())
