# Spatial audio on headphones for a sound-only FPV simulator

Research note 01 for ShramkoSonicFPV, an open-source FPV drone simulator that blind and low-vision pilots can fly by sound alone, in the browser (Web Audio, PlayCanvas, TypeScript), on ordinary good stereo headphones. Written 2026-11-07. Evidence tags: **MEASURED** (a study, spec, source file or my own benchmark gives the number), **REPORTED** (a credible source states it, no measurement I could check), **INFERRED** (my reasoning or calculation). "Abstract only" means I could read only the abstract, so the claim goes no further than it. Citations are [n]. Section 10 lists what I searched for and did not find.

## Summary

(written last)

## 1. Which encoding loses least on headphones

On headphones the last stage is always two channels, so every format is judged by how much directional detail survives the trip to two ears. CPU figures are my own measurements (Chrome 156, Windows 10, Core i9-7980XE, OfflineAudioContext, 48 kHz, percent of one core; method in 5.2). Beam widths are my own calculation (INFERRED): full width at -3 dB of an order-N max-rE pattern.

| Approach | What happens | Resolution / error | CPU, one core | Verdict |
|---|---|---|---|---|
| 5.1 / 7.1 bed on virtual speakers | one HRTF pair per speaker; between speakers only amplitude panning | set by speaker spacing; no height (INFERRED) | 6-8 stereo convolutions | reject |
| 7.1.4 / 8.1.4.4 bed (Atmos, DTS, Windows Sonic) | 12-17 fixed positions, 4 overhead in 7.1.4 [@mssaudio] | as above, with a fixed vendor HRTF | in the OS | not reachable from a page (below) |
| Atmos / DTS / Sonic dynamic objects | the OS renders each object binaurally; 128 objects on Windows since build 22621, 0 when spatial sound is off [@mssaudio] | any position; vendor HRTF the app cannot personalise | native `ISpatialAudioClient` only | not usable from Web Audio |
| Ambisonics order 1 (4 ch) | SH-domain bus, binaural decode | beam 115°; ILD lower than with the HRIR, poor localisation and externalisation [@mckenzie] [@zaun] | 1.2 % | too coarse |
| order 3 (16 ch) | same | beam 56° | 4.7 % | minimum for an ambience bus |
| order 4 (25 ch) | same | beam 45°; an HRTF kept at order 4 still gave accurate localisation (own-HRTF listeners) [@romigh] | 8.0 % | largest order on one 32-channel bus |
| order 5 (36 ch) | same | beam 37° | 11.7 % (2 buses) | HRTF-limited |
| order 7 (64 ch) | same | beam 28°; I found no listening test of 5 vs 7 | 21.7 % (2 buses) | no evidence of benefit |
| Direct HRTF per source | one HRTF pair per source, direction interpolated | no encoding loss; error = HRTF mismatch (section 2); grid: built-in 1.9° az / 15° el, SADIE II 1° (dummy heads), 5° or 10° [@sadie] | built-in 0.18 % static, 1.3 % moving, per source; ConvolverNode 0.32 % | **recommended** |

- **More speaker channels on headphones: no (INFERRED, supported by [@mssaudio]).** Windows Sonic, DTS Headphone:X and Atmos "implement speaker mapping and virtualization to headphones", and Doppler, distance filtering, occlusion and reverb stay with the app's own engine [@mssaudio]. A bed only fixes where the virtual loudspeakers sit; between them the result is panning, and the ears get two channels in every case. A scan of Chromium's 30 Windows audio files (`media/audio/win`) finds no use of `ISpatialAudioClient`, Atmos or Sonic APIs (MEASURED, [@chrlat]), and the Web Audio spec has no such interface [@waspec]. Risk to test: with Windows Sonic or Atmos switched on, the OS may spatialise our already binaural stereo a second time.
- **Order vs perception.** Loudspeaker-ring tests with order 1-4 microphones: localisation improved with order [@bertet] (abstract only). An HRTF represented at order 4 or higher kept accurate localisation, and even order 1 keeps several physical cues [@romigh] (abstract only). Models predict accuracy rising with order (tested 1-44), methods differ mostly at low orders, and the magnitude-least-squares family is recommended [@engel] (abstract only). Low order lowers ILD [@mckenzie] and rolls off high frequencies [@benhur]. Caution: in a 16-listener test with microphone recordings and a generic decoder, third order gave larger elevation errors than first order [@pietrzak] (REPORTED; microphone and decoder confounded). Order does not repair a mismatched HRTF.
- **Why order matters at high frequency (INFERRED).** Order N represents the head response only up to about f = N·c / (2π·0.0875 m): 0.6 kHz (N=1), 1.9 kHz (N=3), 3.1 kHz (N=5), 4.4 kHz (N=7). Pinna cues sit at 4-16 kHz [@hebrank], so every practical order needs high-frequency magnitude correction [@zaun] [@engel].
- **Direct rendering is the reference.** A head-tracked headphone display with each listener's own HRTFs matched free-field localisation [@romigh2] (abstract only). Any loss in our product is HRTF mismatch, latency or cue design, not encoding.
- **Cost crossover (MEASURED, INFERRED).** A decoder costs the same for any number of sources; a moving built-in HRTF source costs 1.3 %. Order-3 decoding equals 3.6 moving sources, order 5 equals 9, order 7 equals 17. Below about 16 sources direct rendering is cheaper than order 5 or 7.

## 2. Human localisation limits over headphones

| Quantity | Value | Condition | Tag | Src |
|---|---|---|---|---|
| Minimum audible angle, azimuth | 0.97° | real sources on the horizontal plane, 4 listeners | MEASURED | [@perrott] |
| Minimum audible angle, elevation | 3.65° (1.8° at 80° array tilt) | real sources, vertical array | MEASURED | [@perrott] |
| MAA over headphones | headphone system gave resolution comparable to loudspeakers; self-translation MAA 3.3° in front | abstract only | MEASURED | [@selftrans] |
| Interaural thresholds | time difference about 10 µs, level difference about 0.5 dB | tones, optimal conditions, 3 listeners | MEASURED | [@mills] |
| Lateral (azimuth) error | 11° own HRTF; 17-18° worst-rated non-individual HRTFs (mean of 10 sessions); localisation blur 9-12° vs 16-19° | 20 listeners, virtual sources | MEASURED | [@stitt] |
| Polar error (elevation and front/back) | 34° ± 5° own HRTF, 18 listeners; 29° own HRTF, 14 listeners (Middlebrooks, as quoted) | sources within ±30° lateral | MEASURED / REPORTED | [@majdak14] |
| Quadrant errors (front/back, up/down) | 9.3 % ± 6.0 own HRTF; 7.7 % (Middlebrooks, as quoted); model-predicted 10-30 % for a well-matched generic HRTF, 30-50 % for a poorly matched one | same | MEASURED / model | [@majdak14] [@jenny] |
| Front/back reversals rated in VR | 0 % own HRTF; 27 % (21 of 78) generic KEMAR HRTF; 6 % and 24 % for best and worst model-selected generic HRTF | 39 listeners rating audiovisual scenes, not pointing | MEASURED | [@jenny] |
| Generic HRTF, first test | accurate for 12 of 16 listeners; 4 had poor elevation; many front/back and up/down confusions, more than free field | abstract only | MEASURED | [@wenzel] |
| Foreign HRTF, frequency-scaled | scaling more than halved the penalty of another person's HRTF in most cases | abstract only | MEASURED | [@midd] |

- **Head rotation helps (MEASURED).** Front/back confusions made with the head restricted nearly disappeared when head movement was encouraged [@wk99] (abstract only). With hard-to-localise noise, a 4° rotation window already reduced them significantly and about 32° nearly eliminated them; elevation error fell with rotation (about 14° at a 2° window, 16° of rotation needed for a significant gain); lateral error did not change; 8 listeners [@mcanally]. An earlier study quoted there saw a marked drop at 2.6° and elimination near 20°.
- **Does the listener's own control of rotation, with no head tracker, work like head turning? Probably yes for front/back, not proven for our case.** Wightman and Kistler, experiment 2: head restricted; when the experimenter moved the source nothing improved, when the listener moved the source front/back confusions disappeared [@wk99] (MEASURED, abstract only). That is the closest published analogue of yawing a drone with a stick: the scene turns under the pilot's own command with no vestibular signal. Counter-evidence (REPORTED through [@mcanally]): Kim et al. 2013 concluded vestibular information was necessary and sufficient for the head-movement benefit and proprioception did not help, but their conditions were active head, passive head and body movement with the head fixed, not listener-controlled source motion.
- **The motion cue can override the spectrum (MEASURED, abstract only).** A source made to move as a frontal one would in response to head turns was heard in front even when it was behind; the effect was strongest for sounds low-passed at 500 Hz and weaker as the cut-off rose, and high-frequency-rich sounds flickered between front and back [@brimijoin]. Design consequence (INFERRED): give every beacon low-frequency energy, and rotate the audio scene at once and in proportion to commanded yaw.
- **Gap.** I found no study of rate-commanded rotation (a stick) in a flight-like task, and none of stick yaw and elevation judgements. Expect a smaller benefit than natural head turns; it must be tested (section 9).

## 3. Distance perception

| Cue | Over headphones | Accuracy / numbers | Tag | Src |
|---|---|---|---|---|
| Level | yes, the dominant cue; free field loses 6 dB per doubling of distance | judged distance follows a compressive power law r' = k·r^a with a < 1: near sources overestimated, far ones underestimated | MEASURED (review) | [@kolarik] |
| Distance discrimination | virtual sources, level and reverberation | thresholds about 0.8 m at 2 m and 1.5 m at 5 m for blind listeners, larger for sighted; blind listeners are better at relative, worse at absolute judgements | MEASURED (review) | [@kolarik] |
| Direct-to-reverberant ratio (DRR) | yes, needs a simulated room | noise-burst DRR JND 2-3 dB at 0 and +10 dB, 6-8 dB at -10 and +20 dB; blind listeners used level and DRR cues more effectively than sighted | MEASURED (review) | [@kolarik] |
| High-frequency loss | weak at track distances | "spectral cues do not provide distance information" for 1-15 m; computed air loss at 20 °C, 50 % RH, at 10 / 30 / 100 m: 4 kHz 0.3 / 0.9 / 3.0 dB, 8 kHz 1.1 / 3.2 / 10.5 dB | REPORTED / INFERRED | [@kolarik] |
| Near-field ILD | only inside about 1 m; beyond 1 m ILD no longer depends on distance | | MEASURED (review) | [@kolarik] |
| Motion parallax, acoustic tau | help beyond 2 m only; ambiguous without known speed | | MEASURED (review) | [@kolarik] |
| Tempo (repetition rate) | no accuracy figure for tempo as a distance code found; across sonification studies distance is mapped to loudness in 12 uses and to pitch in 8 [@dubus]; in VR aiming guidance, 24 sighted participants preferred pitch and tempo combined [@apavou] | | REPORTED | [@dubus] [@apavou] |

- **Looming (MEASURED, abstract only).** Rising level changes loudness more than the same fall; approaching sounds were judged to start and stop closer than equidistant receding ones, more for tones than for noise [@neuhoff]. Time to arrival was generally underestimated, least for bands centred on 120-250 Hz and most for 2-7.5 kHz (Gordon et al., as reported in [@kolarik]); another author warns that end level, not change, may drive such judgements [@kolarik]. Design (INFERRED): the bias errs on the safe side (hazards seem nearer); keep arrival-timing beacons rich in low frequencies and avoid stacking contradictory cues.
- **Doppler (INFERRED).** At 20 m/s relative speed the shift is +6.2 % (+1.04 semitone) approaching and -5.5 % (-0.98 semitone) receding: easy to hear and a natural "gate passed" cue. The Web Audio spec text has no Doppler [@waspec]; implement it with resampling or a variable delay line.
- **Implication (INFERRED).** Raw 1/r level over a 5-200 m course spans 32 dB, while judged distance is compressive and discrimination is coarse. Code distance redundantly and exaggerate it: a level slope gentler than 6 dB per doubling, DRR that falls with distance, a low-pass that starts earlier than physics (air loss is under 1 dB at 4 kHz up to 30 m), a repetition rate that rises as a gate nears, and an ILD boost inside 1-2 m. Calibrate each code with pointing or ranking tests with blind pilots; I found no published figures for this combination.

## 4. Elevation over headphones

**Why it is weak.**
- Elevation rests on pinna spectral cues between 4 and 16 kHz: a one-octave notch whose lower edge rises with elevation (frontal sources), a peak at 7-9 kHz ("above") and a small peak at 10-12 kHz ("behind") [@hebrank] (abstract only). They are personal. With another person's HRTF, features lying lower in frequency make low frontal targets sound low and behind, and high rear targets high and in front; features lying higher bias elevation upward [@midd] (abstract only).
- Even with the listener's own HRTF the polar error is about 30° [@majdak14], against a vertical MAA of 3.65° and a horizontal one of 0.97° for real sources [@perrott].
- Over bone conduction, elevated sources were compressed into a window of about ±15° around the horizontal plane (preliminary) [@barde] (abstract only).
- In the browser (INFERRED from source [@chrelev]): the built-in HRTF panner does not interpolate elevation; it takes the 15° slice at or below the requested angle (error up to 15°, mean 7.5° low) and clamps below -45°.

| Remedy | Evidence | Size of effect | Cost |
|---|---|---|---|
| Own HRTF | quadrant errors 8-9 % vs 10-50 % with generic [@majdak14] [@jenny]; head-tracked own-HRTF display close to free field [@romigh2] | largest | measurement or 3D scan (sections 6-7) |
| Frequency scaling of a foreign HRTF | penalty more than halved in most cases [@midd] | large | needs a per-listener scale estimate |
| Best-of-N selection | section 7 | medium | about 5 min |
| Training with feedback | elevation error down 10° after three 12-minute sessions [@parseihian]; 15° more improvement than procedural learning over 10 sessions, but only 3 of 8 listeners reached own-HRTF level [@stitt]; two 30-minute sessions cut reversals for 4 of 5 listeners, lasting at least 4 months [@zahorik06] | 10-15° | 36 min to 10 sessions; game-like |
| Pitch-height mapping (Pratt effect) | higher-pitched tones are heard higher, also by congenitally blind people and young children [@roffler]; shown for complex tones, while a square wave follows true position [@cabrera]; mirrors natural scene statistics and ear filtering [@parise] | a free redundant cue that also biases perceived elevation | mapping tuned to the course |
| Yaw (azimuth) rotation | elevation error falls with azimuth rotation [@mcanally] | up to a few degrees | free with stick yaw |

Design (INFERRED): treat elevation as a coarse cue (below / level / above, then bands), always pair it with a pitch or timbre code, and ship a short ear-training game.

## 5. Web Audio in Chrome and Edge (2026)

Edge is Chromium, so Chrome facts apply to it. Source files read on 2026-11-07 from the Chromium mirror (main branch).

### 5.1 What `panningModel = "HRTF"` does (MEASURED from source)

| Item | Value |
|---|---|
| Dataset | composite `IRC_Composite_C_R0195`: "a set of composite impulse responses generated from several individuals" [@rogers]; "derived from IRCAM Listen Project measurements", "Listen project data is public domain" (REPORTED, bug comments) [@mozbug]. Same data in Gecko [@gecko] and WebKit [@webkit]; the spec names no dataset [@waspec] |
| Grid | 24 azimuths (15° steps) x 10 elevations (-45 to +90, 15° steps) = 240 responses, 256 frames each at 44.1 kHz (5.8 ms), resampled to the context rate [@chrelev] |
| Azimuth | interpolated x8 to 192 positions (1.875°) in the frequency domain; each ear's average group delay is removed from the response and re-applied by a fractional delay line, interpolated continuously [@chrelev] |
| Elevation | not interpolated: slice = floor((elevation + 45) / 15), clamped to -45...+90 [@chrelev] |
| Convolution | FFT 512 at 44.1 and 48 kHz (1024 at 96 kHz); a stereo input uses the left HRTF for L and the right HRTF for R [@chrpanner] |
| Update rate | k-rate: position is read once per 128-frame quantum; a-rate is "not implemented" (code comment: 15-20x more complex). When the azimuth index or elevation changes, a 2048-frame (43 ms at 48 kHz) crossfade runs two kernel sets, so 4 convolvers instead of 2 [@chrpanner] |
| Latency | 256 frames = 5.3 ms at 48 kHz (5.8 ms at 44.1 kHz), plus tail [@chrpanner] |
| Custom HRTF | none. The spec only says "convolution with measured impulse responses from human subjects", stereo output, k-rate [@waspec]. `loadHRTFDatabase` request #2417 is open, last update 2025-05 [@waissue2417]; the custom-SOFA request was closed in 2019 with "to be handled in #21" [@waissue17]; IRCAM, Nov 2023: "nothing has changed with regard to loading custom HRTFs" [@ircamforum] |

PlayCanvas (MIT, active): `SoundInstance3d` calls `createPanner()`, and none of the six files in `src/platform/sound` mentions `HRTF` or `panningModel`, so shipped 3D sound uses the default equal-power panner, not HRTF, with a linear distance model [@pcsound]. Setting `instance.panner.panningModel = 'HRTF'` is needed (INFERRED).

### 5.2 CPU cost, own benchmark

Chrome 156.0.8078.80 (headless), Windows 10, Core i9-7980XE (2017 desktop, 18 cores; one audio rendering thread matters). `OfflineAudioContext`, stereo, 48 kHz, 10 s; each source is looped noise through the node under test on rings of 5-11 m radius; "moving" = two revolutions in 10 s with `setValueCurveAtTime` on X, Y, Z. Cost = render time / 10 s, one run per cell (the first N=1 run was discarded: it includes loading the HRTF set), expect about ±10 %. Offline rendering is a lower bound for real-time load (INFERRED).

| Sources | 8 | 16 | 32 | 64 | 128 |
|---|---|---|---|---|---|
| HRTF PannerNode, static | 1.3 % | 2.6 % | 5.3 % | 12.2 % | 23.3 % |
| HRTF PannerNode, moving | 9.8 % | 20.1 % | 40.9 % | 84.6 % | 173 % |
| equalpower PannerNode, static | - | - | 2.3 % | - | 9.1 % |
| ConvolverNode, 256-tap stereo IR, static | 2.3 % | 4.8 % | 10.1 % | 20.8 % | - |
| AudioWorklet, plain JS FIR, 2 x 256 taps | 26.7 % | 52.1 % | 105.8 % | - | - |
| AudioWorklet, plain JS FIR, 2 x 128 taps | - | 27.3 % | 55.2 % | - | - |

- **How many sources (INFERRED from the table).** At 50 % of one core this CPU carries about 37 moving or 270 static built-in HRTF sources. School laptops are unknown; assuming 3x slower, a safe MVP budget is 8 moving plus 24 static sources (about 15 % here, 45 % there).
- **Alternative engine.** A native `ConvolverNode` with a 256-tap stereo HRIR costs 0.32 % per static source; a moving source needs two nodes crossfaded, about 0.64 % (INFERRED), half of the built-in panner. Plain JavaScript FIR in an AudioWorklet costs 3.3 % per source at 256 taps, ten times more; a real engine needs WASM SIMD or partitioned FFT convolution (INFERRED). `ConvolverNode` accepts 1-, 2- or 4-channel responses [@waspec]. Chrome 156 rejected 36- and 64-channel `AudioBuffer`s (limit 32, the spec minimum), so orders 5+ need two buses (MEASURED).
- **SOFA in the browser.** IRCAM converted SOFA to JSON and loaded it into a `ConvolverNode` [@waissue17]; `libmysofa` reads SOFA in C [@libmysofa] (WASM build: INFERRED, not tested).

### 5.3 Output latency on Windows

- **Measured here:** default output device, 48 kHz: `baseLatency` 10 ms and `outputLatency` 40 ms for "interactive", "balanced", 0 and 0.002; 20 ms and 48 ms for "playback" and 0.02; `destination.maxChannelCount` = 2. The spec defines `outputLatency` as the time from handing a buffer to the OS until the sound is produced [@waspec]. Values depend on the device.
- **Why:** shared-mode default buffer 10 ms; drivers may offer 128-480 frames (2.7-10 ms) through `IAudioClient3`; engine latency 1.3 ms since Windows 10 [@mslowlat]. Chrome's "interactive" hint takes the hardware buffer size on Windows and asks for the minimum `IAudioClient3` period only when the requested buffer equals it [@chrlat].
- **Total (INFERRED sum):** 60 Hz frame 16.7 ms + panner 5.3 ms + 10 + 40 ms is about 70 ms from stick to ear on this machine. Measure it by loopback before relying on it.
- **Bluetooth (MEASURED, trade press, impulse response):** SBC 248 ms vs aptX Low Latency 34 ms on one headset; SBC 181 ms vs aptX 112 ms on another; aptX Low Latency 31 and 54 ms on two more, true-wireless slower [@sss]. LE Audio claims of about 20 ms are vendor claims I could not verify. Use wired headphones for tests; any wireless set must pass a loopback test (INFERRED target: under 50 ms).

## 6. Open libraries and datasets

Licence, last push and archive flag read from the GitHub API on 2026-11-07 [@gh]. "Cost" for decoders is my measured ConvolverNode bank (section 1), not the library itself.

| Item | Licence | Maintained? | What it is / cost | Bundle in an MIT or Apache web app? |
|---|---|---|---|---|
| Built-in HRTF (Chrome, Edge, Firefox, Safari) | engine BSD-style [@chrpanner]; data "public domain" (REPORTED, bug comments) [@mozbug] | yes | fixed set, nothing to download; section 5 | nothing to bundle |
| Omnitone 2.0 | Apache-2.0 | yes: commit "Release 2.0.0" on 2026-09-19 | FOA and HOA to order 3 (16 ch) with GainNode + ConvolverNode and SADIE filters [@omnitone]; decoder cost 1.2 % (FOA), 4.7 % (order 3) | yes |
| Resonance Audio Web SDK | Apache-2.0 | no: archived, last push 2022-03-08; built on Omnitone [@omnitone] | FOA/HOA scene with rooms | yes, unmaintained |
| JSAmbisonics | BSD-3-Clause | low: v0.4.0 in 2022, one commit 2026-09-17 | mono encoder, scene rotator, binaural decoder with user HRTF filters, order limiter [@jsamb] | yes |
| IRCAM binauralFIR | BSD-3-Clause | no: last push 2017-03-06 | binaural FIR node; reference code | yes, as reference |
| IEM Plugin Suite | GPLv3, up to order 7 [@iem] | yes | DAW plug-ins, not web | no; offline tool only |
| libmysofa | BSD-style, Symonics / C. Hoene [@libmysofa] | yes: push 2026-10-25 | SOFA reader in C | yes; WASM build not tested |
| Tone.js | MIT | yes: push 2026-11-01 | music framework; I did not evaluate its spatial nodes | yes; not needed |
| Mesh2HRTF | EUPL-1.2 | yes: push 2026-07-14 | computes HRTFs from 3D head meshes, offline | no (copyleft); use as a tool |
| Steam Audio | Apache-2.0 | yes: push 2026-03-25 | C API object renderer; I found no browser build | reference only |
| SADIE II | Apache-2.0, (c) 2018 University of York; dataset must be referenced [@sadie] | static | 20 subjects (2 dummy heads, 18 humans); grids 1° (8802 points, dummy), 5° (2818) and 10° (2114); WAV and SOFA | yes, with notice and citation |
| HUTUBS | CC BY 4.0 [@hutubs] | static | 96 subjects: HRTFs, 3D head meshes, anthropometry, headphone responses | yes, with attribution |
| MIT KEMAR | "free with no restrictions on use", authors must be cited [@kemar] | static | 710 positions, -40 to +90° elevation, 1.4 m, 44.1 kHz | yes, with citation |
| CIPIC, ARI, IRCAM LISTEN | not verified: official pages gave 410, 403 or 404, or did not load, on 2026-11-07 | - | - | not until the licence text is read |
| AutoEq | MIT | yes: push 2026-11-05 | headphone equalisation presets | yes |

- **Are generic HRTF sets legally redistributable? (INFERRED, not legal advice.)** Verified permissive: SADIE II (Apache-2.0), HUTUBS (CC BY 4.0), MIT KEMAR (free, cite authors). Browsers already ship the IRCAM-derived composite, with a bug-tracker statement that the Listen data is public domain (REPORTED, secondary). Rule: one `HRTF-LICENSES.md`; keep each set's licence and citation beside its files; do not add ShareAlike or NonCommercial data without reading its licence; keep any personal HRTF or head scan of a pupil on the device (personal data).
- **Maintained 2025-2026 browser library:** only Omnitone 2.0 (Ambisonics, not object-based) and the low-activity JSAmbisonics. GitHub searches found young hobby repositories, no mature object-based SOFA renderer for the browser. We write a thin one (section 9).

## 7. Quick HRTF selection

| Method | How | Time | Evidence of benefit |
|---|---|---|---|
| Orthogonal shortlist | 45 listeners rated 46 LISTEN HRTFs; a subset of 7 covered all judgements, and each of the 7 was somebody's best and somebody's worst [@katz12] [@stitt] | rate 7 sets, minutes | on new subjects, errors were smaller with the best-rated than the worst-rated HRTF (abstract, no figures) [@katz12] |
| Interactive pick in VR | HRTF chosen in about 5 min, then 3 x 12 min training over 5 days; a dry room response sped learning [@pqk21] | 5 min + training | learning faster than earlier studies (abstract only) |
| Direct vs indirect | localisation and subjective-quality rankings of 8 HRTFs; mean correlation positive and significant for some metrics; the best set by one method was above average in the other [@zagala] | two short tests | moderate agreement: either test works, neither is exact |
| Model-based | a sagittal-plane model picked "minimal" and "maximal" deviants: predicted quadrant errors 10-30 % vs 30-50 %, polar 33-42° vs 43-52° [@jenny] | needs the listener's own HRTF | shows the range at stake |

- **How much it helps (INFERRED from the ranges).** Own HRTF 8-9 % quadrant errors, a well-matched generic 10-30 %, a badly matched 30-50 %: a good pick recovers roughly 10-20 percentage points. No study I opened reports the gain of "best of 7" directly.
- **A bad HRTF can be learned, with limits.** Worst-rated sets improved by at least 10° in three sessions and 15° beyond procedural learning in ten; learning varied by listener, 3 of 8 reached own-HRTF level, and no predictor of learning ability was found [@stitt].
- **Protocol to validate (INFERRED).** Seven shortlisted sets, one 60-second find-the-beacon game each (8 azimuths x 3 elevations, scoring front/back and elevation hits), keep the best two, choose by rating: about 8 minutes.

## 8. Headphones and loudness safety

| Choice | Evidence | Recommendation |
|---|---|---|
| Wired vs Bluetooth | Bluetooth SBC 181-248 ms, aptX 112 ms, aptX Low Latency 31-54 ms (section 5.3) [@sss] | wired for every test and for home use of the sim |
| Open-back vs closed | I found no study comparing them for localisation or externalisation. INFERRED: closed-back isolates a noisy classroom and keeps sound in; open-back is lighter and more natural at home but leaks | school: closed-back, circumaural, wired, one identical model per room (one EQ), adjustable for children; home: either, wired |
| Driver quality | left/right sensitivity mismatch changed localisation, some frequency bands matter for front/back, perceived quality tracked spatial impression [@gutierrez] (abstract only) | match L/R below the 0.5 dB ILD threshold [@mills] (INFERRED target); no bass boost, no "surround" mode, OS spatial sound off |
| Noise cancelling | with 80 dB background noise it did not improve performance [@wersenyi] | not needed |
| Bone conduction | commercial sets gave the same detection accuracy for up to 5 frontal horizontal positions [@wersenyi]; elevation compressed to ±15° [@barde] | mobility option, not for the seated MVP (INFERRED) |
| Equalisation | AutoEq (MIT) holds per-model correction presets [@gh]; I found no study quantifying the localisation gain of EQ | start with a per-model preset, check tonal balance by ear, keep an EQ stage in the chain |

**Loudness anchors (REPORTED).** WHO/ITU H.870 (2018): weekly dose not above 80 dBA for 40 h; for children and sensitive users not above 75 dBA for 40 h; warn at 100 % of the weekly allowance; if the warning is ignored the default lowers output below the chosen level [@hearrev]. ITU-T H.872 (game consoles, 2025): same references, children option 75 dBA, rolling 7-day dose, automatic cap of 80 dBA (adult) or 75 dBA (children) without user action [@aiha]. EU Directive 2003/10/EC (workplace noise): 80 / 85 / 87 dBA LEX,8h as lower action, upper action and exposure limit values; an occupational rule, not a limit for children's play [@hearrev]. IEC 62368-1: output limit 100 dBA, 85 dBA or lower regarded as safe [@hearrev]. The 3 dB equal-energy rule follows from H.871's example "89 dBA limits exposure to 5 hours per week" [@hearrev].

| LAeq while playing | 75 dBA | 80 | 85 | 90 | 95 | 100 |
|---|---|---|---|---|---|---|
| Hours per week, children (75 dBA reference) | 40 | 12.6 | 4.0 | 1.3 | 0.40 | 0.13 |
| Hours per week, adults (80 dBA reference) | 126 | 40 | 12.6 | 4.0 | 1.3 | 0.40 |

(INFERRED: hours = 40 x 10^((reference - L)/10).)

**What a software limiter can and cannot enforce (INFERRED).** A page cannot read the OS volume or the headphone sensitivity, and I found no browser API for sound pressure level. At 0.5 V rms into 32 ohm and 100 dB SPL per mW, full scale gives 109 dB SPL, 34 dB over the children reference, so a dBFS number alone proves nothing. Enforce, in this order:
1. Chain end: a lookahead brick-wall limiter (about 5 ms) with a -6 dBFS ceiling, 1 s fade-in on start, resume and device change, no step louder than +12 dB over the nominal bed.
2. School devices: measure SPL once per headphone model, device and volume setting with a calibrated meter and coupler, lock the OS volume by policy, store the dBFS-to-dBA map, and cap the app at 75 dBA (children) or 80 dBA (adults), the H.872 modes.
3. Home devices: no meter, so use a relative setup (reference noise at a comfortable level set by an adult), never raise the master gain above it without an explicit adult action, default low.
4. Dose: after calibration, count minutes x level with the 3 dB rule per week and warn at 100 %.

## 9. Recommended architecture

(draft pending)

## 10. Searched for and not found

(draft pending)

## Sources

(draft pending)
