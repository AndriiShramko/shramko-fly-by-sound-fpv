"""What Whisper hears in a list of speech clips: the transcriber of the words check (`pnpm listen:words`,
tools/listen-words.ts; docs/design/virtual-listener.md, VL-4: "Whisper finds every word of the caption").

Each clip (a WAV file of one spoken line, any rate) is transcribed by Whisper large-v3 (faster-whisper on CTranslate2, on
the GPU in float16) in the clip's own language, as one 30-second window: beam search of 5 at temperature 0, no
timestamps, nothing carried over from one clip to the next, the same no-speech rule as faster-whisper's transcribe()
(no-speech probability over 0.6 with an average log probability of -1 or less: nothing heard). Clips of one language are
decoded in batches; --check transcribes the first clips again one by one with faster-whisper's own transcribe() and the
same options, and fails if a single text differs. The caller holds the GPU lock.

    python -X utf8 tools/listen/words.py --items <items.json> --model <dir> --out <heard.json> [--batch 16] [--check 40]
    python -X utf8 tools/listen/words.py --describe      (the decoder's settings and the tools' versions, as JSON)

items.json: [{"id": "...", "lang": "ru", "wav": "<path>"}, ...] (UTF-8). The model directory is fetched from the Hugging
Face Hub (Systran/faster-whisper-large-v3 at the pinned revision) when it holds no model.bin. heard.json:
{"tools": {...}, "decode": {...}, "items": [{"id", "hyp", "seconds"}], "checked": n}.
"""
import argparse
import json
import math
import os
import sys
import time
from collections import OrderedDict

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

MODEL_ID = 'Systran/faster-whisper-large-v3'
REVISION = 'edaa852ec7e145841d8ffdb056a99866b5f0a478'
RATE = 16000
BEAM = 5
NO_SPEECH_PROB = 0.6
LOG_PROB = -1.0
DECODE = {
    'model': MODEL_ID,
    'revision': REVISION,
    'device': 'cuda',
    'computeType': 'float16',
    'beamSize': BEAM,
    'temperature': 0.0,
    'timestamps': False,
    'conditionOnPreviousText': False,
    'vad': False,
    'noSpeech': {'probAbove': NO_SPEECH_PROB, 'avgLogProbBelow': LOG_PROB},
    'window': 'one 30 s window per clip'
}


def load16(path):
    """The clip as mono float32 at 16 kHz."""
    x, fs = sf.read(path, dtype='float32', always_2d=True)
    x = x.mean(axis=1)
    if fs != RATE:
        g = math.gcd(int(fs), RATE)
        x = resample_poly(x, RATE // g, int(fs) // g)
    return np.asarray(x, dtype=np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items')
    ap.add_argument('--model')
    ap.add_argument('--out')
    ap.add_argument('--batch', type=int, default=16)
    ap.add_argument('--check', type=int, default=0, help='transcribe this many clips again with transcribe() and compare')
    ap.add_argument('--describe', action='store_true')
    a = ap.parse_args()

    import ctranslate2
    import faster_whisper
    from faster_whisper import WhisperModel, download_model
    from faster_whisper.audio import pad_or_trim
    from faster_whisper.tokenizer import Tokenizer
    from faster_whisper.transcribe import get_suppressed_tokens

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

    groups = OrderedDict()
    for it in items:
        groups.setdefault(it['lang'], []).append(it)
    out = {}
    t1 = time.time()
    for lang, group in groups.items():
        tok = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task='transcribe', language=lang)
        prompt = model.get_prompt(tok, [], without_timestamps=True)
        suppress = list(get_suppressed_tokens(tok, [-1]))
        for b in range(0, len(group), a.batch):
            batch = group[b:b + a.batch]
            feats, live, seconds = [], [], []
            for it in batch:
                audio = load16(it['wav'])
                seconds.append(len(audio) / RATE)
                if len(audio) > 30 * RATE:
                    sys.exit(f'words: {it["id"]} is {len(audio) / RATE:.1f} s, longer than one window')
                f = model.feature_extractor(audio)
                content = f.shape[-1] - 1
                if content <= 0:
                    live.append(False)
                    continue
                live.append(True)
                feats.append(pad_or_trim(f[:, :min(content, model.feature_extractor.nb_max_frames)]))
            texts = []
            if feats:
                enc = model.encode(np.stack(feats))
                res = model.model.generate(enc, [list(prompt) for _ in feats], beam_size=BEAM, patience=1, length_penalty=1, repetition_penalty=1, no_repeat_ngram_size=0, max_length=model.max_length, return_scores=True, return_no_speech_prob=True, suppress_blank=True, suppress_tokens=suppress)
                for r in res:
                    tokens = r.sequences_ids[0]
                    avg_logprob = r.scores[0] * len(tokens) / (len(tokens) + 1)
                    if r.no_speech_prob > NO_SPEECH_PROB and not avg_logprob > LOG_PROB:
                        texts.append('')
                    else:
                        texts.append(tok.decode(tokens).strip())
            k = 0
            for it, is_live, s in zip(batch, live, seconds):
                hyp = ''
                if is_live:
                    hyp = texts[k]
                    k += 1
                out[it['id']] = {'id': it['id'], 'hyp': hyp, 'seconds': round(s, 3)}
            print(f'words: {lang} {min(b + a.batch, len(group))} of {len(group)} ({time.time() - t1:.0f} s)', flush=True)

    checked = 0
    if a.check > 0:
        for it in items[:a.check]:
            audio = load16(it['wav'])
            segs, _ = model.transcribe(audio, language=it['lang'], beam_size=BEAM, temperature=0.0, condition_on_previous_text=False, vad_filter=False, without_timestamps=True)
            ref = ' '.join(s.text.strip() for s in segs).strip()
            if ref != out[it['id']]['hyp']:
                sys.exit(f'words: the batched decoder heard {out[it["id"]]["hyp"]!r} in {it["id"]}, transcribe() {ref!r}')
            checked += 1
        print(f'words: {checked} clips heard the same by transcribe() one by one', flush=True)

    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'tools': tools, 'decode': DECODE, 'items': [out[it['id']] for it in items], 'checked': checked}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'words: {len(items)} clips in {time.time() - t1:.0f} s', flush=True)


if __name__ == '__main__':
    main()
