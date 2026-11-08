"""What Whisper hears in a list of speech clips: the transcriber of the words check (`pnpm listen:words`,
tools/listen-words.ts; docs/design/virtual-listener.md, VL-4: "Whisper finds every word of the caption").

Each clip (a WAV file of one spoken line, any rate) is transcribed by Whisper large-v3 (faster-whisper on CTranslate2, on
the GPU in float16) in the clip's own language with faster-whisper's own transcribe(), as the design's speech probe ran
it: beam search of 5 at temperature 0, with timestamps (a window that stops early is decoded on from its last
timestamp), nothing carried over from one clip to the next, no voice-activity filter. The caller holds the GPU lock.

    python -X utf8 tools/listen/words.py --items <items.json> --model <dir> --out <heard.json>
    python -X utf8 tools/listen/words.py --describe      (the decoder's settings and the tools' versions, as JSON)

items.json: [{"id": "...", "lang": "ru", "wav": "<path>"}, ...] (UTF-8). The model directory is fetched from the Hugging
Face Hub (Systran/faster-whisper-large-v3 at the pinned revision) when it holds no model.bin. heard.json:
{"tools": {...}, "decode": {...}, "items": [{"id", "hyp", "seconds"}]}.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

MODEL_ID = 'Systran/faster-whisper-large-v3'
REVISION = 'edaa852ec7e145841d8ffdb056a99866b5f0a478'
RATE = 16000
OPTIONS = {'beam_size': 5, 'temperature': 0.0, 'condition_on_previous_text': False, 'vad_filter': False}
DECODE = {
    'model': MODEL_ID,
    'revision': REVISION,
    'device': 'cuda',
    'computeType': 'float16',
    'call': 'WhisperModel.transcribe, one clip at a time, in the clip\'s language',
    'options': {'beamSize': 5, 'temperature': 0.0, 'timestamps': True, 'conditionOnPreviousText': False, 'vad': False}
}


def load16(path):
    """The clip as mono float32 at 16 kHz."""
    x, fs = sf.read(path, dtype='float32', always_2d=True)
    x = x.mean(axis=1)
    if fs != RATE and len(x) > 0:
        g = math.gcd(int(fs), RATE)
        x = resample_poly(x, RATE // g, int(fs) // g)
    return np.asarray(x, dtype=np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items')
    ap.add_argument('--model')
    ap.add_argument('--out')
    ap.add_argument('--describe', action='store_true')
    a = ap.parse_args()

    import ctranslate2
    import faster_whisper
    from faster_whisper import WhisperModel, download_model

    tools = {'python': sys.version.split()[0], 'faster-whisper': faster_whisper.__version__, 'ctranslate2': ctranslate2.__version__, 'numpy': np.__version__}
    if a.describe:
        print(json.dumps({'decode': DECODE, 'tools': tools}))
        return
    if a.items is None or a.model is None or a.out is None:
        ap.error('--items, --model and --out are needed')
    items = json.load(open(a.items, encoding='utf-8'))
    if not os.path.exists(os.path.join(a.model, 'model.bin')):
        print(f'words: fetching {MODEL_ID} at {REVISION[:7]} into {a.model}', flush=True)
        download_model('large-v3', output_dir=a.model, revision=REVISION)
    t0 = time.time()
    model = WhisperModel(a.model, device='cuda', compute_type='float16')
    print(f'words: model loaded in {time.time() - t0:.1f} s', flush=True)

    out = []
    t1 = time.time()
    for i, it in enumerate(items):
        audio = load16(it['wav'])
        hyp = ''
        if len(audio) > 0:
            segs, _ = model.transcribe(audio, language=it['lang'], **OPTIONS)
            hyp = ' '.join(s.text.strip() for s in segs).strip()
        out.append({'id': it['id'], 'hyp': hyp, 'seconds': round(len(audio) / RATE, 3)})
        if (i + 1) % 100 == 0:
            print(f'words: {i + 1} of {len(items)} ({time.time() - t1:.0f} s)', flush=True)

    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'tools': tools, 'decode': DECODE, 'items': out}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'words: {len(items)} clips in {time.time() - t1:.0f} s', flush=True)


if __name__ == '__main__':
    main()
