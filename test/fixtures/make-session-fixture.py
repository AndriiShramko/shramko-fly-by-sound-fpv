#!/usr/bin/env python3
"""Writes the session packages next to this file with Python's own zipfile, gzip, json and hashlib.

They are files written by ANOTHER TOOL: the TypeScript reader must read them although it did not make
them (test/session.test.ts). Nothing here is random, so running the script again gives the same bytes.

  session-python-store.zip    entries stored; raw UTF-8 text; the flight log in two gzip members
  session-python-deflate.zip  entries deflated, written to a stream that cannot seek (so every entry
                              has a data descriptor), JSON with unicode escapes, a zip comment

Run: python test/fixtures/make-session-fixture.py
"""
import gzip
import hashlib
import io
import json
import math
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DATE = (2026, 11, 7, 10, 0, 0)


def frames():
    out = []
    for i in range(60):  # two seconds at 30 Hz
        t = round(i * 1000 / 30)
        y = round(2.5 + 0.1 * math.sin(i / 10), 3)
        out.append({"t": t, "tick": t, "p": [0.0, y, 0.0], "v": [0.0, 0.0, 0.0], "q": [1.0, 0.0, 0.0, 0.0], "s": [0.0, 0.0, 0.0, 0.0], "c": ["height.tone", "room.bed"]})
    return out


def flight_members():
    all_frames = frames()
    members = []
    for chunk in (all_frames[:30], all_frames[30:]):
        text = "".join(json.dumps(f, separators=(",", ":")) + "\n" for f in chunk)
        members.append(gzip.compress(text.encode("utf-8"), mtime=0))
    return b"".join(members)


def events(ensure_ascii):
    rows = [
        {"t": 0, "kind": "session", "what": "start"},
        {"t": 0, "kind": "lesson", "lessonId": "hover-height", "version": 1, "what": "open", "attempt": 0},
        {"t": 0, "kind": "lesson", "lessonId": "hover-height", "version": 1, "what": "intro", "attempt": 0},
        {"t": 10, "kind": "speech", "key": "lesson.hover-height.title", "text": "Zawiśnij na wysokości. Висите на высоте."},
        {"t": 1000, "kind": "lesson", "lessonId": "hover-height", "version": 1, "what": "attempt-start", "attempt": 1},
        {"t": 1500, "kind": "touch", "material": "floor", "speed": 0.4, "pos": [0.0, 0.12, 0.0]},
        {"t": 1800, "kind": "gate", "gateId": "ring-1", "index": 0, "missM": 0.12},
        {"t": 1900, "kind": "answer", "item": "q1", "value": None, "via": "skip"},
        {"t": 2000, "kind": "session", "what": "end"},
    ]
    return "".join(json.dumps(r, separators=(",", ":"), sort_keys=True, ensure_ascii=ensure_ascii) + "\n" for r in rows).encode("utf-8")


def survey():
    doc = {"format": "shramko-sonic-answers/1", "surveyId": "first-flight", "version": 1, "skipped": False,
           "answers": [{"item": "tlx-mental", "value": 4, "via": "key", "t": 2500}, {"item": "open-1", "value": None, "via": "voice", "t": 2600}]}
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def manifest(flight, ev, sv):
    doc = {
        "format": "shramko-sonic-session/1",
        "id": "pyFixtureSession01",
        "created": "2026-11-07T10:00:00Z",
        "ended": "2026-11-07T10:00:03Z",
        "complete": True,
        "app": {"name": "fixture-writer-python", "release": "none", "sonic": "none"},
        "scene": {"kind": "analytic", "id": "open-00000000", "version": 1, "transform": [1, 0, 0, 0]},
        "track": None,
        "lesson": {"id": "hover-height", "version": 1, "path": "full"},
        "theme": {"id": "soft", "version": 1},
        "settings": {"format": "shramko-sonic-prefs/1", "theme": "soft", "calm": False, "heightPolarity": "up-higher", "layerGainDb": {}, "layerPitchSteps": {},
                     "selfVoice": True, "speechRate": 1, "captions": True, "motorSound": False, "path": "full", "listenerFrame": "heading"},
        "assists": {"control": "velocity", "altitude": "hold", "maxSpeedMps": 0.5, "maxClimbMps": 1, "maxYawDps": 60, "autoArm": True, "onTouch": "bump"},
        "device": {"userAgent": "fixture", "locale": "pl", "audio": {"sampleRate": 48000, "baseLatencyMs": 10.5, "outputLatencyMs": None},
                   "input": "keyboard", "inputName": None, "headphones": "wired", "gpu": None},
        "consent": {"recording": True, "voice": False, "send": False, "speechRecognition": False, "minor": False, "guardianConfirmed": None, "at": "2026-11-07T10:00:00Z"},
        "pilot": {"id": "pilotFixture01", "nickname": None},
        "clock": {"startIso": "2026-11-07T10:00:00Z", "frameHz": 30, "voiceOffsetMs": None},
        "files": [
            {"name": "flight.jsonl.gz", "bytes": len(flight), "sha256": sha(flight)},
            {"name": "events.jsonl", "bytes": len(ev), "sha256": sha(ev)},
            {"name": "survey.json", "bytes": len(sv), "sha256": sha(sv)},
        ],
    }
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def entries(ensure_ascii):
    flight, ev, sv = flight_members(), events(ensure_ascii), survey()
    return [("manifest.json", manifest(flight, ev, sv)), ("flight.jsonl.gz", flight), ("events.jsonl", ev), ("survey.json", sv)]


class Unseekable(io.RawIOBase):
    """A write-only stream with no tell or seek: zipfile then writes a data descriptor after each entry."""

    def __init__(self):
        self.buf = bytearray()

    def writable(self):
        return True

    def write(self, b):
        self.buf += b
        return len(b)


def main():
    with zipfile.ZipFile(os.path.join(HERE, "session-python-store.zip"), "w", zipfile.ZIP_STORED) as z:
        for name, data in entries(ensure_ascii=False):
            info = zipfile.ZipInfo(name, DATE)
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, data)
    stream = Unseekable()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as z:
        z.comment = b"written by make-session-fixture.py"
        for name, data in entries(ensure_ascii=True):
            info = zipfile.ZipInfo(name, DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            with z.open(info, "w") as f:
                f.write(data)
    with open(os.path.join(HERE, "session-python-deflate.zip"), "wb") as f:
        f.write(bytes(stream.buf))


if __name__ == "__main__":
    main()
