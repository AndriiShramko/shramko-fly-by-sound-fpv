# Virtual listener: design

Status: design, 2026-11-08, nothing built yet. Written from the engine code (`src/` as of 7d4b4b9, the same as 1eea4d5), the audio proofs (`test-audio/`), the simulator's Fly by Sound host and bench (ShramkoGSFPV `apps/fly/src/sonic*`, `tools/bench/src/sonic-*.ts`) and two research probes run on the build machine on 2026-11-08 (spatial hearing; musicality, intelligibility and loudness). Requirements R10 to R13 and R19 are the owner's (spec section 2 and 3 carry them).

The owner asked for a way to test the sound without sending unfinished builds to people: the machine should judge the sound the way a person would, fix what fails, and only then hand a working build to testers. This document is that machine.

## 0. In one page

- **What.** Software that takes the exact binaural signal the engine sends to the headphones (rendered offline in headless Chrome: sample for sample what reaches the ears) and predicts what a person would perceive: where each sound is; whether an important cue is audible in the mix; whether two cues can be told apart; whether speech is understood over the sound; whether it is music or cacophony; whether an hour of it is comfortable and safe; whether it carries enough information to fly.
- **How.** A render rig in this repository (TypeScript, MIT) writes the mix, per-layer stems and per-frame ground truth for every lesson and theme. A Python tool, the Shramko Virtual Listener (`tools/listen/`, MIT), measures them with published models of hearing. A panel of virtual heads from open HRTF datasets stands in for listeners. A bot flies the lessons from the sound alone and is compared with a bot that sees the true state.
- **Rule.** A metric is trusted only when it separates its controls: a positive control that must pass and a negative control (an engine or mix broken on purpose) that must fail, with the threshold between them. A metric that cannot do that is dropped. Two already were: MoSQITo's ECMA-418-2 roughness (consonant chords 0.78, a rough tone cloud 0.76) and AMT's `baumgartner2021` externalization (a flat diotic signal scored 0.58, above Chrome's HRTF at 0.32, yet people hear it inside the head).
- **Gate.** A build goes to people only when every blocking test of the full tier passes (section 11). People then calibrate the thresholds marked "proposal"; they do not hunt bugs.
- **Hardware.** None needed (section 10).
- **Already found without people (probes, 2026-11-08):**
  1. Speech is 11 to 14 LU louder than a flight (Windows OneCore voice -16.6 LUFS against -27.7, -28.4 and -30.3 LUFS for clear, race and soft) and peaks at -0.17 dBTP, outside the -6 dBFS limiter.
  2. Left and right with Chrome's HRTF are as good as with one's own ears (lateral error +1.3 degrees, panel median). Front/back and up/down are not: quadrant errors 29 % (`baumgartner2014`) and 37 % (`bayesian_listener`) against 12 % and 20 % with own ears; 25 of 26 heads above 20 %.
  3. A cue whose high band is a 2 to 6 kHz "breath of air" gives 38 % quadrant errors even with the listener's own ears. Anything that relies on the HRTF for height or front/back needs energy up to about 16 kHz.
  4. Chrome clamps elevation above 45 degrees at most azimuths (`kMaxElevations`), so height above that is carried by pitch or not at all.
  5. The engine's intended roughness (height out of band, off-course beating) is higher than the cacophony control, so roughness must be measured per stem and with the codes switched off.
  6. Doppler up to +-60 cents makes a fifth 2.6 times more dissonant (Sethares) on paper. Whether that is heard in the mix is open.
  7. Pop-outs of 6 to 8 LU over the previous 3 s, and a roughness p95 of 1.39 asper in the race theme, wait for an explanation.
  8. From the code: a hazard voice can only come from one of the scene sampler's 30 ray directions (10 sectors, each its axis and two rays 20 degrees off), so the safety layer's angular resolution is set by the sampler as much as by the HRTF.

## 1. Questions, requirements, tests

| What a person would ... | Requirement | Test |
|---|---|---|
| hear where a sound is: left-right, front-back, up-down, how far | R12, R10, R11 | VL-1, VL-1b, information budget, VL-3 |
| hear the important cue in the mix; safety never masked | R10; spec principle 4 | VL-2 |
| tell cues apart: wall, floor, ceiling, obstacle; height steps; rhythm steps | R10, R12, R19 (glossary, game) | VL-3 |
| understand the spoken lines over the sound | R19; spec principle 1 | VL-4 |
| hear music, not cacophony; themes from hard to gentle | R13; spec principles 2 and 3 | VL-5 |
| listen for an hour comfortably and safely | R13; spec section 10 | VL-6 |
| hear the shape of an object (a ring sounds round) | R10 | VL-8 |
| fly the course by ear | R11, R12, R19 | VL-7 |
| like it (second opinion only) | R13 | VL-9 |
| trust the rig itself | all | VL-0 |

## 2. The listening rig

### 2.1 Scenario

A scenario is data, written as canonical JSON (the rules of `src/util/canonical.ts`) and hashed into a key:

```json
{
  "format": "shramko-listen-scenario/1",
  "lesson": "rings-first",
  "probe": null,
  "theme": "soft",
  "prefs": "default",
  "flight": { "kind": "oracle", "pilot": "oracle/1", "attempts": 2 },
  "seconds": 40,
  "speech": { "route": "live", "voice": "onecore-david", "lufs": -16.6 },
  "stems": ["safety", "target", "shape", "speech"],
  "variant": null,
  "seed": 1
}
```

`prefs` is `default`, `calm` or a full SonicPrefs. `variant` names a control (section 2.4). The quick and full sets are lists of scenarios in `tools/listen/sets/quick.json` and `full.json`.

### 2.2 Flight sources

| Kind | What | Notes |
|---|---|---|
| `oracle` | A scripted pilot that reads the true state (pose, world, the runner's target) and steers the kinematic point mass of `demo/sim.ts`, the same velocity assist the lessons use, through a host loop like `test/helpers/record.ts`: the runner steps at 60 Hz, its actions are carried out, speech is played from clips (2.6), and a session package is written with `SessionWriter`. | One controller per goal kind: hold-height, turn-to, reach-zone, approach-stop, around, fly-distance, pass-gates, timed-course; module 0 answers every question right. Deterministic. The steering follows the simulator bench's Winter Garden pilot (`tools/bench/src/sonic-garden-pilot.ts` in ShramkoGSFPV). |
| `package` | A recorded session `.zip`: `readPackage`, `rebuildSession`, `Replayer`. The 30 Hz frames are upsampled to 60 Hz (position and velocity linear, attitude by slerp) to match the live frame rate; the replay's actions (say, cue) are applied at their frame times. | Theme and prefs from the manifest, or overridden: the same flight in every theme. `voice.webm` is never read. Evidence from real testers' packages stays in the cache, never in the repository. |
| `probe` | Still scenes for the panel: a cue preview (`CueEvent` kind `preview`, the glossary's own mechanism) at a chosen direction; yaw steps; approach ramps; a target object at a fixed direction and distance. | Directions on the panel's grids (section 3). |
| `bot` | The audio-only pilot in a closed loop (section 5). | |

### 2.3 Rendering

- Headless system Chrome (Playwright's bundled Chromium as the fallback, as `test-audio/audio.proof.ts` does), the real engine bundled by Vite, `OfflineAudioContext` at 48 kHz, frames at 60 Hz through `suspend` and `resume` exactly as `test-audio/page/proofs.ts`.
- The page is served on a fake HTTPS origin with `page.route('https://listen.invalid/**')`, which also serves the bundle and the speech clips: nothing touches the network. AudioWorklet, which the closed loop needs, exists only in a secure context, and a `page.setContent` page is not one (measured: `ctx.audioWorklet` is undefined there, defined on the routed origin).
- Measured on the build machine (Chrome 156.0.8078.80, i9-7980XE, 18 cores): one page renders the 3-ring flight of `renderListen` at 2.4 to 3.4 times real time (60 s of race in 25 s); 6 pages at once give 14.7 s of audio per second, 12 pages 25.9 s per second. The rig runs up to 12 pages in parallel.
- Files are float32 WAV, not 16-bit as `LISTEN=1` writes today: `mix.wav` (after the output chain: what the ears get), `prechain.wav` (the master's input), `stems/<name>.wav`.

### 2.4 Stems, traces and controls: test hooks

`EngineTestHooks` (`src/audio/engine.ts`) is test-only and outside the contract, so the simulator is unaffected. It gains:

| Hook | What it does | Used by |
|---|---|---|
| `onPlan(plan)` | every `FramePlan` the engine renders, from `update()` and from the stale re-plan in `pump()` | truth.jsonl |
| `onNote(note)` | every note `playNote` schedules: audio time, Hz, cents, length, gain, timbre, layer, voice key | notes.jsonl, VL-0c, VL-5 |
| `solo: { layers, keys }` | every other layer bus (dry and reverb send) and every other moving voice muted after the duck stage | stems |
| `destination`, `prechainTap` | where the output chain ends (a merger into a 4-channel context) and a node fed with the master's input | prechain.wav |
| `roughCodes: false` | the intended roughness (height band roughness, off-course beating) set to 0 at render; the plan is unchanged | VL-5 |
| `noiseSeed` | seed of the synth kit's noise buffer (now fixed at 1) | VL-0a control |
| `fixedPeriodS` | every pulse period replaced by one value | VL-7 control |
| `detuneCents`, `scaleOverride` | a seeded random detune per note; a chromatic cluster instead of the theme's pentatonic steps | VL-5 control ("cacophony engine") |

The existing hooks stay: `bypassPanner`, `limiter`, `fade`, `periodScale`, `maxMovingVoices`. Controls that need no engine change are made by the rig: yaw held at 0 in the frames fed to the engine while the craft turns (`freeze-yaw`); a layer left out of `setLayers` (`mute-<layer>`); left and right swapped; a silent render; a shape of 1 cm (`tiny-shape`); a theme variant (wall and floor with the same timbre and step).

Stems come from solo renders: the engine is deterministic, so the solos sum to the pre-chain mix (checked by VL-0b). A scenario with 7 stems costs 8 renders; the throughput above makes that affordable.

### 2.5 Ground truth

`truth.jsonl`, one line per 60 Hz frame:

- `t` (audio time, s), `tick`; pose: position, velocity, speed, yaw, pitch, roll, sticks.
- Lesson: id, phase, attempt, goal index, target id, distance to the target, aim miss.
- `voices`: for each moving voice the key, cue, layer, slot, direction in the heading frame (unit vector) and as azimuth and elevation, the panner's elevation after the +7.5 degree fix, the elevation slice Chrome renders (floored to 15 degrees and clamped per azimuth by `kMaxElevations`; both neighbours' slices for an interpolated azimuth), distance, Hz, note index, pulse period, note length, gain, low-pass, reverb send, ILD boost, Doppler cents, roughness and its rate, beating rate and depth.
- Dropped voice keys; the height, speed and room plans; `urgent`; the duck of every layer; `speaking`.
- Hazards from the scene sample (sector, rank, distance, time to collision, material, ray direction) and, in an analytic world, the true nearest surface (direction and distance from the SDF's gradient), so the sampler's ray quantization is measured exactly.
- The session events of the frame.

Beside it: `notes.jsonl` (every scheduled note, from `onNote`), `speech.jsonl` (line key, parameters, text, clip id, voice, route, start, end, level), and `meta.json` (the scenario, its key and every input hash, Chrome version and audio fingerprint, rig version, engine commit and dirty flag, wall time).

### 2.6 Speech in the offline mix

Chrome's `speechSynthesis` cannot be captured: its audio reaches neither Web Audio nor a MediaStream. The rig speaks pre-rendered clips instead.

- `ClipSpeech` implements the contract's `SpeechOut`. `speak(text, { lang, rate, interrupt })` plays the clip of exactly that text through an `AudioBufferSourceNode` and resolves at the clip's end on the audio clock (the rig resolves it at the first frame past the end); `interrupt` stops the clip in progress; `cancel()` stops all. The engine's `say()` therefore ducks and un-ducks as it does live, and the host calls `runner.spoken(t)` at the end, as the simulator's host does, so lesson timing follows real clip lengths.
- Routes. `live`: summed after the output chain, the way the browser's voice reaches the ears today, outside the limiter. `limiter`: into `engine.auxInput`, before the limiter: the product option of playing clips through Web Audio. The full tier renders both.
- Level. Clips are normalised to -16.6 LUFS at `utterance.volume` 1 (measured for OneCore David) and scaled by the volume the engine asks for. Chrome's real voice and level are not known (section 13), so the full tier also renders +-6 LU around it.
- Voices. English: Windows OneCore (David, Zira, Mark on the build machine) through WinRT from PowerShell, cached by (text, voice, rate, pitch). Russian, Polish, Spanish: Piper, a separate GPL-3.0 program downloaded to the cache, with voice models whose model card allows the use; Kokoro-82M (Apache-2.0) as a second English and Spanish voice. The text comes from the engine's translator, so the clip says exactly what the caption shows.

### 2.7 Chrome's HRTF as SOFA

`pnpm listen:hrtf` renders an impulse through `PannerNode` with `panningModel 'HRTF'` in its own `OfflineAudioContext` per direction (48 kHz, 2048 samples): 24 azimuths in 15 degree steps times the elevation slices -45 to +75 degrees, each requested 1 degree above its slice (Chrome takes the slice at or below), straight up, and a horizontal ring of 192 azimuths (1.875 degrees, Chrome's interpolated grid): 409 directions, 9.8 s in the probe. `python -m shramko_listen hrtf` writes SimpleFreeFieldHRIR SOFA files (512 taps from 32 samples before the onset).

Checks: onset at sample 268 +- 2 (5.6 ms); ITD at 90 degrees 729 +- 30 microseconds; broadband ILD at 90 degrees about 12 dB; the clamp (at azimuth 30 the 75 degree slice equals the 60 degree one; at 45 the 60 and 75 degree slices equal 45; at 90 the 75 degree slice equals 60). Control: the same capture with `panningModel 'equalpower'` must fail them.

The capture's hash together with a fixed 2 s reference render is the **Chrome audio fingerprint** in every key: a Chrome update that changes nothing audible keeps the evidence, one that does re-runs everything. The SOFA files stay in the cache.

### 2.8 Scan worlds

The Winter Garden lesson (`free-garden`) flies the simulator's voxel walls. The simulator's bench exports the flown collision grid of the lesson's scene at the lesson's scale, with its track, to the cache (`tools/bench/src/sonic-listen-export.ts`, ShramkoGSFPV). This repository's `GridWorld` (a SonicWorld: DDA rays over the grid, floor, ceiling or wall by the normal at |ny| > 0.7 as `apps/fly/src/sonic/scan-world.ts` does, gates by `trackToObjects`) loads it. Parity: 1000 random rays against the simulator's `ScanSonicWorld` must give the same material for at least 99 % and a distance within one cell. The grid is derived from the owner's scan and stays in the cache.

## 3. The panel of virtual heads

- A **head** is a measured HRTF set used as the model's template: the listener's own, familiar ears. The **target** is the sound rendered with Chrome's HRTF, which is what anyone hears in the product. The difference to the same sound rendered with the head's own HRTF is the price of Chrome's HRTF for that person (the method of Baumgartner, Majdak and Laback 2014).
- Sets are downloaded at run time into `<cache>/hrtf/` and never committed. The licence is read from each file's License field and written into the panel manifest.

| Set | Heads | Licence | Use |
|---|---|---|---|
| SONICOM | 300 measured, 200 synthetic | MIT | main panel; its download is not scripted yet |
| HUTUBS | 96 | CC BY 4.0 | yes |
| 3D3A | 38 | CC BY 4.0 | yes |
| ARI | 97 with DTFs | CC BY-SA 3.0 | yes; derived HRTFs never committed |
| CIPIC | 45 | any purpose, keep the copyright | yes |
| IRCAM LISTEN | 50 | any purpose, credit IRCAM | yes, reported apart: Chrome's composite comes from this set |
| MIT KEMAR | dummy head | free, cite | yes |
| SADIE II | 20 | the sofacoustics copy carries a University of York non-commercial licence | no, until clarified |
| RIEC, SCUT | | non-commercial | no |

- Panel v1 is the probe's 26 heads (20 ARI, 5 LISTEN, KEMAR); the quick tier uses 6 of them fixed in the manifest (4 ARI, 1 LISTEN, KEMAR); the full tier uses at least 50 once SONICOM is fetched.
- Every panel run carries two controls and is invalid unless both behave. Positive: broadband noise with each head's own HRTF gives a quadrant error inside the human range (people 9.3 +- 6 %; `baumgartner2014` 8 to 15 %, 11.7 % in the probe; `bayesian_listener` 14 to 26 %, 19.8 % in the probe). Negative: Chrome's frontal spectrum at every direction (ITD and ILD kept) gives at least 40 % (chance 51.4 %; probe 48.1 % and 49.6 %).
- Models: AMT 1.6.0 `baumgartner2014` (sagittal plane: quadrant error QE, local polar error PE; validated r = 0.97 for QE and 0.84 for PE; 0.4 s per condition) in portable Octave; `bayesian_listener` 0.3.0 (Barumerli et al., full sphere: lateral error, QE, PE; about 65 s per head for 200 directions, 3 conditions, 100 repetitions; its own-ear QE is above human data, so its differences are used, not its absolute values); AMT `mclachlan2021` (head rotation) once an adapter takes Chrome's HRTF as the target.

## 4. Test battery

Each test lists what it measures, the pass rule with its source and kind (standard, literature, calibrated on controls, proposal), and its controls: a negative one that must fail and, where useful, a positive one that must pass. Engine-level controls run once per run on a representative scenario (rings-first, soft) unless stated; synthetic controls run once per run. A test whose controls misbehave reports "invalid", never "pass".

### VL-0. Rig integrity (blocking; 0a to 0c in `pnpm proof:audio`)

| Check | Pass | Negative control |
|---|---|---|
| 0a determinism | two renders of one scenario are bit-identical | another `noiseSeed` must differ (max difference above 1e-3) |
| 0b stems | the solo stems sum to `prechain.wav` with a residual under -90 dB | the sum with one stem left out leaves more than -30 dB |
| 0c trace | onsets found in each stem match `notes.jsonl`: at least 98 % within 1 ms | the notes shifted by 20 ms fail |
| 0d HRTF capture | the checks of 2.7 | the `equalpower` capture fails |
| 0e live parity (full tier, in the simulator's bench) | the same oracle flight recorded live (an AudioWorklet recorder in front of the real page's destination, the tap pattern of `sonic-garden-pilot.ts`) against the offline render: integrated loudness within 1 LU, third-octave levels within 2 dB from 100 Hz to 12.5 kHz, onset count within 5 % | the offline render of another theme falls outside |

### VL-1. Localization by the panel (R12, R10, R11; blocking for the lateral rule)

- **Stimuli.** Every spatial cue (the safety pulse of each material, the target hum, the shape accent, the touch ping) rendered alone by the engine as a preview at the panel's directions. For `bayesian_listener` the target is Chrome's HRIR at the cue's panner direction (after the +7.5 degree fix and Chrome's clamp) convolved with a minimum-phase FIR (512 taps) of the cue's long-term magnitude spectrum; `baumgartner2014` takes the cue's dry mono waveform as `stim` (`baumgartner2014(target, template, 'fs', fs, 'tang', tang, 'polsamp', pol, 'stim', stim, 'fsstim', fs)`, as in the probe).
- **Measures.** Lateral RMS error, QE and PE per cue and theme: panel median and the share of heads.
- **Pass.** Lateral error with Chrome at most 3 degrees above the head's own for at least 90 % of the panel (proposal; probe for broadband: +1.3 degrees median, +1.9 maximum). For every cue whose design relies on the HRTF for height or front/back: its own-ear QE at most 5 points above the own-ear QE of broadband noise (proposal; probe F: broadband 11.6 %, 2 to 6 kHz noise 37.6 %, a 440 Hz tone with harmonics to 4 kHz 29.4 %). The QE with Chrome is reported but not gated: front/back and height are gated by the information budget below.
- **Exact add-on.** The voiced direction of each hazard against the true nearest surface: the sampler's quantization per sector.
- **Tiers.** Quick: `baumgartner2014`, 6 heads, lateral 0 and +-30 degrees. Full: both models, the whole panel, the whole sphere.

### VL-1b. Front and back by stick yaw (R12; blocking)

- **Measures.** The ITD of the rendered stem (cross-correlation below 1.5 kHz, 50 ms windows) before and after a 10 degree yaw step, for each spatial cue at front (10 to 80 degrees) and back (100 to 170 degrees) azimuths. Full tier adds `mclachlan2021` with rotation once its adapter exists.
- **Pass.** At least 60 microseconds of change (3 times the 20 microsecond ITD JND of AMT's defaults) with the sign that tells front from back, at every azimuth except 80 to 100 degrees (proposal; probe: +83 microseconds at the front, -21 to -167 at the back).
- **Controls.** Negative: `freeze-yaw` (no change at all). Positive: broadband noise through Chrome's HRTF.

### Information budget (R12; blocking)

Per lesson world, every item the pilot must hear has to reach 95 % correct (two-alternative, P = Phi(d'/sqrt 2), so d' >= 2.33; proposal) through at least one channel. The report shows which channel carries it.

| Item | Channels in the engine today | Measured by |
|---|---|---|
| left or right | ITD and ILD | VL-1 |
| front or back | HRTF spectrum (1 - QE); stick yaw (VL-1b); a "behind" timbre or rhythm (none yet; research 01 section 9 suggests a rear marker) | VL-1, VL-1b, VL-3 |
| up or down | HRTF (QE); the pitch bands of `elevationSteps` for target and shape; floor against ceiling timbre for hazards | VL-1, VL-3 |
| distance class (1, 2, 4, 8, 16 m) | level slope, low-pass, reverb send, repetition rate, ILD boost under 2 m | VL-3 (combined d') |
| time-to-collision class (0.6, 1.2, 2, 3 s) | pulse period | VL-3 |
| on or off course | beating on the hum | VL-3 |
| height in band | pitch of the height tone and its roughness out of band | VL-3 |

An item carried only by stick yaw is flagged: the cue is physically there, but whether people use it without the vestibular input of a real head turn is not proven (Wightman and Kistler 1999 is the closest evidence).

### VL-2. Audibility in the mix (R10, spec principle 4; blocking)

- **Measures**, per important cue (its stem) against the rest (`prechain` minus the stem), per ear and better ear: the glimpse proportion (Cooke 2006: 40 ERB-spaced gammatone channels from 80 Hz to 16 kHz, 10 ms frames, local SNR above 3 dB); for the safety layer, the margin over the masker in third-octave bands; the drop of the other layers when a hazard turns urgent. Full tier: Glasberg and Moore partial loudness (ISO 532-3) once its Python port passes its own controls.
- **Pass.** Safety: at least 13 dB over the masked threshold in at least one third-octave band (better ear) in at least 99 % of the 100 ms frames where a safety voice sounds (13 dB: ISO 7731:2003 for danger signals, used here by analogy; the frame share is a proposal; until the standard's own procedure is implemented, the masked threshold is the masker's level in the same band, which is conservative). Target and shape: glimpse proportion at least 0.3 (proposal, calibrated by the controls). Urgent duck: the other layers at least 8 dB down within 100 ms (the engine's rule is 9 dB).
- **Controls.** Positive: a 1 kHz beep 20 dB over pink noise. Negative: the same beep 10 dB under; the safety layer at -20 dB through prefs; the duck switched off for the duck check.
- **Flag, no gate.** Informational masking risk when 10 or more tonal onsets per second fall within 1 ERB of a cue from a direction within 30 degrees of it (no validated model; Neff and Green 1987, via a review).

### VL-3. Telling cues apart (R10, R12, R19; blocking)

- **3a, code steps.** For each code the parameter is measured in the stems (f0 by autocorrelation, spectral centroid, pulse, tick and repetition rates from onsets, level, AM depth, beating rate, direct-to-reverberant ratio), Gaussian internal noise of one JND is added, and d' is computed between adjacent classes: height steps; elevation pitch bands; the four safety materials; pulse periods at times to collision of 0.6, 1.2, 2 and 3 s; hum rates at 2, 4, 8, 16 and 32 m; speed tempo at 1, 3, 6 and 10 m/s; on and off course. JNDs: f0 0.2 % at 1 kHz (Moore 1974, secondary source), taken as 1 % below 500 Hz (assumption); tempo 3 % (Drake and Botte 1993: 2 to 3 % untrained); level 1 dB (assumption); ILD 1 dB and ITD 20 microseconds (AMT defaults); roughness 17 % (secondary review); direct-to-reverberant ratio 2 to 3 dB (Kolarik et al. 2016). **Pass:** d' >= 2.33 for every adjacent pair, measured in the mix (proposal).
- **3b, classifier.** Features from an auditory front end with human-like resolution (gammatone channels 1 ERB wide, 10 ms frames, log compression, modulation spectrum 2 to 64 Hz, internal noise at the JNDs above); a linear classifier trained on clean stems of the glossary render and tested on windows of the lesson mixes, labelled from `truth.jsonl`; a confusion matrix per theme. **Pass:** at least 90 % correct per category in the mix (proposal; the glossary lesson asks pilots to name cues at 90 %). **Controls:** negative: a theme variant where wall and floor share timbre and step; validity: a JND is d' = 1 here, so two classes one JND apart must score 76 +- 6 % in a two-alternative test and identical classes 50 +- 5 %; a classifier above that hears more than a person and the test is invalid; positive: synthetic classes 5 JND apart.
- **3c, streams (exact, from the truth).** Concurrent streams at most 2 in modules 0 to 2 (spec principle 2) and at most 4 anywhere (about 4 concurrent sources can be counted: Zhong and Yost 2017).

### VL-4. Speech over the mix (R19, spec principle 1; blocking)

- Every spoken line of the lesson is a clip in its place (2.6), ducked as live.
- **Measures.** Better-ear ESTOI (`pystoi`), the speech glimpse proportion; full tier: MBSTOI, HASPI v2 with a normal and with a mild sloping age-related audiogram (`pyclarity`), and Whisper large-v3 word error rate.
- **Pass.** Per line, ESTOI and HASPI at least their values for the same line over consonant chords at +6 LU (anchor control; proposal); Whisper finds every word of the caption (WER at most 2 % per lesson). Whisper is a word check only: it understands far better than people (1 % WER over chords at -6 LU, where HASPI is 0.08), so it never stands in for intelligibility.
- **Controls.** Positive: clean speech. Negative: speech 12 LU under pink noise; the duck switched off with speech at -12 LU.
- The speech level belongs to VL-6.

### VL-5. Music, not cacophony (R13, spec principles 2 and 3; blocking except where marked)

- **Measures.** Daniel-Weber roughness (MoSQITo `roughness_dw`) of the mix rendered with `roughCodes: false`, the unintended roughness, mean and p95; Sethares spectral dissonance per 100 ms; symbolic dissonance of `notes.jsonl` per 250 ms window (`dissonant`: Sethares and Vassilakis; MIDI is converted to Hz by the tool, because `dissonant.pitch_to_freq` puts 0 at A4), with and without the Doppler bends; every note's base pitch inside the theme's scale, and its measured f0 within 5 cents of the plan; the intended contrast: Daniel-Weber roughness of the target stem on axis against off axis, and of the height tone in band against out of band.
- **Pass.** Unintended roughness (mean and p95) and Sethares dissonance below the midpoint between the consonant-chord control (C, Am, F, G with a pentatonic melody) and the rough tone-cloud control (random tones, six a second, each with a partner 20 to 60 Hz above), both remade at the scenario's integrated loudness (calibrated on controls; probe at -27.7 LUFS: roughness 0.053 and 0.20 asper against 0.112 and 0.33; Sethares 0.46 against 1.56). Notes in the scale: 100 % (exact). Intended contrast at least 40 % relative, two roughness JNDs (proposal). Advisory: the symbolic dissonance with Doppler at most 1.5 times the one without (proposal).
- **Controls.** Positive: the chord control. Negative: the cacophony engine (`detuneCents` 50 and a chromatic `scaleOverride`); a theme variant with `roughMax` 0 for the contrast.
- **Never used:** MoSQITo's ECMA-418-2 roughness.

### VL-6. Loudness, peaks, startle, dose (R13, spec section 10; blocking except where marked)

- **Measures.** Integrated, momentary (400 ms) and short-term (3 s) loudness and loudness range (ITU-R BS.1770 by `pyloudnorm` and the tool's own windows); true peak (4 times oversampled) of the mix and of speech; pop-out, the momentary loudness minus the energy mean of the previous 3 s, split into urgent-hazard onsets (intended) and the rest; the attack of every non-urgent note (from `notes.jsonl` and the stems); speech short-term loudness against the cue mix in the 3 s before it. Full tier: Zwicker loudness N5, DIN 45692 sharpness computed from the same loudness, Daniel-Weber roughness, Zwicker-Fastl psychoacoustic annoyance per theme, and the dose of an hour.
- **Dose.** The school loudness sheet (`docs/testing/school-loudness-sheet.md`) sets the volume so that pink noise at -18 dBFS RMS reads the reference, 75 dBA for children and 80 dBA for adults. The tool therefore A-weights the digital signal and adds the one offset that makes that pink noise read exactly the reference (about 93 or 98 dB for 0 dBFS). An hour-long render (oracle sessions over the fast path with speech, both speech routes) gives LAeq over the hour (A-weighting on the digital signal, flat headphones) and the weekly hours allowed, 40 x 10^((reference - L) / 10) (WHO/ITU H.870 as summarised in research 01, section 8).
- **Pass.** True peak at most -1 dBTP for the mix and for speech (EBU R128). Non-urgent pop-out at most 10 LU and attacks of at least 10 ms (proposal: no primary threshold for startle was found). Speech 3 to 6 LU above the cue mix (proposal). LAeq over an hour at most the reference (proposal: an hour then uses at most 1/40 of the weekly dose). Advisory: sharpness p95 at most 1.75 acum (where the sharpness term of the Zwicker-Fastl annoyance starts); themes ordered calm < soft < clear < race by annoyance (R13: from gentle to hard); one lesson's integrated loudness within 3 LU across themes.
- **Controls.** Negative: limiter off and master +12 dB; a non-urgent cue with a 1 ms attack 15 LU over the bed. Positive: pink noise at -18 dBFS RMS gives exactly the reference.
- **Expected to fail today:** speech 11 to 14 LU over the flight, true peak -0.17 dBTP.

### VL-7. The audio-only pilot (R11, R12, R19; blocking). Details in section 5

- **7a, decoding (quick tier).** Along oracle flights, decoders read the front end's features and answer: target left or right of the nose, front or back, above or below, distance class, on or off course; the sector and time-to-collision class of each hazard; height against the band; speed class. **Pass:** at least 95 % per item where the item matters (left or right only when the target is 5 degrees or more off the nose; the minimum audible angle straight ahead is about 1 degree, Mills 1958) (proposal). **Controls:** `bypassPanner` puts left and right at chance; `mute-target` puts every target item at chance; decoders fed the true state pass.
- **7b, closed loop (full tier).** Bots fly the fast path in every theme. **Pass:** every blocking lesson passed by the lesson's own runner, for at least 90 % of the bot panel, in at most twice the oracle's time, with touches inside the lesson's rule (proposal). **Controls:** `bypassPanner` fails hover-turn and the rings; `mute-target` fails the rings; `fixedPeriodS` pushes the touches in walls-hall over the rule; a silent render fails everything (no state leaks into the bot); the oracle passes every lesson.

### VL-8. Shapes (R10; blocking for the shape lessons)

- The shape stem's lateral-angle trajectory (ITD and ILD in 20 ms windows), its accent rhythm and its pitch steps per cycle give a shape class: a ring orbits smoothly, a square ticks at four corners, a cube alternates its front and back faces, a pillar sweeps up and down in pitch bands. At 2.5 to 6 m, as in the previews and the shape lessons.
- **Pass:** at least 90 % per shape and theme (proposal); the bot answers the name-shape goal of shapes-cube. **Control:** `tiny-shape` (1 cm) must fall to chance.

### VL-9. Learned judges (second opinion only, never a gate)

An odd panel from different families, majority vote: Audiobox Aesthetics (weights CC-BY-4.0), LAION-CLAP with PAM's pair of opposite prompts (Apache-2.0), Qwen2-Audio-7B-Instruct (Apache-2.0; about 17 GB in bf16, estimate). A judge votes only after it ranks the controls (chords over tone cloud over noise bursts; for a spatial question, swapping left and right must flip its answer). Non-commercial weights (Audio Flamingo 3) are never used here; cloud models that mix to mono are never asked about direction.

### Not measured

Externalization (inside or outside the head): no model passed a control. Reported as open until one does (section 13).

## 5. The audio-only pilot (Shramko ear pilot)

**Interface, the leak guard.** Per frame the bot gets only the binaural samples rendered since the last frame (from the tap), the texts of the lines spoken since then (speech is validated on its own by VL-4), its own sticks and the clock. It returns sticks and answers. It never sees the world, the pose or the target. A layout rule in `tools/check-layout.ts` keeps `test-audio/page/listen/pilot/` from importing anything but `ear/` and its own files, with a negative control in its test.

**Front end** (`test-audio/page/listen/ear/`, DOM-free TypeScript, also run by Node tests): per ear a 4th-order gammatone filterbank (40 channels, 80 Hz to 16 kHz, ERB-spaced); envelopes (half-wave rectified; in the channels above 1.5 kHz low-passed at 1 kHz, as the ear loses the fine structure there); ITD per channel below 1.5 kHz (normalised cross-correlation within +-1 ms, 20 ms windows); ILD per channel above 1.5 kHz; the lateral angle from a map fitted on one head's own HRTF (each panel bot has its own head, so the mismatch with Chrome's HRTF is part of the test); onsets, and grouping into streams by templates learned from the glossary; f0 by summary autocorrelation; AM depth from 2 to 64 Hz (beating, roughness); the tempo of pulse trains; internal noise at the JNDs of VL-3; a perceptual delay of 0.3 s (assumption).

**Learning the language.** Before flying, the bot "takes" ears-glossary and ears-walls: from their renders it learns a template per cue (pitch, centroid, rhythm), and from their spoken lines the monotonic codes (a faster pulse is nearer, a higher tone is higher). Then it flies with that and nothing else, as a pilot would.

**Policy.** The oracle's controllers with every true-state input replaced by its perceived estimate: turn toward the hum until it is centred; a small yaw wiggle when front or back is uncertain (the ITD sign test of VL-1b); climb or sink by the hum's pitch band; slow down as its repetition rises; keep the height tone in band (no roughness); stay centred between the left and right wall pulses; stop when a front pulse quickens past a learned rate. In module 0 it answers the questions: what (the classifier), where (the lateral sign and the yaw test), moving or still (level and Doppler change).

**The ladder, which tells what to fix.**

| Level | Hears | A failure here, with the level above passing, means |
|---|---|---|
| L0 oracle | the true state | the lesson or the controller is broken, not the sound |
| L1 stem bot | each layer alone: no masking between layers | the code lacks information or cannot be decoded: change the code |
| L2 mix bot | the real mix, a lateral map fitted on Chrome's own HRTF | masking or crowding: change levels, spectra, the voice budget |
| L3 panel bots | the real mix, other heads' maps, other noise seeds | it depends on the listener: add redundancy or training; personal HRTFs later |

A bot that fails while 7a decodes well has a bot problem, not a sound problem: fix the bot first.

**Closed loop.** An `OfflineAudioContext` with an AudioWorklet tap in front of the destination. The rig suspends every 1/60 s, waits until the tap's messages have reached the suspend frame, hands the samples to the bot, applies its sticks to the point mass, steps the runner and feeds the engine. Spike on 2026-11-08 (Chrome 156, fake HTTPS origin): 178 suspends over 3 s of audio rendered in 1.7 s; the tap's stream was bit-identical to the final buffer; at 23 of the 178 suspends the messages lagged by up to 640 frames, so the wait is needed. Fallback: a live `AudioContext` in real time.

**Outputs.** A session package per bot flight in the simulator's format, so `pnpm report` gives attempts, touches, gate misses and path deviation; plots of the oracle's and the bots' paths over the lesson world.

## 6. Outputs: cache, keys, evidence, report, tiers

### 6.1 Cache

`SHRAMKO_LISTEN_CACHE` (default `<repo>/.cache/listen`, already gitignored; on the build machine it must point to the data disk, because the repository sits on a small system disk):

```
<cache>/hrtf/<set>/<head>.sofa, panel.json
<cache>/chrome/<fingerprint>/hrtf_grid.sofa, hrtf_ring.sofa
<cache>/speech/<voice>/<sha256>.wav
<cache>/renders/<render-key>/meta.json, mix.wav, prechain.wav, stems/*.wav, truth.jsonl, notes.jsonl, speech.jsonl
<cache>/metrics/<metric-key>.json
<cache>/report/<engine8>-<tier>/index.md, report.json, img/*.png
<cache>/logs/
```

A 60 s render with 7 stems is about 0.2 GB of float32; a full tier about 40 GB (estimate). Render folders older than the last two engine hashes are pruned.

### 6.2 Keys

- **Render key** = sha256 of the canonical JSON of {rig version, engine content hash (sorted paths and sha256 of every file under `src/`, `themes/`, `lessons/`, `locales/`, and `package.json`), Chrome audio fingerprint, the scenario, the speech clip set's hash}.
- **Metric key** = sha256 of {render key, the metric code's hash (`tools/listen/`), tool versions, the thresholds}.
- An existing key is not run again. A changed threshold re-measures without re-rendering; a changed engine re-renders. The canonical JSON is implemented in TypeScript and in Python, with one parity test on a fixture. The engine commit and a dirty flag are recorded for tracing, not keyed.

### 6.3 Evidence (committed, small)

`evidence/listen/index.json` (engine hash, commit, dirty flag, Chrome fingerprint, tier, and per test: id, scope, key, valid, pass, blocking, file), `evidence/listen/<test>/<lesson>.<theme>[.<variant>].json`, and `evidence/listen/summary.md` (the gate table only). One evidence file:

```json
{
  "format": "shramko-listen-evidence/1",
  "test": "VL-2",
  "scope": { "lesson": "rings-first", "theme": "soft", "variant": null },
  "requirement": ["R10", "spec principle 4"],
  "key": "4be1...",
  "render": "9a0c...",
  "inputs": { "engine": "c3f1...", "commit": "7d4b4b9", "dirty": false, "chromeAudio": "e19a...", "chrome": "156.0.8078.80", "rig": 1, "metrics": "shramko-listen 0.1.0", "tools": { "mosqito": "1.2.1" } },
  "thresholds": { "safetyMarginDb": { "value": 13, "kind": "standard", "source": "ISO 7731:2003" }, "safetyFrameShare": { "value": 0.99, "kind": "proposal" } },
  "measured": { "safety": { "frames": 412, "shareOverMargin": 1.0, "minMarginDb": 17.2 } },
  "controls": { "positive": [{ "name": "beep +20 dB over pink", "ok": true }], "negative": [{ "name": "safety -20 dB", "ok": false }] },
  "valid": true,
  "pass": true,
  "blocking": true,
  "artifacts": ["report/c3f1a2b4-full/img/vl2-rings-first-soft.png"]
}
```

`valid` means the controls behaved; `pass` counts only when `valid`. Evidence from real testers' packages is never committed.

### 6.4 Report, for agents first

`index.md` opens with the gate table (test by lesson by theme: pass, fail, advisory, invalid), then one section per test: numbers in tables first, then images with fixed names. Pictures: a cochleagram per scenario (both ears, 40 channels, with cue onsets, speech and urgent spans drawn over it); localization maps (target angle against the predicted response probability, per cue, panel median) and bars of QE, PE and lateral error for own ears, Chrome and the control; per-cue tables (margin, glimpses, d', classifier accuracy); confusion matrices; loudness timelines (momentary, short-term, speech, pop-outs); roughness timelines per stem; the information budget; the bots' paths over the lesson world. PNG at most 1600 by 900, matplotlib, one colour for each ear throughout.

### 6.5 Tiers

| Tier | When | Contents | Time |
|---|---|---|---|
| `pnpm proof:audio` | every change of `src/audio` or `src/cues` | the 5 existing proofs plus VL-0a to 0c (`test-audio/listen-rig.proof.ts`) | about 30 s (estimate) |
| quick | every change of the engine, a theme or a lesson | ears-glossary, hover-height, walls-hall, corridor, rings-first; 3 themes; 30 s each; mix, safety, target and speech stems; VL-0d, VL-1 quick, VL-1b, VL-2, VL-4 (ESTOI), VL-5 and VL-6 without MoSQITo, VL-7a | renders about 1 min at the measured 26 s of audio per second; metrics about 5 min (estimate); target under 10 min |
| full | overnight, before people and on every release candidate | 21 lessons by soft, clear, race and calm; every stem; recorded packages in every theme; hour-long sessions; both speech routes and +-6 LU; full panels; MoSQITo on the mix and the safety and target stems (20 s excerpts, 30 processes); MBSTOI, HASPI, Whisper; classifier; VL-7b bots; VL-8; VL-9; VL-0e | renders about 45 min; all of it 3 to 6 h (estimate) |

The full tier runs as a detached process with its log under `<cache>/logs/`. Whisper and the judges take the machine's GPU lock (`GPU_LOCK`, default `C:/dev/.gpu-lock`) while they run.

### 6.6 Commands and how it plugs in

```
pnpm listen:hrtf            # node tools/run-tool.mjs listen hrtf
pnpm listen:quick           # render the quick set, measure, write evidence and the report
pnpm listen:full            # the same for the full set (start it detached)
pnpm listen:status          # which evidence is stale for the current inputs
pnpm listen:report          # rebuild the report from the evidence
python -X utf8 -m shramko_listen doctor | panel fetch | run --tier quick [--only VL-2] | report
```

`pnpm proof:audio` keeps its role (engine physics, browser only) and gains VL-0a to 0c. The `listen:*` scripts need the Python environment and say so plainly when it is missing. `AGENTS.md` gets one rule: a build for people needs `pnpm listen:full` green on its engine hash.

## 7. Where code lives, licences

| Path | Language | What |
|---|---|---|
| `test-audio/page/listen.ts`, `test-audio/page/listen/` | TypeScript, browser | scenario renderer, `ClipSpeech`, taps, closed loop, probe scenes |
| `test-audio/page/listen/ear/`, `pilot/`, `host/` | TypeScript, DOM-free | front end, bots, oracle host (also run by Node tests) |
| `tools/listen.ts` | TypeScript, Node | driver: Playwright, keys, cache, calls the Python tool |
| `tools/listen/` | Python 3.11 | Shramko Virtual Listener: metrics, tests, thresholds, report (`pyproject.toml`, `requirements.lock`, `shramko_listen/`) |
| `tools/listen/adapters/` | Python, Octave | our own code that calls the copyleft tools, each run as a separate process |
| `tools/listen/tts/` | PowerShell (ASCII only), Python | clip makers |
| `src/audio/engine.ts` | TypeScript | the new test hooks only |
| `evidence/listen/` | JSON, Markdown | evidence and the gate table |

All the code is this repository's own, under its MIT licence. Rules:

- Nothing of AMT (GPL-3.0), `bayesian_listener` (EUPL-1.2) or Piper (GPL-3.0) is copied into the repository or translated into its code. The setup script installs them outside the repository; only `tools/listen/adapters/` calls them, each in its own process exchanging files (SOFA, WAV, JSON); the core package never imports them. This keeps the licences apart; it is not legal advice.
- Datasets and models are fetched at run time into the cache and never committed: HRTF sets, Whisper large-v3 (MIT), Audiobox Aesthetics (CC-BY-4.0), CLAP (Apache-2.0), Qwen2-Audio (Apache-2.0), Piper voices (each by its model card). Derived HRTFs (ARI is CC BY-SA 3.0) and Chrome's captured HRTF stay in the cache.
- Never used: SADIE II, RIEC, SCUT, Audio Flamingo 3, anything non-commercial; real testers' voices or packages in the repository.
- Windows voices are part of the operating system: used to make test clips on the machine, never distributed.
- The other Python packages: MoSQITo Apache-2.0; `pystoi`, `pyloudnorm`, `pyclarity`, `faster-whisper`, `ctranslate2`, `dissonant`, `sofar`, `pyfar` MIT.

## 8. Install

On the build machine (Windows 10, no admin rights, everything on the data disk; Node 22 and Python 3.11 on the path):

```
python -m venv U:/venvs/shramko-listen
U:/venvs/shramko-listen/Scripts/python -m pip install -r tools/listen/requirements.lock
U:/venvs/shramko-listen/Scripts/python -m pip install --no-deps pyclarity==0.9.0
U:/venvs/shramko-listen/Scripts/python -m pip install --no-deps -e tools/listen
curl -L -o U:/Temp/octave.7z https://ftp.man.poznan.pl/gnu/octave/windows/octave-9.4.0-w64-64.7z
"C:/Program Files/7-Zip/7z.exe" x U:/Temp/octave.7z -oU:/tools
curl -L -o U:/Temp/amt.zip "https://downloads.sourceforge.net/project/amtoolbox/AMT%201.x/amtoolbox-full-1.6.0.zip"
unzip U:/Temp/amt.zip -d U:/tools/amt
U:/venvs/shramko-listen/Scripts/python -X utf8 -m shramko_listen panel fetch
U:/venvs/shramko-listen/Scripts/python -X utf8 -m shramko_listen whisper fetch
U:/venvs/shramko-listen/Scripts/python -X utf8 -m shramko_listen doctor
```

- `requirements.lock` pins: numpy 2.4.6, scipy 1.17.1, numba 0.68.1, soundfile 0.14.0, matplotlib 3.11.2, sofar 1.3.0, pyfar 0.8.1, spaudiopy 0.2.0, bayesian_listener 0.3.0, mosqito 1.2.1, pystoi 0.4.1, pyloudnorm 0.2.0, jiwer 4.0.0, faster-whisper 1.2.1, ctranslate2 4.8.5, dissonant 0.1.1. Each was installed in one of the two probe environments; together they resolve without a conflict (`pip install --dry-run` on 2026-11-08: 71 packages). `pyclarity` goes in with `--no-deps`: its declared dependencies pull torch, hydra and about twenty more.
- Environment: `SHRAMKO_LISTEN_CACHE=U:/cache/shramko-listen`, `SHRAMKO_LISTEN_PY=U:/venvs/shramko-listen/Scripts/python.exe`, `SHRAMKO_OCTAVE=U:/tools/octave-9.4.0-w64-64/mingw64/bin/octave-cli.exe`, `SHRAMKO_AMT=U:/tools/amt/amtoolbox-1.6.0`; `HF_HOME` and `PIP_CACHE_DIR` on the data disk too.
- Sizes: Octave 436 MB to fetch (249 s from the Poznan mirror; ftp.gnu.org gave 0.3 MB/s), 2.5 GB unpacked; AMT 14 MB, 35 MB unpacked; the environment about 3.3 GB (the two probe environments were 2.6 GB and 0.67 GB); Whisper large-v3 2.9 GB; the 26-head panel 65 MB (SONICOM not measured yet); renders up to about 40 GB per full tier (estimate). The probe environments (`U:/venvs/vl-research`, `U:/venvs/vl-spatial`) and their pip cache (1.5 GB) can go once this one works.
- Traps found by the probes: run Python with `-X utf8` (`bayesian_listener` crashes on a cp1252 console); MoSQITo 1.2.1 imports matplotlib without declaring it; `dissonant.pitch_to_freq(60)` returns 14 080 Hz; SOFAload's "Invalid UTF-8" warnings are harmless; the AMT page gives S = 1 for `baumgartner2014`, the code's default is 0.7; `ctranslate2` 4.8.5 carries cuDNN 9 and the machine has CUDA 12.6 and 12.9, so the nvidia wheels (1.25 GB) are not needed here; Chrome's HRTF slices must be requested 1 degree above; PowerShell files ASCII only.

## 9. Speed and cost, measured and estimated

| Item | Number | Kind |
|---|---|---|
| one render page | 2.4 to 3.4 x real time | measured |
| 12 render pages | 25.9 s of audio per s | measured |
| Chrome HRTF capture | 9.8 s for 409 directions | measured |
| `baumgartner2014` | 0.4 s per condition; 26 heads, 3 conditions in 31.6 s | measured |
| `bayesian_listener` | about 65 s per head (200 directions, 3 conditions, 100 repetitions) | measured |
| MoSQITo loudness, sharpness, D-W | about 25, 25, 10 to 35 s per 12 s of one ear | measured |
| ESTOI, glimpses, Whisper large-v3 (RTX 4090) | 0.6 s, 2.2 s, 3 s per 35 s of speech | measured |
| MBSTOI, HASPI | 14 s, 17 s per 12 s | measured |
| closed loop | 3 s of audio with 178 suspends in 1.7 s | measured |
| quick tier | under 10 min | estimate |
| full tier | 3 to 6 h | estimate |

## 10. Hardware verdict

None is needed. What reaches the headphones is digital, and the offline render gives exactly those samples. The listener's head is data: 26 measured heads now, about 500 with SONICOM. The colour of particular headphones can be added as a filter from published measurements. The one thing software cannot know is the sound pressure at the ear for a given computer, headphone and volume setting; that is a one-off safety calibration with a coupler and a class 1 or 2 meter, already written in `docs/testing/school-loudness-sheet.md` and done by a school's occupational-health service, not a purchase for the virtual listener. A dummy head or binaural microphones would matter only for sound that travels through the air (loudspeakers, open headphones in a room, bone conduction) or to check whether Windows Sonic or Atmos spatialises the browser's output a second time, and that last case should first be tried with a digital loopback recording. No head tracker: stick yaw is the head turn, and `mclachlan2021` simulates rotation.

## 11. When people come in

- **Gate.** Every blocking test of the full tier passes on the release candidate, for every theme and speech route that will ship. Advisory results are read, not gated.
- **Then people calibrate.** The first small group (the owner, then testers) flies the gated build. Their packages already record what the virtual listener predicted: the headphone check's answers (front and back), the glossary and game answers, passes, touches, survey items such as "ears tired" and "fear". A calibration table puts each prediction next to what people did; thresholds marked "proposal" are tuned from it; a test whose prediction disagrees with people where it matters is fixed or dropped.
- **Never** a build to people for bugs the virtual listener can find.

## 12. Build plan

Three lanes at most at once: A, render side (TypeScript, browser); B, the listener (Python); C, front end and bots (TypeScript, DOM-free, and the closed loop). One commit per step, each with its check. Hours are rough estimates of agent time.

| # | Step | Check | Hours | Lane, parallel |
|---|---|---|---|---|
| 1 | Rig skeleton: `tools/listen.ts`, page `listen.ts` on the routed HTTPS origin, scenario JSON, render key, cache root, float32 WAV, up to 12 pages | the `renderListen` ring flight re-rendered sample for sample; two renders bit-identical (VL-0a); another seed differs | 5 | A; with 2 and 4 |
| 2 | Python package, `requirements.lock`, setup script, `doctor`; canonical JSON and keys in Python | `doctor` repeats probe A (ARI NH2: QE 8.1 % +- 1 point, answers at 0, 45, 180 degrees); one fixture gives the same key in TypeScript and Python | 3 | B; with 1 |
| 3 | Engine test hooks of 2.4 | `pnpm test` and `pnpm proof:audio` unchanged; VL-0b and 0c with their controls in `test-audio/listen-rig.proof.ts` | 4 | A; after 1 |
| 4 | Oracle host and pilots for every analytic lesson on the point mass; package writer; `Replayer` source at 60 Hz; probe scenes | Node: the oracle passes all 20 analytic lessons by their own runners; `checkSession` of each oracle package is clean | 6 | C; with 1 to 3 |
| 5 | `ClipSpeech`, OneCore clip maker, routes `live` and `limiter`, `speech.jsonl` | Whisper finds every word of every English line; the duck on the stems is 12 +- 0.5 dB while speaking; a clip of another line fails the word check | 4 | A; after 3 |
| 6 | Chrome HRTF capture in the repository, SOFA, audio fingerprint | the checks of 2.7; the `equalpower` control fails | 2 | A or B |
| 7 | VL-6 without MoSQITo | its controls: limiter off +12 dB fails, a 1 ms attack fails, pink at -18 dBFS RMS gives the reference | 3 | B; after 1 |
| 8 | VL-5 without MoSQITo: Sethares, symbolic (with the MIDI fix), notes in scale and f0 against the plan, streams | chords pass; tone cloud and the cacophony engine fail; 100 % in scale for the shipped themes | 4 | B |
| 9 | VL-2: glimpses per stem, safety third-octave margin, urgent duck | beep +20 dB passes, -10 dB fails; safety at -20 dB fails; duck off fails | 4 | B |
| 10 | VL-4 quick: ESTOI, speech glimpses, chord anchor | clean speech near 1; 12 LU under pink fails | 2 | B; after 5 |
| 11 | VL-1 quick (`baumgartner2014` adapter, 6 heads, cue-weighted targets, previews on the grid) and VL-1b | the panel's controls in range; ITD change positive at the front, negative at the back; `freeze-yaw` fails | 5 | B; after 6 |
| 12 | `listen:quick`, `evidence/listen/`, report v1 (cochleagram, loudness timeline, localization map, tables), `listen:status` | a second run with nothing changed runs nothing; a theme change re-runs only that theme | 5 | B |
| M1 | **Quick tier on main**; first report to the owner | | | |
| 13 | Panel fetch (SONICOM scripted, licences recorded); `bayesian_listener` panel | own-ear QE 14 to 26 %, control at least 40 %; the lateral rule evaluated | 4 | B |
| 14 | MoSQITo per stem: N5, sharpness, D-W; unintended roughness; intended contrast; annoyance; theme order | each metric separates its controls at least 2 times, or it is dropped; `roughMax` 0 fails the contrast | 4 | B |
| 15 | MBSTOI, HASPI v2 (normal, mild loss), Whisper word check under the GPU lock | anchor and negative control behave; WER 0 on clean clips | 3 | B |
| 16 | VL-3: d' per code, classifier with the one-JND validity control, confusion matrices, the information budget table | the one-JND pair at 76 +- 6 %, identical classes at chance; the wall-equals-floor theme fails | 6 | B or C |
| 17 | VL-8 shapes | `tiny-shape` at chance | 3 | B |
| 18 | Hour-long sessions, dose table; packages in every theme; full set as a detached run with a log | the pink calibration check; a full run completes overnight | 3 | B |
| 19 | Front end `ear/` with Node tests on synthetic signals | a known ITD gives the lateral angle within 3 degrees; pulse rate within 3 %; f0 within 1 %; AM depth within 0.05 | 8 | C; may start before M1 |
| 20 | Closed loop: AudioWorklet tap with the frame wait (spike done) | the tap's stream bit-identical to the buffer over a whole lesson; the same decisions in two runs | 2 | C |
| 21 | VL-7a decoding along oracle flights | `bypassPanner` puts left and right at chance; `mute-target` puts target items at chance | 4 | C |
| 22 | Bots L1 and L2 on hover-height, hover-turn, rings-first; learning from the glossary; the leak-guard layout rule | L2 passes the three lessons or the ladder says why; the silent render fails; the layout rule's control fails | 8 | C |
| 23 | Fast path, module-0 questions, L3 panel (heads by seeds), every VL-7b control, paths drawn | the VL-7b gate evaluated; every control fails as it must | 6 | C |
| M2 | **Full tier with the pilot gate**: a build may go to people when it is green | | | |
| 24 | Learned judges (VL-9) | each judge ranks the controls; a left-right swap flips its spatial answers | 4 | B |
| 25 | `GridWorld` for free-garden (exporter in the simulator's bench) and live parity VL-0e (simulator's bench) | rays: at least 99 % the same material, distance within one cell; live against offline within the tolerances | 6 | A, in ShramkoGSFPV |
| 26 | Piper for Russian, Polish and Spanish; a second English voice | the word check per language; each voice's licence recorded | 3 | A |
| 27 | `AGENTS.md` rule, a status file for this lane, the calibration table in `docs/testing/test-protocol.md` | `pnpm test` (docs tests) passes | 1 | any |

About 47 hours to M1 and 110 in all; with three lanes about 25 and 45 hours of wall time (lane B is the longest before M1, so steps 6 and 7 can move to lane A). M1 alone already measures the problems the probes found.

## 13. Findings to act on, open questions

To change in the engine (each change re-measured by the virtual listener, not by people):

1. Speech: play pre-rendered clips through Web Audio and the limiter (`SpeechOut` already allows it) 3 to 6 LU over the mix, or at least lower the voice's volume. The voice would then also be the same on every machine.
2. Front/back and height: do not rely on the HRTF alone. Keep pitch for height, consider a "behind" timbre or rhythm, and make every HRTF-reliant cue broadband to about 16 kHz.
3. Explain the 6 to 8 LU pop-outs and the race theme's roughness event by event (VL-6, VL-5).

Open, and how each would be closed:

- Do people use stick yaw like a head turn without vestibular input? People decide; the virtual listener can only show the cue is there.
- Which voice and level does Chrome use on Windows? The engine asks for en-GB and the machine has only en-US local voices, so Chrome likely takes a network voice (not verified). One WASAPI loopback recording would answer it, but it records all system audio and needs the owner's consent; shipping clips makes the question go away.
- Externalization with other people's HRTFs: no validated model; `li2020` with room responses, or a human anchor, are the candidates.
- Blind pilots may localize differently from the sighted listeners the models were fitted on.
- No Python versions of fluctuation strength (Osses 2016, MATLAB SQAT; the engine's pulses of 1 to 11 Hz sit in its range) or of Harrison and Pearce's consonance models (R); the partial-loudness port (Slaney) and SIIB not yet tried.
- How many JNDs a code needs inside a busy mix: the proposals start at d' 2.33 and are calibrated on the first testers.
- The SADIE II licence (non-commercial in the sofacoustics copy, Apache-2.0 per research 01).

## Sources

- Baumgartner, Majdak, Laback 2014, JASA 136:791: https://pmc.ncbi.nlm.nih.gov/articles/PMC4582445 ; AMT models: https://amtoolbox.org/amt-1.6.0/doc/models/
- Majdak, Baumgartner, Laback 2014, Front. Psychol. 5:319: https://doi.org/10.3389/fpsyg.2014.00319
- Barumerli et al. 2023, Acta Acust. 7:12: https://doi.org/10.1051/aacus/2023006 ; `bayesian_listener`: https://github.com/robaru/bayesian_listener ; arXiv 2606.24367: https://arxiv.org/abs/2606.24367
- McLachlan, Majdak, Reijniers, Peremans 2021: https://amtoolbox.org/amt-1.6.0/doc/models/mclachlan2021.php
- Best, Baumgartner, Lavandier, Majdak, Kopco 2020, externalization review: https://pmc.ncbi.nlm.nih.gov/articles/PMC7488874
- Wightman, Kistler 1999, JASA 105: https://doi.org/10.1121/1.426899
- Chromium `hrtf_elevation.cc`: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/audio/hrtf_elevation.cc
- SONICOM dataset: https://arxiv.org/abs/2507.05053 ; SOFA databases: https://sofacoustics.org/data/database/
- Mills 1958, minimum audible angle about 1 degree straight ahead (via): https://www.sfu.ca/sonic-studio/WSPDatabase/AnalysisDVD/Handbook5/handbook/Minimum_Audible_Angle.html
- Cooke 2006, glimpsing model, JASA 119:1562: https://bibbase.org/network/publication/cooke-aglimpsingmodelofspeechperceptioninnoise-2006
- Glasberg, Moore 2005, partial loudness, JAES 53:906: https://www.aes.org/e-lib/browse.cfm?elib=13391 ; ISO 532-3: https://www.iso.org/standard/90816.html ; Python port: https://github.com/MalcolmSlaney/LoudnessModel
- ISO 7731:2003: https://standards.iteh.ai/catalog/standards/iso/7d887fd0-79ca-4268-a084-73554dcd05d2/iso-7731-2003
- Informational masking (Neff and Green 1987, Lutfi), review: https://pmc.ncbi.nlm.nih.gov/articles/PMC2677353
- Pitch JND (Moore 1974, secondary): https://ccrma.stanford.edu/~malcolm/correlograms/text/33%20Frequency%20Difference%20Limen%20Or%20Jnd.html
- Drake, Botte 1993, tempo discrimination: https://link.springer.com/article/10.3758/BF03205262
- Roughness JND about 17 % (secondary): https://dael.euracoustics.org/confs/fa2026/data/articles/000235.pdf
- Kolarik et al. 2016, distance perception: https://doi.org/10.3758/s13414-015-1015-1
- Zhong, Yost 2017, JASA 141:2882: https://doi.org/10.1121/1.4981118
- MoSQITo: https://mosqito.readthedocs.io/en/latest/source/reference/mosqito.sq_metrics.html ; ECMA-418-2 MATLAB reference (Lotinga 2025): https://salford-repository.worktribe.com/output/4237250
- Daniel, Weber 1997 (as cited by the implementation): https://eprints.soton.ac.uk/442865/3/Roughness.m
- Plomp, Levelt 1965: https://pubmed.ncbi.nlm.nih.gov/5831012/ ; Sethares and Vassilakis in `dissonant`: https://github.com/bzamecnik/dissonant
- Harrison, Pearce 2020: https://pmc.ncbi.nlm.nih.gov/articles/PMC7032667/
- ESTOI (Jensen, Taal 2016): https://dblp.uni-trier.de/rec/journals/taslp/JensenT16.html ; `pystoi`: https://github.com/mpariente/pystoi ; `pyclarity`: https://pypi.org/project/pyclarity
- Van Kuyk, Kleijn, Hendriks 2018, intelligibility metrics: https://arxiv.org/abs/1708.06027
- Speech recognition beyond people: https://arxiv.org/abs/2605.12107
- `faster-whisper`: https://github.com/SYSTRAN/faster-whisper ; `pyloudnorm`: https://github.com/csteinmetz1/pyloudnorm
- EBU R128: https://en.wikipedia.org/wiki/EBU_R_128
- Zwicker-Fastl annoyance: https://arxiv.org/pdf/2410.22208 ; SQAT: https://github.com/ggrecow/SQAT
- Web Speech has no audio capture: https://lists.w3.org/Archives/Public/public-webrtc-logs/2020Sep/0207.html ; Chrome's voices on Windows: https://chromium.googlesource.com/chromium/src/+/lkgr/content/browser/speech/tts_win.cc
- Piper (GPL-3.0): https://github.com/OHF-Voice/piper1-gpl ; Kokoro-82M: https://huggingface.co/hexgrad/Kokoro-82M
- Judges: https://huggingface.co/facebook/audiobox-aesthetics ; PAM: https://arxiv.org/abs/2402.00282 ; https://huggingface.co/Qwen/Qwen2-Audio-7B-Instruct ; excluded: https://huggingface.co/nvidia/audio-flamingo-3
- AudioWorklet is for secure contexts only: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- This repository: `docs/research/01-spatial-audio-on-headphones.md` (sections 5, 8, 9), `docs/testing/school-loudness-sheet.md`, `docs/testing/test-protocol.md`, `docs/design/stage-1-spec.md`.
