"""How loud the local Windows voices speak, per voice and utterance volume (review M4): reads the WAVs that
tts/voice-levels.ps1 wrote (<category>_<voice>__<volume>__<line>.wav), joins each voice's lines at one volume,
and prints its integrated loudness (BS.1770, pyloudnorm) and true peak, and its loudness against the voice the
themes' voice volume was set on (SAPI desktop David, volume 100). What this cannot show: the network voices
Chrome offers when it is online (they cannot be captured from here), and how loud a person sets the headphones.

    python -X utf8 tools/listen/measure-voices.py --wav <dir> [--ref desktop_Microsoft-David-Desktop-English-United-States]
"""
import argparse
import collections
import json
import math
import os
import re

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly


def true_peak_dbtp(x):
    up = resample_poly(x.astype(np.float64), 4, 1)
    return 20.0 * math.log10(max(float(np.max(np.abs(up))), 1e-12))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', required=True)
    ap.add_argument('--ref', default='desktop_Microsoft-David-Desktop-English-United-States')
    a = ap.parse_args()
    groups = collections.defaultdict(list)
    rate = None
    for name in sorted(os.listdir(a.wav)):
        m = re.match(r'(.+)__(\d+)__(.+)\.wav$', name)
        if m is None:
            continue
        x, fs = sf.read(os.path.join(a.wav, name), dtype='float32', always_2d=True)
        rate = rate or fs
        assert fs == rate, (name, fs)
        groups[(m.group(1), int(m.group(2)))].append(x[:, 0])
    meter = pyln.Meter(rate)
    rows = {}
    for (voice, vol), parts in sorted(groups.items()):
        joined = np.concatenate(parts + [np.zeros(int(0.5 * rate))])
        lufs = float(meter.integrated_loudness(np.stack([joined, joined], axis=1).astype(np.float64)))
        rows.setdefault(voice, {})[vol] = {'lufs': round(lufs, 2), 'truePeakDbtp': round(true_peak_dbtp(joined), 2)}
    ref = rows.get(a.ref, {}).get(100, {}).get('lufs')
    out = {'reference': a.ref, 'voices': {}}
    for voice, by_vol in rows.items():
        out['voices'][voice] = {str(v): {**r, 'againstReferenceLu': None if ref is None else round(r['lufs'] - ref, 2), 'againstOwn100Lu': round(r['lufs'] - by_vol[100]['lufs'], 2) if 100 in by_vol else None} for v, r in sorted(by_vol.items(), reverse=True)}
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
