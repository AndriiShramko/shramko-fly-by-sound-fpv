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

(draft pending)

## 4. Elevation over headphones

(draft pending)

## 5. Web Audio in Chrome and Edge (2026)

(draft pending)

## 6. Open libraries and datasets

(draft pending)

## 7. Quick HRTF selection

(draft pending)

## 8. Headphones and loudness safety

(draft pending)

## 9. Recommended architecture

(draft pending)

## 10. Searched for and not found

(draft pending)

## Sources

(draft pending)
