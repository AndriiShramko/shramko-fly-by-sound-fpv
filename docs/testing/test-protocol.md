# Test protocol: first-time and returning testers

How to test Fly by Sound with people, what to measure, and what to do with it. The sound design is a set of hypotheses (one pentatonic scale, roughness for "off course", pitch for height, a hybrid of voice and non-speech sound), and an agent cannot judge how a sound feels: this protocol is how the owner's ears and later blind testers decide. The evidence behind the choices is in [research 01](../research/01-spatial-audio-on-headphones.md), [research 02](../research/02-sensory-substitution-and-training.md) and the [specification](../design/stage-1-spec.md). Consent and data rules are in [consent-template.md](consent-template.md) (a template, not legal advice); loudness is in [school-loudness-sheet.md](school-loudness-sheet.md).

Nothing here claims therapy or medical benefit. This is a game that people choose to play, and the protocol measures whether they enjoy it, learn it and come back.

## 1. What we want to learn

| Question | Where the answer comes from |
|---|---|
| Can a person who cannot see learn to fly the first lessons by ear, and in how many sessions and minutes? | lesson events: attempts, passes, time to the first pass |
| Does the short path (about six lessons) bring people to the first ring faster than the full ladder? (The ladder's order rests on thin evidence; the package records which path was used.) | `manifest.lesson.path`, time and attempts to the first `rings-first` pass |
| Which sounds helped and which annoyed? Which do pilots switch off or turn down? | spoken survey (open answers by voice), the settings in the manifest |
| Is "up = higher" the natural polarity, or do some pilots flip it? | survey item `up-direction`, `heightPolarity` in the settings, the module-0 game |
| Can front and back be told apart with the scene yawing at once with the stick? | the module-0 headphone check and game answers, and the recording of what the pilot says |
| Is it comfortable: ear fatigue, loudness, fear of crashing? | survey items `ears-tired`, `fear`, sessions stopped early |
| Do they come back without being asked? | the `came-back` survey item, and sessions that begin without an invitation |
| Do children find it fun (a game, not a lesson)? | child survey (Again-Again), the helper's notes |

## 2. Who, and how many

- **First-time testers** have never used the sound mode. **Returning testers** have had at least one earlier session.
- Keep these groups apart in the analysis: blind, low vision, sighted with eyes closed or a blindfold, adults, children. Do not average them together.
- Pilot size: 6 to 10 people per group. The median in accessibility studies with disabled participants is 13, and the closest earlier system (Sound of Vision) reported six users, one of whom progressed slowly and one who found it intuitive: **report each person's learning curve, not only means** (research 02, section 8).
- People under 18 need the signed consent of a parent or guardian, which the helper confirms in the app, and the child's own assent (the consent template, parts A2 and A3). Without them: no recording, no sending, and for a child no test.

## 3. Roles

- **Tester**: the pilot.
- **Helper**: a sighted adult who sits beside the tester, reads the script, calibrates a radio once if there is one, and writes the observer's notes (section 9). The helper does not fly and does not hint during a flight unless the tester asks for help or something is unsafe. For children, the helper is a parent or teacher who also listens, or flies on a second controller in a second session.
- **Data person**: the one who generates the reports and keeps the signed forms apart from the data.

## 4. Setup checklist (every session)

1. **Headphones:** wired, closed-back, circumaural, one identical model per room, left and right matched. Bluetooth adds 180 to 250 ms and breaks the stick-to-ear loop: not allowed.
2. **Operating system:** spatial sound switched off (Windows Sonic, Dolby Atmos, DTS Headphone:X, "virtual surround", bass boost, loudness equalisation). The app spatialises already, and the system must not do it a second time.
3. **Volume:** set as in the school loudness sheet (75 dBA reference for children, 80 dBA for adults). At home, an adult sets it by the relative method on the sheet. Start low; never raise it during a flight.
4. **Browser:** a current Chrome or Edge, one tab, the page in the foreground (a hidden tab pauses). Microphone and speech recognition stay off unless the consent says yes.
5. **Consent:** signed forms exist with the school or controller for everyone under 18. The helper answers the consent questions in the app truthfully (recording, voice, sending, speech recognition, minor, guardian confirmed).
6. **Identity:** a card with a random participant code. No names in file names, notes or chat. A nickname only if the tester wants one.
7. **Room:** quiet, no one speaking nearby (the voice is recorded only if consent says so). Water, a chair that is not a spinning one, a break planned.
8. **Input:** keyboard, game controller or radio. A radio is calibrated once by the helper before the tester arrives.
9. **Say aloud before starting:** it is a game; if the sound is too loud or tiring, say stop; nothing is wrong if you hit a wall, it is a soft bump.

## 5. First-time session (about 30 minutes; children 10 to 15 minutes at a time)

| Minutes | What | Notes |
|---|---|---|
| 0 to 3 | Welcome, the helper reads the information in plain words, checks consent and assent, hands over the participant code. | Ask permission to record, separately for flight log, voice and sending. |
| 3 to 6 | **Module 0, headphone check** (lesson `ears-headphones`): left, right, behind. | If left and right are swapped or unclear, fix the headphones before going on. |
| 6 to 10 | **Glossary** (`ears-glossary`): each sound named by voice and previewed. Ask which direction they expect "up" to be, and set the polarity. Then the ears game (`ears-game`) once. | Record polarity choice and whether it stays the same in the game. |
| 10 to 25 | **Flying**, on the assigned path: alternate the first-time testers between the **full** path (hover, move and stop, walls, corridor, rings) and the **fast** path (hover, walls, corridor, rings), and write which. | Let them choose to repeat a lesson. Offer a short break at 15 minutes. |
| 25 to 30 | **Survey** (first flight: 9 items, spoken, number keys, any item can be skipped), then two minutes of talk: what helped, what annoyed, what would make you come back. | For children use the child variant (6 items, Again-Again). |

Stop early if the tester asks, shows discomfort or fatigue, if the helper judges the sound too loud, or when a child reaches 30 minutes in one sitting.

## 6. Returning session (about 20 to 25 minutes)

| Minutes | What |
|---|---|
| 0 to 2 | Welcome back, a reminder that they can stop at any time, confirm consent still stands. Do not give a hint about what changed. |
| 2 to 5 | Warm-up: free flight in the lesson they last passed. |
| 5 to 18 | The next lessons on their path until a stopping point of their own, or the course set for the study. |
| 18 to 22 | **Transfer task:** a course they never practised (another rings seed, or `rings-small`, or the Winter Garden lesson). This is the measure of whether they learned the skill and not one track. |
| 22 to 25 | **Survey** (returning pilot: 10 items), including whether they switched cues off or changed the volume, and the final open questions. |

A returning tester who starts a session **without being invited** is recorded as "came back unprompted": the best measurable proxy for abandonment (research 02, section 8).

## 7. What is measured

Everything below that comes from the package is produced by the report tool: `pnpm report <package.zip> [--transcript voice.json]` gives the timeline and the numbers as Markdown or JSON (`--format json`), and its replay-check line says whether the recording holds together (an invalid recording is excluded). The simulator's own events are the source, so nothing is typed in by hand.

| Metric | Definition | Source |
|---|---|---|
| Pass | the lesson's `passed` event exists | report: outcome |
| Attempts to pass, sessions to pass | number of `attempt-start` events before `passed`; sessions between the first attempt and the pass | report: attempts, per session |
| Time to pass | session-clock time from `open` to `passed`; and the duration of each attempt | report: attempts |
| Touches | `touch` events, per attempt and per minute of flight | report: metrics.touches, attempts |
| Gate pass rate | gates passed in order over the gates of the course, per attempt | report: gates |
| Per-gate and per-leg times | time from the attempt start (or the previous gate) to each gate | report: gates |
| Path deviation | distance of the flown path from the polyline through the gates: mean, 95th percentile, largest | report: metrics.deviationM |
| Resets and skips | `reset` events, the N key used to skip speech, the Z key used to repeat | report: timeline |
| Transfer | success on the transfer task of the returning session | report, second session |
| Path comparison | minutes and attempts to the first `rings-first` pass, fast against full | report: lesson path |
| Polarity | the chosen height polarity, and whether the module-0 game answers about up and down are consistent in 8 of 10 trials | manifest settings, answers |
| Front and back | right answers to "behind" in the headphone check and the game | answers |
| Fun | survey `fun` 1 to 5 (child: `child-fun` and the Again-Again items) | survey.json |
| Workload | survey scales 0 to 9 (mental, temporal, performance, effort, frustration), converted to 0 to 100 as value times 100 over 9, unweighted | survey.json |
| Comfort | `ears-tired`, `fear`, the child's `child-scary`, sessions stopped early and why | survey, helper's notes |
| Return | `came-back` and unprompted sessions | survey, session log |
| What helped, what annoyed | open answers by voice | transcript joined to the timeline |

**Targets are not findings.** Before the pilot, write down a falsifiable target for each group in advance. The research's placeholder for the short path: 70 % of rings passed by the third session of about 20 minutes (a placeholder to be argued with, not a result). The pass rules inside the lessons (for example "4 of 5 attempts in the band", "8 of 10 rings") are starting values for this pilot too.

## 8. Data handling

1. The session is recorded locally first. Sending needs its own confirmation by the tester (or the helper for a child), and the app says "delivered" only when both the e-mail and the Telegram channel confirm.
2. Generate the report from the package on the data person's computer. A transcript of a voice recording is personal data: keep it with the package and never publish it.
3. Names stay with the school. Packages and reports carry only the random participant code and the session id.
4. Packages are kept while the project runs and at most five years, and are deleted earlier on request (a parent, a child or the tester quotes the participant code).
5. Publish only anonymous aggregates and individual learning curves without any identifying detail, under CC BY 4.0. Say how many testers there were, who they were in broad terms, and what went wrong.
6. If the tester or a parent withdraws, delete the package and its report and say so in writing.

## 9. Observer's notes (copy this table per session)

| Field | Entry |
|---|---|
| Participant code | |
| Date, room | |
| Group (first-time or returning; blind, low vision, sighted with eyes closed; adult or child) | |
| Path assigned (full or fast) | |
| Headphones model, OS volume, loudness sheet checked (yes or no) | |
| Consent confirmed in the app (recording, voice, send, speech recognition, minor, guardian) | |
| Polarity chosen at the glossary | |
| Where they hesitated or asked for help (time on the session clock if the package is not yet read) | |
| Words they used for the sounds | |
| Signs of tiredness, discomfort, fear | |
| Stopped early? Why | |
| What the tester asked for that the game does not have | |
| Anything the helper did that could have changed the result (a hint, a repeated instruction) | |

## 10. Safety and stopping rules

- The limiter caps the output at -6 dBFS and the volume is calibrated to 75 dBA (children) or 80 dBA (adults) as the loudness sheet says. The page cannot measure sound pressure, so the calibration is the safeguard, not the limiter alone. Speech is made by the browser's voice and does not pass the limiter: measure it too.
- Children: bursts of 10 to 15 minutes with a break, at most about 30 minutes in one sitting (the research found no study that gives an optimal length: this is a proposal to be tested).
- Stop at any request and at any sign of discomfort, ear pain, headache or distress. The helper says so out loud, and nobody asks twice for a reason.
- A crash is a soft bump with no fail screen. If a tester is upset by a bump, the helper explains once and offers the calm preset (quieter, slower, less rough, duller) from the settings.
- Never present the game as a treatment, and never promise a benefit.
