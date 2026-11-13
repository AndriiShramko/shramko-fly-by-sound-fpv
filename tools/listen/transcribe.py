"""What a pilot said in a Fly by Sound recording: voice.webm of a recording package to transcript.json, on this machine
only (tools/analyze.ts runs it; design: ShramkoGSFPV docs/wip/voice-feedback-plan.md 5.2 step 2).

The audio (WebM / Opus as the browser's MediaRecorder writes it, or any file PyAV reads) is decoded with PyAV to 16 kHz
mono and transcribed by Whisper large-v3 (faster-whisper on CTranslate2, CUDA float16) at the SAME pinned revision as
the words check (tools/listen/words.py): beam 5, temperature 0, nothing carried over from one window to the next, the
voice-activity filter on (a recording is mostly silence and the simulator's sound), word timestamps on. Offline:
HF_HUB_OFFLINE=1 is set before the model library loads, and the script stops with exit code 3 when the model directory
holds no model.bin; it NEVER downloads (a recording holds a person's voice; nothing of it leaves the machine).

The language is the package's (manifest.device.locale, two letters); 'auto' lets Whisper detect it, and a given
language is replaced by the detected one when Whisper is at least LANG_SWITCH sure of another.

Dropped (kept in the output under "dropped" with the reason): a segment Whisper itself takes for no speech (its own
defaults: no_speech_prob over NO_SPEECH and avg_logprob under LOGPROB), and a segment whose whole text is a known
silence hallucination of its language (tools/feedback/hallucinations.json).

    python -X utf8 tools/listen/transcribe.py --audio <voice.webm> --model <dir> --out <transcript.json>
                   [--lang en|es|pl|ru|auto] [--hallucinations tools/feedback/hallucinations.json]
    python -X utf8 tools/listen/transcribe.py --filter <raw.json> --out <x.json> [--lang ..] [--hallucinations ..]
        (only the drop rules on a list of raw segments, no model: for the tests)
    python -X utf8 tools/listen/transcribe.py --describe

transcript.json: {"format", "model", "revision", "language", "languageProbability", "requestedLanguage", "audioSeconds",
"decode", "tools", "segments": [{"start", "end", "text", "noSpeechProb", "avgLogprob", "words": [{"start", "end",
"word", "probability"}]}], "dropped": [{"start", "end", "text", "reason"}]}: seconds of the audio, the shape
parseTranscript of tools/report.ts reads. Exit codes: 0 done, 2 wrong use, 3 the model is not in the cache, 4 the
audio cannot be decoded.
"""
import argparse
import json
import os
import re
import sys
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

FORMAT = 'shramko-voice-transcript/1'
MODEL_ID = 'Systran/faster-whisper-large-v3'
REVISION = 'edaa852ec7e145841d8ffdb056a99866b5f0a478'  # the revision of tools/listen/words.py
RATE = 16000
OPTIONS = {'beam_size': 5, 'temperature': 0.0, 'condition_on_previous_text': False, 'vad_filter': True, 'word_timestamps': True}
# Whisper's own no-speech rule (openai-whisper transcribe(): no_speech_threshold 0.6, logprob_threshold -1.0); not
# measured on this project's recordings (estimate)
NO_SPEECH = 0.6
LOGPROB = -1.0
# a given language gives way to the detected one at this probability (estimate)
LANG_SWITCH = 0.9
LANGS = ('en', 'es', 'pl', 'ru')
DECODE = {
    'model': MODEL_ID,
    'revision': REVISION,
    'device': 'cuda',
    'computeType': 'float16',
    'call': 'WhisperModel.transcribe, the whole recording, in the package language',
    'options': {'beamSize': 5, 'temperature': 0.0, 'conditionOnPreviousText': False, 'vad': True, 'wordTimestamps': True},
    'drop': {'noSpeechProb': NO_SPEECH, 'avgLogprob': LOGPROB, 'langSwitch': LANG_SWITCH}
}


def norm(text):
    """Lower case, the letter yo as ye, every run of non-letters one space."""
    t = text.lower().replace('ё', 'е')
    return re.sub(r'[\W_]+', ' ', t).strip()


def load_hallucinations(path):
    if path is None or not os.path.exists(path):
        return {}
    doc = json.load(open(path, encoding='utf-8'))
    return {k: [norm(x[:-1]) + '*' if x.endswith('*') else norm(x) for x in v] for k, v in doc.items() if isinstance(v, list)}


def hallucination(text, phrases):
    t = norm(text)
    for p in phrases:
        if (p.endswith('*') and t.startswith(p[:-1])) or t == p:
            return True
    return False


def keep_or_drop(segments, lang, table):
    """The drop rules: (kept, dropped)."""
    phrases = table.get(lang, []) + ([] if lang == 'en' else table.get('en', []))
    kept, dropped = [], []
    for s in segments:
        reason = None
        if s['text'].strip() == '':
            reason = 'empty'
        elif s.get('noSpeechProb', 0.0) > NO_SPEECH and s.get('avgLogprob', 0.0) < LOGPROB:
            reason = 'no speech'
        elif hallucination(s['text'], phrases):
            reason = 'hallucination'
        if reason is None:
            kept.append(s)
        else:
            dropped.append({'start': s['start'], 'end': s['end'], 'text': s['text'], 'reason': reason})
    return kept, dropped


def write(path, doc):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--audio')
    ap.add_argument('--model')
    ap.add_argument('--out')
    ap.add_argument('--lang', default='auto')
    ap.add_argument('--hallucinations')
    ap.add_argument('--filter')
    ap.add_argument('--describe', action='store_true')
    a = ap.parse_args()
    lang = a.lang.lower()[:2] if a.lang.lower()[:2] in LANGS else None
    table = load_hallucinations(a.hallucinations)

    if a.filter is not None:
        if a.out is None:
            ap.error('--filter needs --out')
        raw = json.load(open(a.filter, encoding='utf-8'))
        kept, dropped = keep_or_drop(raw['segments'], lang or 'en', table)
        write(a.out, {'format': FORMAT, 'language': lang, 'segments': kept, 'dropped': dropped})
        return 0

    if not a.describe:
        if a.audio is None or a.model is None or a.out is None:
            ap.error('--audio, --model and --out are needed')
        # before any model library loads: never fetch the model
        if not os.path.exists(os.path.join(a.model, 'model.bin')):
            print(f'transcribe: the model {MODEL_ID} at {REVISION[:7]} is not in the cache ({a.model}); nothing was downloaded. '
                  'Fetch it once as the words check does (pnpm listen:words) or set SHRAMKO_LISTEN_CACHE.', file=sys.stderr)
            return 3

    import ctranslate2
    import faster_whisper
    import numpy as np
    from faster_whisper import WhisperModel, decode_audio

    tools = {'python': sys.version.split()[0], 'faster-whisper': faster_whisper.__version__, 'ctranslate2': ctranslate2.__version__, 'numpy': np.__version__}
    try:
        import av
        tools['av'] = av.__version__
    except ImportError:
        pass
    if a.describe:
        print(json.dumps({'decode': DECODE, 'tools': tools}))
        return 0

    try:
        audio = decode_audio(a.audio, sampling_rate=RATE)
    except Exception as e:  # PyAV raises its own error classes
        print(f'transcribe: cannot decode {a.audio}: {e}', file=sys.stderr)
        return 4
    seconds = round(len(audio) / RATE, 3)
    t0 = time.time()
    model = WhisperModel(a.model, device='cuda', compute_type='float16')
    print(f'transcribe: model loaded in {time.time() - t0:.1f} s; {seconds} s of audio', flush=True)

    detected, prob = None, None
    if len(audio) > 0:
        detected, prob, _ = model.detect_language(audio, vad_filter=True)
    use = lang
    if use is None or (detected is not None and detected != use and prob is not None and prob >= LANG_SWITCH):
        use = detected
    segments = []
    if len(audio) > 0:
        segs, info = model.transcribe(audio, language=use, **OPTIONS)
        for s in segs:
            segments.append({
                'start': round(s.start, 3), 'end': round(s.end, 3), 'text': s.text.strip(),
                'noSpeechProb': round(s.no_speech_prob, 4), 'avgLogprob': round(s.avg_logprob, 4),
                'words': [{'start': round(w.start, 3), 'end': round(w.end, 3), 'word': w.word.strip(), 'probability': round(w.probability, 4)} for w in (s.words or [])]
            })
        use = info.language
    kept, dropped = keep_or_drop(segments, use or 'en', table)
    write(a.out, {'format': FORMAT, 'model': MODEL_ID, 'revision': REVISION, 'language': use,
                  'languageProbability': None if prob is None else round(prob, 4), 'requestedLanguage': lang or 'auto',
                  'audioSeconds': seconds, 'decode': DECODE, 'tools': tools, 'segments': kept, 'dropped': dropped})
    print(f'transcribe: {len(kept)} segments, {len(dropped)} dropped, language {use}, in {time.time() - t0:.0f} s', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
