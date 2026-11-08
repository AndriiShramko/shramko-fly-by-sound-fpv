"""Shramko Virtual Listener, the first measuring rig: the measurements (docs/design/virtual-listener.md,
VL-0 and a cheap part of VL-2 and VL-6). Reads the renders the driver (tools/listen.ts) wrote, measures,
and prints one JSON document of checks. Every check carries its controls: a check is valid only when each
control (the engine or the host broken on purpose) fails it, and it passes only when it is valid.

    python -X utf8 tools/listen/measure.py --renders <dir> --clips <dir> --out <results.json>

A render is <job>.wav (float32, 4 channels: ears L, ears R, pre-chain L, pre-chain R) with <job>.json
(the truth per frame, the speech spans, the target notes the engine placed, the request). What this cannot
show: how any of it feels to a person; the voice and level Chrome really uses (the clips are the Windows
desktop voice); a listener's own ears (no HRTF panel here).
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import hilbert, resample_poly

MEASURE_VERSION = 3
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
IN_BAND_MOD_MAX = 0.1  # proposal: the height layer in the band, its envelope modulated at most 10 % between 2 and 70 Hz (no wobble, no roughness)
OUT_BAND_MOD_MIN = 0.3  # proposal: out of the band the buzz at the theme's roughHz is at least 30 % deep
# test-audio/page/listen.ts HOVER_HEIGHTS, HOVER_HOLD_S: hover-height's band 2 to 3 m, the target its centre
HOVER_HEIGHTS = [2.5, 2.45, 2.4, 2.3, 2.2, 2.05, 2.7, 2.95, 1.6, 3.4]
HOVER_HOLD_S = 2.5
HOVER_BAND = (2.0, 3.0)
# the crafts whose motor stems the rig renders (test-audio/page/listen-types.ts CRAFTS); the first is the default
CRAFTS = ['pavo20pro-3s', 'meteor65pro-1s', 'air65-1s', 'pavopico-2s', 'five-inch']
# lane s13-elev: the open-way chime above and below (test-audio/page/listen.ts FREE_PLAYS_S, FREE_PLAY_S)
FREE_PLAYS_S = [0.3, 3.6]
FREE_PLAY_S = 2.5
FREE_TAIL_S = 0.6  # the last note's decay after a play
ELEV_BANDS_HZ = [1000.0 * 2 ** (k / 3.0) for k in range(6, 13)]  # third octaves 4 to 16 kHz
ELEV_DIFF_MIN_DB = 1.0  # proposal: the HRTF's response over the band changes by about a spectral-profile JND (1 dB rms over the bands and ears)
AIR_TOP_MIN_DB = -30.0  # proposal: "energy up to about 16 kHz": the 16 kHz third octave within 30 dB of the cue's strongest band
PITCH_SAME_MAX_CENTS = 5.0  # the notes are the plan's: the measured tracks agree within 5 cents


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


def motor_job(craft):
    return 'flight-soft-solo-motor' if craft == CRAFTS[0] else 'flight-soft-solo-motor-' + craft


def check_motor(d):
    per_craft = {c: motor_margins(d, motor_job(c)) for c in CRAFTS}
    raw = motor_margins(d, 'flight-soft-motor-raw-60-solo-motor')
    ok = all(len(rows) == len(CUES) and all(r['minMarginDb'] >= MOTOR_MARGIN_MIN_DB for r in rows.values()) for rows in per_craft.values())
    ctrl_fails = any(r['minMarginDb'] < MOTOR_MARGIN_MIN_DB for r in raw.values())
    cue_sum = sum(load(d, 'flight-soft-solo-' + c)[0][:, 2:4].astype(np.float64) for c in CUES)
    cues_lufs = lufs(cue_sum)
    level = {'cuesLufs': round(cues_lufs, 2)}
    for c in CRAFTS:
        m = lufs(load(d, motor_job(c))[0][:, 2:4].astype(np.float64))
        level[c] = {'motorLufs': round(m, 2), 'motorUnderCuesLu': round(cues_lufs - m, 2)}
    level['rawMotor60Lufs'] = round(lufs(load(d, 'flight-soft-motor-raw-60-solo-motor')[0][:, 2:4].astype(np.float64)), 2)
    worst = min((r['minMarginDb'], c, cue) for c, rows in per_craft.items() for cue, r in rows.items())
    return {
        'id': 'VL-2-motor',
        'claim': 'every cue (safety, height, target, shape) is at least 6 dB over the motor in its own third-octave bands, where it sounds, for the simulator\'s default craft and the micro presets and a 5-inch quad, the slider at its default 15 % (control: the v0.12 path, the raw motor at the slider at 60 %)',
        'thresholds': {'minMarginDb': {'value': MOTOR_MARGIN_MIN_DB, 'kind': 'v13 plan'}, 'ownBands': {'value': 'within 10 dB of the cue\'s strongest band', 'kind': 'proposal'}},
        'measured': {'worst': {'marginDb': worst[0], 'craft': worst[1], 'cue': worst[2]}, 'margins': per_craft, 'level': level},
        'controls': [{'name': 'raw motor at 60 % (no low-pass, no leveller, as v0.12 auxInput), the default craft', 'measured': raw, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def mod_depth(x, lo, hi):
    """Depth of the envelope's modulation between lo and hi Hz: the Hilbert envelope's fluctuation around its mean,
    band-limited by a Hann-windowed spectrum; sqrt(2) times its rms, so an amplitude modulation of depth m gives m."""
    if len(x) < 64:
        return 0.0
    e = np.abs(hilbert(x.astype(np.float64)))
    mean = float(e.mean())
    if mean <= 0:
        return 0.0
    r = e / mean - 1.0
    w = np.hanning(len(r))
    spec = np.fft.rfft(r * w)
    freqs = np.fft.rfftfreq(len(r), 1.0 / RATE)
    sel = (freqs >= lo) & (freqs <= hi)
    ms = 2.0 * float(np.sum(np.abs(spec[sel]) ** 2)) / len(r) / float(np.sum(w ** 2))
    return math.sqrt(2.0 * ms)


def hover_windows(meta, steady):
    """Per held height: the windows where one sound holds still. Shipped: the plain height tone between two target
    notes, and each note's body (the swaps and the glide after a change of height left out). Control (steady pair):
    the whole held stretch."""
    out = []
    notes = sorted(meta.get('targetNotes') or [], key=lambda n: n['t0'])
    for i, h in enumerate(HOVER_HEIGHTS):
        s0, s1 = i * HOVER_HOLD_S + 0.4, (i + 1) * HOVER_HOLD_S - 0.05
        wins = []
        if steady:
            wins.append(('pair', s0, s1))
        else:
            inside = [n for n in notes if s0 - 0.3 <= n['t0'] <= s1]
            edges = [s0]
            for n in inside:
                a, b = n['t0'] + 0.03, n['t0'] + n['noteS'] - 0.02
                if a >= s0 and b <= s1 and b - a > 0.1:
                    wins.append(('note', a, b))
                edges.append(n['t0'] - 0.05)
                edges.append(n['t0'] + n['noteS'] + 0.015 + 0.02 + 0.04)
            edges.append(s1)
            for a, b in zip(edges[0::2], edges[1::2]):
                a, b = max(a, s0), min(b, s1)
                if b - a >= 0.3:
                    wins.append(('tone', a, b))
        out.append((h, wins))
    return out


def hover_rows(d, job, rough_hz):
    x, meta = load(d, job)
    mono = x[:, 2:4].mean(axis=1).astype(np.float64)
    steady = meta['request'].get('variant') == 'target-steady'
    rows = []
    for h, wins in hover_windows(meta, steady):
        in_band = HOVER_BAND[0] <= h <= HOVER_BAND[1]
        depth = 0.0
        buzz = 0.0
        kinds = {}
        for kind, a, b in wins:
            seg = mono[int(a * RATE) : int(b * RATE)]
            lo = 6.0 if kind == 'note' else 2.0
            dep = mod_depth(seg, lo, 70.0)
            depth = max(depth, dep)
            kinds[kind] = max(kinds.get(kind, 0.0), dep)
            if kind != 'note':
                buzz = max(buzz, mod_depth(seg, rough_hz - 8.0, rough_hz + 8.0))
        rows.append({'heightM': h, 'inBand': in_band, 'windows': len(wins), 'modDepth2to70Hz': round(depth, 3), 'byKind': {k: round(v, 3) for k, v in kinds.items()}, 'buzzDepth': round(buzz, 3)})
    notes = meta.get('targetNotes') or []
    return rows, len(notes)


def check_height_meanings(d):
    rough_hz = 38.0  # soft theme height.roughHz
    shipped, n_notes = hover_rows(d, 'hover-band-soft', rough_hz)
    steady, _ = hover_rows(d, 'hover-band-soft-target-steady', rough_hz)
    in_band = [r for r in shipped if r['inBand']]
    out_band = [r for r in shipped if not r['inBand']]
    ok_in = all(r['windows'] > 0 and r['modDepth2to70Hz'] <= IN_BAND_MOD_MAX for r in in_band)
    ok_out = all(r['buzzDepth'] >= OUT_BAND_MOD_MIN for r in out_band)
    ctrl_off = [r for r in steady if r['inBand'] and abs(r['heightM'] - 2.5) > 1e-9]
    ctrl_fails = sum(1 for r in ctrl_off if r['modDepth2to70Hz'] > IN_BAND_MOD_MAX) >= len(ctrl_off) - 1
    return {
        'id': 'VL-3-height',
        'claim': 'in a hover lesson\'s band the height layer neither wobbles nor buzzes at any distance from the target (envelope modulation at most 10 % between 2 and 70 Hz, in the plain height tone between target notes and in each note), so it cannot pass for the out-of-band buzz ("too high or too low") or the target hum\'s off-aim beat (2 to 7 Hz); out of the band it buzzes (at least 30 % at the theme\'s 38 Hz) (control: the first v0.13 design, a steady target tone 6 dB under the height tone, beats in the band)',
        'thresholds': {'inBandModDepth': {'value': IN_BAND_MOD_MAX, 'kind': 'proposal'}, 'outBandBuzzDepth': {'value': OUT_BAND_MOD_MIN, 'kind': 'proposal'}},
        'measured': {'targetNotes': n_notes, 'heights': shipped},
        'controls': [{'name': 'steady target tone 6 dB under the height tone (before review M2)', 'measured': steady, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok_in and ok_out and ctrl_fails,
    }


def band_power(x, lo_hz, hi_hz):
    """Power of a signal between two frequencies, by a Hann-windowed FFT of the whole stretch."""
    n = len(x)
    if n < 64:
        return 0.0
    spec = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    freqs = np.fft.rfftfreq(n, 1.0 / RATE)
    return float(np.sum(spec[(freqs >= lo_hz) & (freqs < hi_hz)]))


def third_octaves(x, centres):
    return [band_power(x, c * 2 ** (-1 / 6.0), c * 2 ** (1 / 6.0)) for c in centres]


def chime_play(d, job, k):
    """One play of the free chime (k 0: the way above, 1: below): the pre-chain stereo of its stretch, and its chime voice's direction from the truth."""
    x, meta = load(d, job)
    t0 = FREE_PLAYS_S[k]
    t1 = t0 + FREE_PLAY_S + FREE_TAIL_S
    seg = x[int(t0 * RATE) : int(t1 * RATE), 2:4].astype(np.float64)
    dirs = [r['chime']['dir'] for r in meta['truth'] if r.get('chime') and t0 <= r['t'] < t0 + FREE_PLAY_S]
    return seg, (dirs[len(dirs) // 2] if dirs else None)


def hrtf_response(d, job, dry_job, k):
    """The HRTF's own response to a play, per ear and third octave from 4 to 16 kHz, dB: the render over its dry twin
    (the same notes with no panner, both ears alike), so the cue's own spectrum and pitch drop out."""
    b, direction = chime_play(d, job, k)
    dry, _ = chime_play(d, dry_job, k)
    ref = third_octaves(dry[:, 0], ELEV_BANDS_HZ)
    out = []
    for ear in range(2):
        pw = third_octaves(b[:, ear], ELEV_BANDS_HZ)
        out.append([10 * math.log10(max(pw[i], 1e-30) / max(ref[i], 1e-30)) for i in range(len(ELEV_BANDS_HZ))])
    elev = None if direction is None else round(math.degrees(math.asin(max(-1.0, min(1.0, direction[1])))), 1)
    return out, elev


def rms_diff(a, b):
    v = [(a[e][i] - b[e][i]) ** 2 for e in range(2) for i in range(len(ELEV_BANDS_HZ))]
    return math.sqrt(sum(v) / len(v))


def top_band_db(d, job, k):
    """The 16 kHz third octave of a dry play against its strongest third octave (100 Hz to 16 kHz), dB."""
    seg, _ = chime_play(d, job, k)
    centres = [1000.0 * 2 ** (j / 3.0) for j in range(-10, 13)]
    pw = third_octaves(seg[:, 0], centres)
    return round(10 * math.log10(max(pw[-1], 1e-30) / max(max(pw), 1e-30)), 1)


def chime_pitch(d, job, k):
    seg, _ = chime_play(d, job, k)
    mono = seg.mean(axis=1)
    track = pitch_track(mono, 0.0, len(mono) / RATE - 0.1, hop=0.01, n=2048, fmin=300.0, fmax=2500.0)
    # only the hops where a note sounds: within 30 dB of the play's loudest 10 ms
    level = []
    for t, _ in track:
        i = int(t * RATE)
        level.append(rms(mono[max(0, i - 240) : i + 240]))
    top = max(level) if level else 0.0
    return [(t, f) for (t, f), lv in zip(track, level) if lv > top * 10 ** (-30 / 20)]


def check_elevation(d):
    """The open-way chime of a way above and of a way below through Chrome's HRTF: with the direction on, the HRTF's
    response over 4 to 16 kHz differs between above, ahead (the same chime with the direction off) and below; with it
    off, the chime above and the chime below both come from ahead and their responses do not differ. The cue's own
    spectrum and its pitch drop out (each render over its dry twin); the notes are the same either way."""
    on_up, el_up = hrtf_response(d, 'free-chime-soft', 'free-chime-soft-dry', 0)
    on_down, el_down = hrtf_response(d, 'free-chime-soft', 'free-chime-soft-dry', 1)
    off_up, el_off_up = hrtf_response(d, 'free-chime-soft-direction-off', 'free-chime-soft-direction-off-dry', 0)
    off_down, el_off_down = hrtf_response(d, 'free-chime-soft-direction-off', 'free-chime-soft-direction-off-dry', 1)
    above_ahead = rms_diff(on_up, off_up)
    below_ahead = rms_diff(on_down, off_down)
    above_below = rms_diff(on_up, on_down)
    control = rms_diff(off_up, off_down)
    pitch = {}
    worst = 0.0
    for k, name in enumerate(['above', 'below']):
        a = dict((round(t, 3), f) for t, f in chime_pitch(d, 'free-chime-soft-dry', k))
        b = dict((round(t, 3), f) for t, f in chime_pitch(d, 'free-chime-soft-direction-off-dry', k))
        both = sorted(set(a) & set(b))
        cents = [abs(1200 * math.log2(a[t] / b[t])) for t in both]
        worst = max(worst, max(cents) if cents else float('inf'))
        pitch[name] = {'hops': len(both), 'maxCents': round(max(cents), 2) if cents else None, 'notesHz': sorted(set(round(f, -1) for f in a.values()))[:6]}
    air = {name: {'on': top_band_db(d, 'free-chime-soft-dry', k), 'off': top_band_db(d, 'free-chime-soft-direction-off-dry', k)} for k, name in enumerate(['above', 'below'])}
    rnd = lambda m: [[round(v, 2) for v in row] for row in m]
    ok_place = above_ahead >= ELEV_DIFF_MIN_DB and below_ahead >= ELEV_DIFF_MIN_DB and above_below >= ELEV_DIFF_MIN_DB
    ok_air = all(v['on'] >= AIR_TOP_MIN_DB for v in air.values())
    ok_pitch = worst <= PITCH_SAME_MAX_CENTS
    ctrl_fails = control < ELEV_DIFF_MIN_DB and all(v['off'] < AIR_TOP_MIN_DB for v in air.values())
    return {
        'id': 'VL-1-elevation',
        'claim': 'the open-way chime of a way above and of a way below, rendered through Chrome\'s HRTF in headless Chrome as the engine plays it in a lesson: with the up/down direction on, the HRTF\'s response over 4 to 16 kHz (each render over its dry twin) differs by at least 1 dB rms between above, ahead and below, the chime carries energy up to 16 kHz, and its notes are the same as with the direction off (control: the direction off, both from ahead: no difference and no energy at 16 kHz)',
        'thresholds': {'elevationDiffDb': {'value': ELEV_DIFF_MIN_DB, 'kind': 'proposal'}, 'airTopBandDb': {'value': AIR_TOP_MIN_DB, 'kind': 'proposal'}, 'pitchSameCents': {'value': PITCH_SAME_MAX_CENTS, 'kind': 'proposal'}},
        'measured': {
            'elevationDeg': {'above': el_up, 'below': el_down, 'directionOff': [el_off_up, el_off_down]},
            'rmsDiffDb': {'aboveVsAhead': round(above_ahead, 2), 'belowVsAhead': round(below_ahead, 2), 'aboveVsBelow': round(above_below, 2)},
            'bandsHz': [round(c) for c in ELEV_BANDS_HZ],
            'responseDb': {'above': rnd(on_up), 'below': rnd(on_down), 'aheadAboveChime': rnd(off_up), 'aheadBelowChime': rnd(off_down)},
            'top16kBandDb': air,
            'pitch': pitch,
        },
        'controls': [{'name': 'the direction off (SonicPrefs.heightDirection false): the chime above and the chime below both from ahead, no breath', 'measured': {'rmsDiffDb': round(control, 2), 'top16kBandDb': {k: v['off'] for k, v in air.items()}}, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok_place and ok_air and ok_pitch and ctrl_fails,
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
    checks.append(check_height_meanings(a.renders))
    checks.append(check_elevation(a.renders))
    versions = {'python': sys.version.split()[0], 'numpy': np.__version__, 'scipy': __import__('scipy').__version__, 'soundfile': sf.__version__, 'pyloudnorm': getattr(pyln, '__version__', '0.2.0')}
    with open(a.out, 'w', encoding='utf8') as f:
        json.dump({'measure': MEASURE_VERSION, 'tools': versions, 'checks': checks}, f, indent=1)
    for c in checks:
        print(f"{c['id']}: {'PASS' if c['pass'] else ('FAIL' if c['valid'] else 'INVALID')}")
    return 0 if all(c['pass'] for c in checks) else 1


if __name__ == '__main__':
    sys.exit(main())
