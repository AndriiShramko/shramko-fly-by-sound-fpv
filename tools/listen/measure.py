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

MEASURE_VERSION = 5
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
# review E5 of lane s13-elev: the gaps flight (test-audio/page/listen.ts, tunnel-gaps along its track) under VL-6 and VL-2
FLIGHTS = ['flight', 'gaps']
GAPS_CUES = ['safety', 'height']  # the cue layers tunnel-gaps sounds (no target, no shapes)
COVER_MIN_FRAMES = 30  # each of the chime above, the chime below, the ceiling and the floor sounds, with its breath, for 0.5 s or more
BREATH_SPEECH_MAX_LU = 0.5  # proposal (review E5): the breath of air lowers the voice's margin over the tunnel's mix by at most this, LU
MOTOR_HIGHS_MIN_DB = 12.0  # the motor bus's design (src/audio/engine.ts): 12 dB or more off the cues' highs over 4 kHz


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


def speech_lines(d, theme, clips_dir, volume_override=None, flight='flight'):
    """The voice against the flight: the integrated loudness of all its lines (as spoken, at their volumes) over the
    integrated loudness of the ears' engine output from the end of the fade-in on; per line, its own loudness over
    the 3 s before it (information: a busy and a quiet moment of one flight differ by up to 10 LU)."""
    x, meta = load(d, flight + '-' + theme)
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


def gaps_cover(d):
    """What the gaps flight sounds (its truth, frame by frame): the frames with the chime above, the chime below, the
    ceiling and the floor, each with its breath of air (review E5: VL-6 and VL-2 measure them only if they sound)."""
    _, meta = load(d, 'gaps-soft')
    counts = {'chimeAbove': 0, 'chimeBelow': 0, 'ceiling': 0, 'floor': 0}
    for r in meta['truth']:
        voices = r.get('voices') or []
        breath = {v['cue'] for v in voices if v['breath']}
        chime = r.get('chime')
        if chime is not None and 'safety.free' in breath:
            if chime['dir'][1] > 0.1:
                counts['chimeAbove'] += 1
            elif chime['dir'][1] < -0.1:
                counts['chimeBelow'] += 1
        if 'safety.ceiling' in breath:
            counts['ceiling'] += 1
        if 'safety.floor' in breath:
            counts['floor'] += 1
    return {'frames': counts, 'ok': all(v >= COVER_MIN_FRAMES for v in counts.values()), 'minFrames': COVER_MIN_FRAMES}


def check_speech_and_peak(d, clips_dir, themes):
    speech_rows = {f: {} for f in FLIGHTS}
    peak_rows = {f: {} for f in FLIGHTS}
    ctrl_speech = {f: {} for f in FLIGHTS}
    ctrl_peak = {f: {} for f in FLIGHTS}
    for fl in FLIGHTS:
        for th in themes:
            full, rows = speech_lines(d, th, clips_dir, flight=fl)
            speech_rows[fl][th] = rows
            x, _ = load(d, fl + '-' + th)
            peak_rows[fl][th] = {'mixWithSpeechDbtp': round(true_peak_dbtp(full), 2), 'engineOnlyDbtp': round(true_peak_dbtp(x[:, 0:2]), 2), 'engineLufs': round(lufs(x[:, 0:2]), 2)}
            full1, rows1 = speech_lines(d, th, clips_dir, volume_override=1.0, flight=fl)
            ctrl_speech[fl][th] = rows1
            ctrl_peak[fl][th] = round(true_peak_dbtp(full1), 2)
    # review E5: the breath's own effect on the voice's margin in the tunnel: the same flight with Sound from above and
    # below off (no voice has the breath), theme by theme
    breath = {}
    for th in themes:
        _, off = speech_lines(d, th + '-direction-off', clips_dir, flight='gaps')
        on = speech_lines(d, th, clips_dir, flight='gaps')[1]
        breath[th] = {'overLuWithBreath': on['overLu'], 'overLuWithout': off['overLu'], 'mixLufsWithBreath': on['mixLufs'], 'mixLufsWithout': off['mixLufs'], 'breathCostLu': round(off['overLu'] - on['overLu'], 2)}
    cover = gaps_cover(d)
    sp_ok = all(SPEECH_OVER_MIN_LU <= r['overLu'] <= SPEECH_OVER_MAX_LU for r in speech_rows['flight'].values())
    breath_ok = all(b['breathCostLu'] <= BREATH_SPEECH_MAX_LU for b in breath.values())
    sp_ctrl = any(r['overLu'] > SPEECH_OVER_MAX_LU for r in ctrl_speech['flight'].values())
    pk_ok = all(r['mixWithSpeechDbtp'] <= TRUE_PEAK_MAX_DBTP for rows in peak_rows.values() for r in rows.values())
    pk_ctrl = any(v > TRUE_PEAK_MAX_DBTP for rows in ctrl_peak.values() for v in rows.values())
    return [
        {
            'id': 'VL-6-speech',
            'claim': "the voice (all its lines, at the engine's utterance volume, the Windows desktop voice) is 3 to 6 LU over the ring flight's mix, in every theme (control: the v0.12 utterance volume 1); in tunnel-gaps flown with the chime above and below, the ceiling and the floor, the breath of air lowers the voice's margin over the mix by at most 0.5 LU in every theme (against the same flight with Sound from above and below off); the tunnel's own margin is reported",
            'thresholds': {'overLu': {'value': [SPEECH_OVER_MIN_LU, SPEECH_OVER_MAX_LU], 'kind': 'proposal (design VL-6), the ring flight, where the voice was set (M41-17)'}, 'breathCostLu': {'value': BREATH_SPEECH_MAX_LU, 'kind': 'proposal (review E5)'}, 'gapsCoverFrames': {'value': COVER_MIN_FRAMES, 'kind': 'proposal (review E5)'}},
            'measured': {'flights': speech_rows, 'breathInTheTunnel': breath, 'gapsCover': cover, 'reported': 'the tunnel\'s own margin (flights.gaps) is not held to 3 to 6 LU: the voices were set for the ring flight, and one utterance volume cannot hold both (docs/dev/status-v0.13-sound.md, step 8); see docs/dev/status-v0.13-elev.md, F4'},
            'controls': [{'name': 'utterance volume 1 (v0.12)', 'measured': ctrl_speech, 'ok': sp_ctrl}],
            'valid': sp_ctrl and cover['ok'],
            'pass': sp_ok and breath_ok and sp_ctrl and cover['ok'],
        },
        {
            'id': 'VL-6-peak',
            'claim': 'the true peak of what reaches the ears (the engine and the voice) is at most -1 dBTP in every theme, in the ring flight and in tunnel-gaps flown with the chime above and below, the ceiling and the floor and their breath of air (control: the v0.12 utterance volume 1)',
            'thresholds': {'truePeakDbtp': {'value': TRUE_PEAK_MAX_DBTP, 'kind': 'standard (EBU R128)'}},
            'measured': {'flights': peak_rows, 'gapsCover': cover},
            'controls': [{'name': 'utterance volume 1 (v0.12)', 'measured': ctrl_peak, 'ok': pk_ctrl}],
            'valid': pk_ctrl and cover['ok'],
            'pass': pk_ok and pk_ctrl and cover['ok'],
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


def motor_margins(d, motor_job, flight='flight', cues=CUES):
    motor = load(d, motor_job)[0][:, 2:4].mean(axis=1).astype(np.float64)
    centres, mp = third_octave_power(motor)
    rows = {}
    for cue in cues:
        stem = load(d, flight + '-soft-solo-' + cue)[0][:, 2:4].mean(axis=1).astype(np.float64)
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


def motor_job(craft, flight='flight'):
    return flight + '-soft-solo-motor' if craft == CRAFTS[0] else flight + '-soft-solo-motor-' + craft


def breath_margin(d, motor_job_id):
    """The gaps flight's safety stem over the motor in each third octave from 4 to 16 kHz (where the breath of air is), in
    the frames (100 ms) where a safety voice with the breath sounds, dB; and the lowest band's margin."""
    _, meta = load(d, 'gaps-soft')
    stem = load(d, 'gaps-soft-solo-safety')[0][:, 2:4].mean(axis=1).astype(np.float64)
    motor = load(d, motor_job_id)[0][:, 2:4].mean(axis=1).astype(np.float64)
    centres, sp = third_octave_power(stem)
    _, mp = third_octave_power(motor)
    frames = sp.shape[0]
    breath = np.zeros(frames, dtype=bool)
    for r in meta['truth']:
        k = int(r['t'] / 0.1)
        if k < frames and any(v['breath'] and v['cue'].startswith('safety.') for v in (r.get('voices') or [])):
            breath[k] = True
    bands = [j for j, c in enumerate(centres) if 3900 <= c <= 16500]
    margins = {f'{centres[j]:.0f}': round(10 * math.log10(sp[breath, j].mean() / max(mp[breath, j].mean(), 1e-20)), 1) for j in bands}
    return {'frames': int(breath.sum()), 'marginsDb': margins, 'minMarginDb': min(margins.values())}


def check_motor(d):
    per_craft = {c: motor_margins(d, motor_job(c)) for c in CRAFTS}
    raw = motor_margins(d, 'flight-soft-motor-raw-60-solo-motor')
    # review E5: tunnel-gaps flown, the chime above and below, the ceiling and the floor with their breath of air
    gaps_per_craft = {c: motor_margins(d, motor_job(c, 'gaps'), 'gaps', GAPS_CUES) for c in CRAFTS}
    gaps_raw = motor_margins(d, 'gaps-soft-motor-raw-60-solo-motor', 'gaps', GAPS_CUES)
    breath = {c: breath_margin(d, motor_job(c, 'gaps')) for c in CRAFTS}
    breath_raw = breath_margin(d, 'gaps-soft-motor-raw-60-solo-motor')
    cover = gaps_cover(d)
    ok = all(len(rows) == len(CUES) and all(r['minMarginDb'] >= MOTOR_MARGIN_MIN_DB for r in rows.values()) for rows in per_craft.values())
    gaps_ok = all(len(rows) == len(GAPS_CUES) and all(r['minMarginDb'] >= MOTOR_MARGIN_MIN_DB for r in rows.values()) for rows in gaps_per_craft.values())
    breath_ok = all(b['frames'] >= 5 and b['minMarginDb'] >= MOTOR_HIGHS_MIN_DB for b in breath.values())
    ctrl_fails = any(r['minMarginDb'] < MOTOR_MARGIN_MIN_DB for r in raw.values())
    gaps_ctrl_fails = any(r['minMarginDb'] < MOTOR_MARGIN_MIN_DB for r in gaps_raw.values()) or breath_raw['minMarginDb'] < MOTOR_HIGHS_MIN_DB
    cue_sum = sum(load(d, 'flight-soft-solo-' + c)[0][:, 2:4].astype(np.float64) for c in CUES)
    cues_lufs = lufs(cue_sum)
    level = {'cuesLufs': round(cues_lufs, 2)}
    for c in CRAFTS:
        m = lufs(load(d, motor_job(c))[0][:, 2:4].astype(np.float64))
        level[c] = {'motorLufs': round(m, 2), 'motorUnderCuesLu': round(cues_lufs - m, 2)}
    level['rawMotor60Lufs'] = round(lufs(load(d, 'flight-soft-motor-raw-60-solo-motor')[0][:, 2:4].astype(np.float64)), 2)
    worst = min((r['minMarginDb'], c, cue) for c, rows in per_craft.items() for cue, r in rows.items())
    gaps_worst = min((r['minMarginDb'], c, cue) for c, rows in gaps_per_craft.items() for cue, r in rows.items())
    breath_worst = min((b['minMarginDb'], c) for c, b in breath.items())
    return {
        'id': 'VL-2-motor',
        'claim': "every cue (safety, height, target, shape) is at least 6 dB over the motor in its own third-octave bands, where it sounds, for the simulator's default craft and the micro presets and a 5-inch quad, the slider at its default 15 %, in the ring flight and in tunnel-gaps flown (safety and height there: the chime above and below, the ceiling and the floor), and there the breath of air of those cues is 12 dB over the motor in every third octave from 4 to 16 kHz, as the motor bus is made to keep off the cues' highs (control: the v0.12 path, the raw motor at the slider at 60 %)",
        'thresholds': {'minMarginDb': {'value': MOTOR_MARGIN_MIN_DB, 'kind': 'v13 plan'}, 'ownBands': {'value': "within 10 dB of the cue's strongest band", 'kind': 'proposal'}, 'breathBands': {'value': '4 to 16 kHz third octaves, frames with a safety voice that has the breath', 'kind': 'proposal (review E5)'}, 'breathMarginDb': {'value': MOTOR_HIGHS_MIN_DB, 'kind': 'the motor bus design'}},
        'measured': {
            'worst': {'marginDb': worst[0], 'craft': worst[1], 'cue': worst[2]},
            'margins': per_craft,
            'level': level,
            'gaps': {'worst': {'marginDb': gaps_worst[0], 'craft': gaps_worst[1], 'cue': gaps_worst[2]}, 'margins': gaps_per_craft, 'breath': breath, 'breathWorst': {'marginDb': breath_worst[0], 'craft': breath_worst[1]}, 'cover': cover},
        },
        'controls': [
            {'name': 'raw motor at 60 % (no low-pass, no leveller, as v0.12 auxInput), the default craft', 'measured': raw, 'ok': ctrl_fails},
            {'name': 'the same in tunnel-gaps (its margins and the breath bands)', 'measured': {'margins': gaps_raw, 'breath': breath_raw}, 'ok': gaps_ctrl_fails},
        ],
        'valid': ctrl_fails and gaps_ctrl_fails and cover['ok'],
        'pass': ok and gaps_ok and breath_ok and ctrl_fails and gaps_ctrl_fails and cover['ok'],
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
    out = []
    for ear in range(2):
        ref = third_octaves(dry[:, ear], ELEV_BANDS_HZ)
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


# ------------------------------------------------------------------ lane sonic-beacon (S4): the target beacon

BEACON_SIDE_MIN_DB = 2.0  # the task's bound: the level difference between the ears says the side by at least 2 dB
BEACON_FOLD_MAX_DB = 1.0  # the task's bound: beyond 90 degrees the ears hear what they hear at 90, within 1 dB
BEACON_FOLD_MAX_US = 20.0  # and within 20 microseconds
BEACON_OCTAVE_CENTS = 1200.0
BEACON_OCTAVE_TOL_CENTS = 5.0
BEACON_COVER_MIN = 0.95  # the task's bound: 95 % of the one-second windows carry a direction
BEACON_FAR_MIN_DB = 6.0  # the task's bound, as MOTOR_MARGIN_MIN_DB: the hum's band 6 dB over motor and room at 40 m
BEACON_WIN_S = 1.0  # the measured last part of a near pose's hold (test-audio/page/listen.ts BEACON_POSES)
BEACON_FAR_WIN_S = 2.0  # of a far pose's hold
BEACON_SOUNDING_DB = -70.0  # estimate: a stem below this rms in a window is silent there (the rig's renders have no noise floor)
BEACON_PATHS = ['beacon-corridor', 'beacon-tunnel']
BEACON_STEMS = ['safety', 'height', 'target', 'shape', 'room']


def pose_windows(meta, win_s, far):
    """{pose index: (azDeg, distM, t0, t1)}: the last win_s of each pose's hold, from the truth rows."""
    spans = {}
    for row in meta['truth']:
        p = row.get('beaconPose')
        if not p:
            continue
        k = p['k']
        a = spans.setdefault(k, [p['azDeg'], p['distM'], row['t'], row['t']])
        a[3] = row['t']
    out = {}
    for k, (az, dist, t0, t1) in spans.items():
        is_far = dist != 10
        if is_far != far:
            continue
        end = t1 + 1.0 / 60
        out[k] = (az, dist, max(t0, end - win_s), end)
    return out


def ild_db(x, t0, t1):
    i, j = int(t0 * RATE), int(t1 * RATE)
    return db(rms(x[i:j, 0])) - db(rms(x[i:j, 1]))


def itd_us(x, t0, t1, max_us=1200.0):
    """Lag of the right ear behind the left, microseconds (+: the left ear leads, a source on the left), by the peak
    of the cross-correlation within +-max_us, parabolic interpolation."""
    i, j = int(t0 * RATE), int(t1 * RATE)
    l = x[i:j, 0].astype(np.float64)
    r = x[i:j, 1].astype(np.float64)
    m = int(max_us * 1e-6 * RATE) + 1
    n = len(l)
    cc = np.array([np.dot(l[max(0, -k) : n - max(0, k)], r[max(0, k) : n - max(0, -k)]) for k in range(-m, m + 1)])
    p = int(np.argmax(cc))
    delta = 0.0
    if 0 < p < len(cc) - 1:
        a, b, c = cc[p - 1], cc[p], cc[p + 1]
        den = a - 2 * b + c
        delta = 0.5 * (a - c) / den if den != 0 else 0.0
    return (p - m + delta) / RATE * 1e6


def ring(d, job):
    x, meta = load(d, job)
    near = pose_windows(meta, BEACON_WIN_S, far=False)
    return x, meta, {(az, dist): (t0, t1) for (az, dist, t0, t1) in near.values()}


def check_beacon_side(d):
    """VL-B1: the hum alone, the target every 20 degrees from 10 to 170 on both sides at 10 m: the louder ear is the
    target's side at every azimuth, by at least 2 dB. Control: the HRTF panner bypassed."""
    def measure(job):
        x, _, w = ring(d, job)
        rows = []
        for az in [10, 30, 50, 70, 90, 110, 130, 150, 170]:
            for s in (1, -1):
                t0, t1 = w[(s * az, 10)]
                ild = ild_db(x, t0, t1)  # left over right: + means the left ear is louder
                ok = (ild <= -BEACON_SIDE_MIN_DB) if s > 0 else (ild >= BEACON_SIDE_MIN_DB)
                rows.append({'azDeg': s * az, 'ildLeftOverRightDb': round(ild, 2), 'ok': ok})
        return rows
    shipped = measure('beacon-ring-soft-solo-target')
    control = measure('beacon-ring-soft-dry-solo-target')
    ok = all(r['ok'] for r in shipped)
    ctrl_fails = not all(r['ok'] for r in control)
    return {
        'id': 'VL-B1-side',
        'claim': 'the target hum alone through Chrome\'s HRTF, the target at 10 m every 20 degrees from 10 to 170 on both sides of the nose: at every azimuth the ear on the target\'s side is louder, by at least 2 dB (control: the HRTF panner bypassed)',
        'thresholds': {'sideMinDb': {'value': BEACON_SIDE_MIN_DB, 'kind': 'task bound (lane sonic-beacon S4)'}},
        'measured': {'worstSideDb': round(min(abs(r['ildLeftOverRightDb']) for r in shipped), 2), 'rows': shipped},
        'controls': [{'name': 'the HRTF panner bypassed (EngineTestHooks.bypassPanner)', 'measured': {'worstSideDb': round(min(abs(r['ildLeftOverRightDb']) for r in control), 2), 'rows': control}, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def check_beacon_fold(d):
    """VL-B2: targets at 120, 150 and 170 degrees give the ears what a target at 90 on that side gives: level
    difference within 1 dB, time difference within 20 microseconds. Control: the beacon off (the true HRTF behind)."""
    def measure(job):
        x, _, w = ring(d, job)
        rows = []
        for s in (1, -1):
            r0, r1 = w[(s * 90, 10)]
            ild90, itd90 = ild_db(x, r0, r1), itd_us(x, r0, r1)
            for az in (120, 150, 170):
                t0, t1 = w[(s * az, 10)]
                dl = ild_db(x, t0, t1) - ild90
                dt = itd_us(x, t0, t1) - itd90
                rows.append({'azDeg': s * az, 'ildDiffDb': round(dl, 3), 'itdDiffUs': round(dt, 2), 'ok': abs(dl) <= BEACON_FOLD_MAX_DB and abs(dt) <= BEACON_FOLD_MAX_US})
            rows.append({'azDeg': s * 90, 'ildDb': round(ild90, 2), 'itdUs': round(itd90, 1)})
        return rows
    shipped = measure('beacon-ring-soft-solo-target')
    control = measure('beacon-ring-soft-beacon-off-solo-target')
    ok = all(r.get('ok', True) for r in shipped)
    ctrl_fails = not all(r.get('ok', True) for r in control)
    return {
        'id': 'VL-B2-fold',
        'claim': 'the target hum alone through Chrome\'s HRTF: a target at 120, 150 or 170 degrees from the nose sounds at the ears as one at 90 degrees on its side (level difference within 1 dB, time difference within 20 us): nothing depends on hearing behind (control: SonicPrefs.beacon false, the true direction behind)',
        'thresholds': {'foldMaxDb': {'value': BEACON_FOLD_MAX_DB, 'kind': 'task bound'}, 'foldMaxUs': {'value': BEACON_FOLD_MAX_US, 'kind': 'task bound'}},
        'measured': {'rows': shipped},
        'controls': [{'name': 'the beacon off (SonicPrefs.beacon false): the hum from its true direction behind', 'measured': {'rows': control}, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def hum_pitch(x, meta, t0, t1):
    """Median measured pitch of the target stem over the hops where a note sounds, between 0.8 and 1.25 times the
    lowest and highest note the plan gives the hum in the window (so the track takes the note, not a partial)."""
    hz = [row['hum']['hz'] for row in meta['truth'] if row.get('hum') and t0 <= row['t'] < t1]
    if not hz:
        return None, None
    mono = x[:, 0] + x[:, 1]
    track = pitch_track(mono, t0, t1, hop=0.01, n=4096, fmin=0.8 * min(hz), fmax=1.25 * max(hz))
    level = [rms(mono[int(t * RATE) - 240 : int(t * RATE) + 240]) for t, _ in track]
    top = max(level) if level else 0.0
    fs = [f for (t, f), lv in zip(track, level) if lv > top * 10 ** (-20 / 20)]
    return (float(np.median(fs)) if fs else None), float(np.median(hz))


def check_beacon_octave(d):
    """VL-B3: the hum at 0 and 5 degrees (on course) is an octave (1200 cents, within 5) above the hum at 12 degrees,
    on both sides. Control: the octave off (SonicPrefs.beacon false)."""
    def measure(job):
        x, meta, w = ring(d, job)
        rows = []
        for s in (1, -1):
            ref, ref_plan = hum_pitch(x, meta, *w[(s * 12, 10)])
            for az in (0, 5):
                f, plan = hum_pitch(x, meta, *w[(s * az, 10)])
                cents = 1200 * math.log2(f / ref) if f and ref else None
                rows.append({'azDeg': s * az, 'vsAzDeg': s * 12, 'measuredHz': round(f, 2) if f else None, 'refHz': round(ref, 2) if ref else None, 'planHz': plan, 'refPlanHz': ref_plan, 'cents': round(cents, 2) if cents is not None else None, 'ok': cents is not None and abs(cents - BEACON_OCTAVE_CENTS) <= BEACON_OCTAVE_TOL_CENTS})
        return rows
    shipped = measure('beacon-ring-soft-solo-target')
    control = measure('beacon-ring-soft-beacon-off-solo-target')
    ok = all(r['ok'] for r in shipped)
    ctrl_fails = not all(r['ok'] for r in control)
    return {
        'id': 'VL-B3-octave',
        'claim': 'the target stem\'s measured pitch with the target at 0 and 5 degrees from the nose (on course) is 1200 cents (within 5) above its pitch at 12 degrees, on both sides (control: the octave off, SonicPrefs.beacon false)',
        'thresholds': {'octaveCents': {'value': BEACON_OCTAVE_CENTS, 'kind': 'design decision 3'}, 'toleranceCents': {'value': BEACON_OCTAVE_TOL_CENTS, 'kind': 'task bound'}},
        'measured': {'rows': shipped},
        'controls': [{'name': 'the octave off (SonicPrefs.beacon false)', 'measured': {'rows': control}, 'ok': ctrl_fails}],
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def on_course(row):
    h = row.get('hum')
    if not h:
        return False
    x, _, z = h['dir']
    return math.degrees(math.atan2(abs(x), -z)) <= 8.0  # src/cues/beacon.ts ON_COURSE_DEG


def path_cover(d, path, variant):
    """Share of the one-second windows after the still second in which some stem carries a side (|ILD| >= 2 dB while
    it sounds), and the share in which a side or the on-course hum (the target stem sounds and the plan's hum is within
    ON_COURSE_DEG of the nose for at least half the window) tells the way."""
    stems = {}
    meta = None
    for s in BEACON_STEMS:
        x, m = load(d, f'{path}-soft{variant}-solo-{s}')
        stems[s] = x
        meta = meta or m
    n = min(len(x) for x in stems.values())
    t_end = n / RATE
    rows = []
    t = 1.0
    while t + BEACON_WIN_S <= t_end + 1e-9:
        i, j = int(t * RATE), int((t + BEACON_WIN_S) * RATE)
        sides = {}
        sounding = {}
        for s, x in stems.items():
            lv = db(rms(x[i:j, :].reshape(-1)))
            sounding[s] = lv > BEACON_SOUNDING_DB
            if sounding[s]:
                sides[s] = round(ild_db(x, t, t + BEACON_WIN_S), 2)
        side = any(abs(v) >= BEACON_SIDE_MIN_DB for v in sides.values())
        frames = [row for row in meta['truth'] if t <= row['t'] < t + BEACON_WIN_S]
        course = sounding['target'] and frames and sum(on_course(r) for r in frames) >= 0.5 * len(frames)
        rows.append({'t': round(t, 2), 'side': side, 'onCourse': bool(course), 'ildDb': sides})
        t += BEACON_WIN_S
    k = len(rows) or 1
    return {
        'windows': len(rows),
        'sideShare': round(sum(r['side'] for r in rows) / k, 3),
        'wayShare': round(sum(r['side'] or r['onCourse'] for r in rows) / k, 3),
        'silentWindowsAt': [r['t'] for r in rows if not (r['side'] or r['onCourse'])],
        'rows': rows,
    }


def check_beacon_cover(d):
    """VL-B4: no silence about the way in a tunnel and the corridor: flown along the track with the nose along it, at
    least 95 % of the one-second windows carry a side (some stem's level difference >= 2 dB) or the on-course hum.
    Control: the lessons' previous versions, without the layer target (the owner's complaint of 2026-11-10 in numbers)."""
    shipped = {p: path_cover(d, p, '') for p in BEACON_PATHS}
    control = {p: path_cover(d, p, '-no-target-layer') for p in BEACON_PATHS}
    ok = all(v['wayShare'] >= BEACON_COVER_MIN for v in shipped.values())
    ctrl_fails = not all(v['wayShare'] >= BEACON_COVER_MIN for v in control.values())
    brief = lambda m: {p: {k: v[k] for k in ('windows', 'sideShare', 'wayShare', 'silentWindowsAt')} for p, v in m.items()}
    return {
        'id': 'VL-B4-cover',
        'claim': 'the corridor and tunnel-wide flown along their track at 2 m/s, nose along the track, every stem but the motor rendered alone: at least 95 % of the one-second windows tell the way, by a side (some stem\'s level difference between the ears at least 2 dB) or by the on-course hum (control: the lessons\' previous versions without the layer target)',
        'thresholds': {'coverMin': {'value': BEACON_COVER_MIN, 'kind': 'task bound'}, 'sideMinDb': {'value': BEACON_SIDE_MIN_DB, 'kind': 'task bound'}, 'soundingDb': {'value': BEACON_SOUNDING_DB, 'kind': 'estimate'}},
        'lessons': {'beacon-corridor': 'corridor v3', 'beacon-tunnel': 'tunnel-wide v2'},
        'measured': brief(shipped),
        'controls': [{'name': 'the previous lesson versions (corridor v2, tunnel-wide v1): the layer target off', 'measured': brief(control), 'ok': ctrl_fails}],
        'detail': {'shipped': {p: v['rows'] for p, v in shipped.items()}},
        'valid': ctrl_fails,
        'pass': ok and ctrl_fails,
    }


def check_beacon_far(d):
    """VL-B5: the target stem in its note's third octave over the motor and the room tone, at 5, 20 and 40 m (target
    30 degrees right), over the hops where the hum's note sounds: at least 6 dB at 40 m. Control: the hum 20 dB down."""
    xt, meta = load(d, 'beacon-ring-soft-solo-target')
    xb, _ = load(d, 'beacon-ring-soft-solo-room-motor')
    far = pose_windows(meta, BEACON_FAR_WIN_S, far=True)

    def margin(gain_db):
        rows = []
        for az, dist, t0, t1 in sorted(far.values(), key=lambda v: v[1]):
            hz = [row['hum']['hz'] for row in meta['truth'] if row.get('hum') and t0 <= row['t'] < t1]
            f = float(np.median(hz))
            mono_t = (xt[:, 0] + xt[:, 1]) * 10 ** (gain_db / 20)
            mono_b = xb[:, 0] + xb[:, 1]
            # the hops (10 ms) where the hum sounds: within 20 dB of its loudest hop in the window
            hops = []
            t = t0
            while t + 0.01 <= t1:
                hops.append((int(t * RATE), int((t + 0.01) * RATE)))
                t += 0.01
            lv = [rms(mono_t[a:b]) for a, b in hops]
            top = max(lv)
            keep = [h for h, v in zip(hops, lv) if v > top * 10 ** (-20 / 20)]
            seg_t = np.concatenate([mono_t[a:b] for a, b in keep])
            seg_b = np.concatenate([xb[a:b, 0] + xb[a:b, 1] for a, b in keep])
            pt = band_power(seg_t, f * 2 ** (-1 / 6.0), f * 2 ** (1 / 6.0))
            pb = band_power(seg_b, f * 2 ** (-1 / 6.0), f * 2 ** (1 / 6.0))
            rows.append({'distM': dist, 'azDeg': az, 'humHz': round(f, 2), 'marginDb': round(10 * math.log10(max(pt, 1e-30) / max(pb, 1e-30)), 2), 'soundingS': round(len(keep) * 0.01, 2)})
        return rows
    shipped = margin(0.0)
    control = margin(-20.0)
    at40 = lambda rows: next(r['marginDb'] for r in rows if r['distM'] == 40)
    ok = at40(shipped) >= BEACON_FAR_MIN_DB
    ctrl_fails = at40(control) < BEACON_FAR_MIN_DB
    return {
        'id': 'VL-B5-far',
        'claim': 'the target hum heard from afar: in the third octave of its note, over the hops where it sounds, the target stem is at least 6 dB over the motor (the default craft at output 0.5) and the room tone at 40 m (also measured at 5 and 20 m) (control: the hum 20 dB down)',
        'thresholds': {'farMinDb': {'value': BEACON_FAR_MIN_DB, 'kind': 'task bound (as the v13 motor margin)'}},
        'measured': {'rows': shipped},
        'controls': [{'name': 'the hum 20 dB down (the target stem scaled before the measure)', 'measured': {'rows': control}, 'ok': ctrl_fails}],
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
    checks.append(check_height_meanings(a.renders))
    checks.append(check_elevation(a.renders))
    checks += [check_beacon_side(a.renders), check_beacon_fold(a.renders), check_beacon_octave(a.renders), check_beacon_cover(a.renders), check_beacon_far(a.renders)]
    versions = {'python': sys.version.split()[0], 'numpy': np.__version__, 'scipy': __import__('scipy').__version__, 'soundfile': sf.__version__, 'pyloudnorm': getattr(pyln, '__version__', '0.2.0')}
    with open(a.out, 'w', encoding='utf8') as f:
        json.dump({'measure': MEASURE_VERSION, 'tools': versions, 'checks': checks}, f, indent=1)
    for c in checks:
        print(f"{c['id']}: {'PASS' if c['pass'] else ('FAIL' if c['valid'] else 'INVALID')}")
    return 0 if all(c['pass'] for c in checks) else 1


if __name__ == '__main__':
    sys.exit(main())
