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


# ------------------------------------------------------------------ the voice-feedback package (tools/analyze.ts)
#
# A scripted two-lesson recording for the analysis tool (lane voice, train 1). Lesson A (rings-first): three failed
# attempts, a repeat key, a touch cluster, two resets 15 s apart, a refused digit, a skipped answer, then a pass on
# the fourth attempt. Lesson B (rings-line): the pilot hovers with the sticks at the centre for 9.5 s and leaves it
# by next-lesson without a pass. Then the first-flight survey with an open item answered by voice. The voice
# recording is NOT a voice: a WebM magic number and zeros (AGENTS.md: never a real recording). What the pilot
# "said" is the hand-written transcript next to it (voice-two-lessons.transcript.json, seconds on the voice clock).
#
#   session-voice-two-lessons.zip   the scripted difficulties
#   session-voice-clean.zip         the same flight without them (every attempt passes, no touch, reset, repeat,
#                                   refused or skipped answer, no hover; B passed before next-lesson)
VOICE_OFFSET_MS = 1500
VOICE_BYTES = bytes([0x1A, 0x45, 0xDF, 0xA3]) + bytes(400)
VOICE_END_MS = 176000
IDLE = (133500, 143000)  # lesson B: the sticks at the centre and no speed


def voice_frames(clean):
    out = []
    for t in range(500, VOICE_END_MS + 1, 100):  # 10 Hz
        idle = (not clean) and IDLE[0] <= t < IDLE[1]
        z = round(-t / 1000.0, 3)
        out.append({"t": t, "tick": t, "p": [0.0, 2.5, z], "v": [0.0, 0.0, 0.0 if idle else -1.0], "q": [1.0, 0.0, 0.0, 0.0],
                    "s": [0.0, 0.0, 0.0, 0.0] if idle else [0.0, 0.0, 0.5, 0.0], "c": ["height.tone", "room.bed"]})
    return out


def voice_flight(clean):
    rows = voice_frames(clean)
    members = []
    for k in range(0, len(rows), 90):
        text = "".join(json.dumps(f, separators=(",", ":")) + "\n" for f in rows[k:k + 90])
        members.append(gzip.compress(text.encode("utf-8"), mtime=0))
    return b"".join(members)


def voice_events(clean):
    A, B = "rings-first", "rings-line"

    def les(t, lid, what, attempt):
        return {"t": t, "kind": "lesson", "lessonId": lid, "version": 1, "what": what, "attempt": attempt}

    def say(t, key, text):
        return {"t": t, "kind": "speech", "key": key, "text": text}

    def key(t, code, action):
        return {"t": t, "kind": "key", "code": code, "action": action}

    def touch(t, speed):
        return {"t": t, "kind": "touch", "material": "wall", "speed": speed, "pos": [0.0, 2.5, round(-t / 1000.0, 3)]}

    rows = [
        {"t": 0, "kind": "session", "what": "start"},
        {"t": 0, "kind": "recording", "what": "start"},
        les(500, A, "open", 0), les(600, A, "intro", 0),
        say(700, "lesson.rings-first.title", "First rings."),
        say(2000, "lesson.rings-first.intro.1", "Listen for the ring."),
        les(5000, A, "attempt-start", 1),
        say(5100, "lesson.rings-first.goal.1", "Fly through the ring."),
    ]
    if clean:
        rows += [les(20000, A, "attempt-pass", 1), les(20000, A, "passed", 1), say(20100, "lesson.rings-first.pass", "Well done.")]
    else:
        rows += [
            les(10000, A, "attempt-fail", 1), say(10100, "lesson.rings-first.retry", "Try again."),
            les(11000, A, "attempt-start", 2),
            key(25000, "KeyZ", "repeat"), say(25100, "lesson.rings-first.goal.1", "Fly through the ring."),
            say(30000, "lesson.rings-first.hint.1", "The hum is the ring."),
            touch(40000, 1.0), touch(42000, 1.2), touch(44000, 2.6),
            les(46000, A, "attempt-fail", 2), say(46100, "lesson.rings-first.retry", "Try again."),
            les(47000, A, "attempt-start", 3),
            key(60000, "KeyR", "reset.start"), {"t": 60010, "kind": "reset", "to": "start", "checkpointId": None},
            say(65000, "lesson.rings-first.intro.2", "Climb a little."),
            key(75000, "KeyC", "reset.checkpoint"), {"t": 75010, "kind": "reset", "to": "checkpoint", "checkpointId": "cp-1"},
            les(90000, A, "attempt-fail", 3), say(90100, "lesson.rings-first.retry", "Try again."),
            say(100000, "lesson.rings-first.intro.3", "Which way is the ring? Press 1 for left, 2 for right."),
            key(102000, "Digit7", "answer.refused"),
            {"t": 115000, "kind": "answer", "item": "ring-side", "value": None, "via": "skip"},
            les(118000, A, "attempt-start", 4),
            les(125000, A, "attempt-pass", 4), les(125000, A, "passed", 4), say(125100, "lesson.rings-first.pass", "Well done."),
        ]
    rows += [
        les(130000, B, "open", 0), les(130100, B, "intro", 0),
        say(130200, "lesson.rings-line.title", "A line of rings."),
        les(133000, B, "attempt-start", 1),
        say(133100, "lesson.rings-line.goal.1", "Fly through the line."),
    ]
    if clean:
        rows += [les(142000, B, "attempt-pass", 1), les(142000, B, "passed", 1), say(142100, "lesson.rings-line.pass", "Well done.")]
    rows += [
        key(143000, "Period", "next-lesson"), les(143500, B, "leave", 1),
        say(145000, "survey.intro.first", "I have a few short questions."),
        say(147000, "survey.item.fun", "How much fun was it?"),
        {"t": 149000, "kind": "answer", "item": "fun", "value": 4, "via": "key"},
        say(151000, "survey.item.helped", "What helped you?"),
        {"t": 170000, "kind": "answer", "item": "helped", "value": None, "via": "voice"},
        say(171000, "survey.item.again", "Would you fly again?"),
        {"t": 172000, "kind": "answer", "item": "again", "value": 1, "via": "key"},
        {"t": 175000, "kind": "recording", "what": "stop"},
        {"t": VOICE_END_MS, "kind": "session", "what": "end"},
    ]
    return "".join(json.dumps(r, separators=(",", ":"), sort_keys=True) + "\n" for r in rows).encode("utf-8")


def voice_survey():
    doc = {"format": "shramko-sonic-answers/1", "surveyId": "first-flight", "version": 1, "skipped": False,
           "answers": [{"item": "fun", "value": 4, "via": "key", "t": 149000}, {"item": "helped", "value": None, "via": "voice", "t": 170000},
                       {"item": "again", "value": 1, "via": "key", "t": 172000}]}
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def voice_manifest(session_id, flight, ev, sv):
    doc = json.loads(manifest(flight, ev, sv).decode("utf-8"))
    doc["id"] = session_id
    doc["ended"] = "2026-11-07T10:02:56Z"
    doc["lesson"] = {"id": "rings-first", "version": 1, "path": "full"}
    doc["device"]["locale"] = "en"
    doc["consent"]["voice"] = True
    doc["pilot"] = {"id": "pilotFixture02", "nickname": "FixtureNick"}
    doc["clock"] = {"startIso": "2026-11-07T10:00:00Z", "frameHz": 10, "voiceOffsetMs": VOICE_OFFSET_MS}
    doc["files"].append({"name": "voice.webm", "bytes": len(VOICE_BYTES), "sha256": sha(VOICE_BYTES)})
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_voice_package(name, session_id, clean):
    flight, ev, sv = voice_flight(clean), voice_events(clean), voice_survey()
    files = [("manifest.json", voice_manifest(session_id, flight, ev, sv)), ("flight.jsonl.gz", flight), ("events.jsonl", ev),
             ("survey.json", sv), ("voice.webm", VOICE_BYTES)]
    with zipfile.ZipFile(os.path.join(HERE, name), "w", zipfile.ZIP_DEFLATED) as z:
        for fname, data in files:
            info = zipfile.ZipInfo(fname, DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)


def main():
    write_voice_package("session-voice-two-lessons.zip", "pyVoiceTwoLessons01", clean=False)
    write_voice_package("session-voice-clean.zip", "pyVoiceCleanFlight01", clean=True)
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
