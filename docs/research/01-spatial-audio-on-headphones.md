# Spatial audio on headphones for a sound-only FPV simulator

Research note 01 for ShramkoSonicFPV, an open-source FPV drone simulator that blind and low-vision pilots can fly by sound alone, in the browser (Web Audio, PlayCanvas, TypeScript), on ordinary good stereo headphones. Written 2026-11-07. Evidence tags: **MEASURED** (a study, spec, source file or my own benchmark gives the number), **REPORTED** (a credible source states it, no measurement I could check), **INFERRED** (my reasoning or calculation). "Abstract only" means I could read only the abstract, so the claim goes no further than it. Citations are [n]. Section 10 lists what I searched for and did not find.

## Summary

- **Encoding:** render each important sound as its own object through a per-source HRTF. On headphones the output is two channels, so 5.1 / 7.1 / 7.1.4 beds add panning error and no resolution; Atmos, DTS:X and Windows Sonic objects are native-only and unreachable from a web page [@mssaudio] (section 1).
- **Ambisonics** only as a fixed-cost ambience bus: order 1 is too coarse, order 3 the minimum, order 4-5 reaches the limit set by the HRTF [@romigh]; a Chrome bus carries 32 channels (order 4), and decoders cost 4.7-21.7 % of a core at orders 3-7 (measured here).
- **Human limits:** azimuth is good (MAA about 1° [@perrott], lateral error 11-18° [@stitt]); elevation and front/back are weak even with own HRTFs (polar error about 30°, 8-9 % quadrant errors) and worse with generic ones (10-50 %) [@majdak14] [@jenny].
- **Yaw by stick:** a listener-moved source removed front/back confusions with the head still [@wk99]; 32° of head rotation nearly eliminates them [@mcanally]; vestibular input may matter. Likely useful, unproven for a stick: test first.
- **Distance:** level and DRR work but are compressive and coarse (blind listeners: 0.8 m at 2 m, 1.5 m at 5 m) [@kolarik]; air absorption is negligible at track distances (computed); code distance redundantly and exaggerate it.
- **Elevation:** the HRTF alone is not enough: add a pitch-height code (works for blind people [@roffler]), coarse bands and short ear training (10-15° gain [@parseihian] [@stitt]).
- **Web Audio:** the built-in HRTF panner is one IRCAM composite, azimuth 1.9° steps, elevation 15° steps rounded down, +5.3 ms, 0.18 % (static) to 1.3 % (moving) of a core per source, and cannot load another HRTF [@chrpanner] [@waissue2417]. MVP: 8 moving + 24 static sources (about 15 % of a core here); later: own ConvolverNode/AudioWorklet engine with SADIE II or HUTUBS data.
- **Latency:** about 70 ms stick-to-ear on Windows (measured parts, summed); Bluetooth SBC adds 180-250 ms [@sss]: wired headphones only.
- **Licences:** SADIE II (Apache-2.0) [@sadie], HUTUBS (CC BY 4.0) [@hutubs] and MIT KEMAR (free, cite) [@kemar] can ship in an MIT or Apache app; CIPIC, ARI and LISTEN terms are unverified.
- **Safety and headphones:** children's reference is 75 dBA for 40 h/week (WHO/ITU) [@hearrev]; a page cannot know SPL, so calibrate school devices once, cap at 75/80 dBA, limiter at the chain end; closed-back wired headphones with matched channels, OS spatial sound off.
- **Test with people** (section 9): stick yaw vs static, built-in vs best-of-7 HRTF, elevation and distance codes, latency, double spatialisation, loudness.

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
- **Order vs perception.** Loudspeaker-ring tests with order 1-4 microphones: localisation improved with order [@bertet] (abstract only). An HRTF represented at order 4 or higher kept accurate localisation, and even order 1 keeps several physical cues [@romigh] (abstract only). Models predict accuracy rising with order (tested 1-44), methods differ mostly at low orders, and the magnitude-least-squares family is recommended [@engel] (abstract only). Low order lowers ILD [@mckenzie] and rolls off high frequencies [@benhur]. INFERRED: order N represents the head response only up to about f = N·c / (2π·0.0875 m), that is 0.6 kHz (N=1), 1.9 kHz (N=3), 3.1 kHz (N=5), 4.4 kHz (N=7), while pinna cues sit at 4-16 kHz [@hebrank], so every practical order needs high-frequency magnitude correction [@zaun] [@engel]. Order does not repair a mismatched HRTF (section 2).
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
| Dataset | composite `IRC_Composite_C_R0195`: "a set of composite impulse responses generated from several individuals" [@rogers]; "derived from IRCAM Listen Project measurements", "Listen project data is public domain" (REPORTED, bug comments) [@mozbug]. Same data in Gecko and WebKit [@gecko]; the spec names no dataset [@waspec] |
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

**MVP: built-in HRTF panner, thin own audio layer.**

| Decision | Choice | Basis |
|---|---|---|
| Sources at once | at most 8 moving + 24 static spatialised voices; steal by priority (next gates, hazards, ground, ambience) | about 15 % of one core here (5.2) |
| Panner | built-in `PannerNode`, `panningModel = 'HRTF'`, listener-relative positions, own distance gain; add 7.5° to elevation to centre the 15° rounding (INFERRED) | no dependency; fixed set, +5.3 ms |
| HRTF | the built-in composite; record that fact; no personalisation yet | the API cannot load another (5.1) |
| Azimuth, front/back | low-frequency energy in every beacon; scene yaws at once and in proportion to stick yaw; test an exaggerated marker (rear: +3-6 dB at 10-12 kHz; front: notch plus lift above 13 kHz [@hebrank]) | [@wk99] [@brimijoin] |
| Elevation | HRTF + pitch-height code + coarse bands; 10-minute ear-training game | sections 2, 4 |
| Distance | gentle level slope, reverb send, early low-pass, rising repetition rate, ILD boost under 2 m, own Doppler | section 3 |
| Output | brick-wall limiter, 1 s fade-in, OS spatial sound off, wired closed-back headphones | 5.3, 8 |

**Later, high-quality version.**
- Own renderer: per-source direct HRTF from SOFA sets (SADIE II 5° or 10° human sets, HUTUBS); two crossfaded ConvolverNodes per source first, then an AudioWorklet with WASM SIMD partitioned convolution, ITD alignment and barycentric direction interpolation (INFERRED); 16+ direct objects.
- Ambience bus: Ambisonics order 3 (at most order 4 on one bus) for wind, ground and room tail, with a magnitude-least-squares-type decoder; 16 objects plus order 3 is about 25 % of a core here (INFERRED sum).
- Personalisation: 7-set shortlist, 8-minute pick, ear training, optional frequency-scale estimate; Mesh2HRTF only as research. VR: head pose added to stick yaw, audio update under 50 ms (INFERRED target).

**Must be tested with people (baselines in sections 2-8).** (1) Front/back with static scene, stick yaw and experimenter-driven rotation, same HRTF, blind/low-vision and sighted groups apart, outcome = quadrant errors. (2) Built-in set vs best of 7 SADIE II/HUTUBS sets: pointing errors and gate-pass rate. (3) Elevation codes: HRTF only, plus pitch, plus 3 x 12 min training. (4) Distance codes: ranking and gate-arrival timing, level-only vs redundant. (5) Stick-to-ear loopback latency, with 0/50/100/200 ms added. (6) Headphones: closed vs open, wired models, L/R balance, child comfort. (7) Double spatialisation with Windows Sonic or Atmos on and off. (8) SPL per device and volume at school, limiter behaviour. (9) School laptops: 8 moving + 24 static for 30 minutes, count underruns. (10) Sessions to criterion and retention after one week.

## 10. Searched for and not found

- No study of rate-commanded rotation (a stick) and front/back or elevation judgements in a flight-like task; closest is the listener-moved source of [@wk99]. No measured accuracy of tempo as a distance code, no distance-exponent values (only a < 1), no looming time-to-contact study with binaural HRTF rendering.
- No comparison of open-back and closed-back headphones for localisation, and no study quantifying the gain of headphone EQ (a headphone-compensation paper appeared only as a search snippet, not opened). I did not open EN 50332 or the EU toy standard; the only EU limit I read is the occupational Directive 2003/10/EC.
- Could not open: Engel 2022 full text (403), Thresh et al. 2017 on Ambisonics order (AES, 403: dropped), the Zotter and Frank Ambisonics book (Springer cookie redirect), PubMed Central pages (CAPTCHA, not bypassed), HAL (bot check), AES library, MDPI and web.archive.org (blocked). Where I read only an abstract, the claim stops at the abstract.
- Licence text not verified: CIPIC (410), ARI (403/404), IRCAM LISTEN (unreachable). LE Audio latency: no primary or independent figure found. ISO 9613-1: not opened, I computed air absorption from its published formula and checked it against table values quoted in a secondary source.
- No maintained 2025-2026 browser object-based SOFA renderer, no Steam Audio browser build, no public PannerNode HRTF performance numbers besides mine. Mine are one machine, one Chrome build, offline rendering, single runs: an order of magnitude, not a benchmark.
- Not searched: anthropometry- or photo-based HRTF personalisation, head-tracker latency thresholds, per-device LE Audio tests.

## Sources

Opened on 2026-11-07. "Abstract only" = I read the abstract through the DOI or an open metadata record, not the full text.

- [@mssaudio] Microsoft, Spatial Sound for app developers (beds, dynamic object limits). https://learn.microsoft.com/en-us/windows/win32/coreaudio/spatial-sound
- [@romigh] Romigh, Brungart, Stern, Simpson 2015, Efficient real spherical harmonic representation of HRTFs, IEEE JSTSP (abstract only). https://doi.org/10.1109/jstsp.2015.2421876
- [@perrott] Perrott, Saberi 1990, Minimum audible angle thresholds for sources varying in both elevation and azimuth, JASA 87 (abstract only). https://doi.org/10.1121/1.399421
- [@stitt] Stitt, Picinali, Katz 2019, Auditory accommodation to poorly matched non-individual spectral localization cues through active learning, Sci. Rep. 9. https://doi.org/10.1038/s41598-018-37873-0
- [@majdak14] Majdak, Baumgartner, Laback 2014, Acoustic and non-acoustic factors in modeling listener-specific performance of sagittal-plane sound localization, Front. Psychol. 5:319. https://doi.org/10.3389/fpsyg.2014.00319
- [@jenny] Jenny, Reuter 2020, Usability of individualized HRTFs in virtual reality, JMIR Serious Games 8(3):e17576. https://doi.org/10.2196/17576
- [@wk99] Wightman, Kistler 1999, Resolution of front-back ambiguity in spatial hearing by listener and source movement, JASA 105 (abstract only). https://doi.org/10.1121/1.426899
- [@mcanally] McAnally, Martin 2014, Sound localization with head movement: implications for 3-d audio displays, Front. Neurosci. 8:210. https://doi.org/10.3389/fnins.2014.00210
- [@kolarik] Kolarik, Moore, Zahorik, Cirstea, Pardhan 2016, Auditory distance perception in humans: a review of cues, development, neuronal bases, and effects of sensory loss, Atten. Percept. Psychophys. 78. https://doi.org/10.3758/s13414-015-1015-1
- [@roffler] Roffler, Butler 1968, Localization of tonal stimuli in the vertical plane, JASA 43 (abstract only). https://doi.org/10.1121/1.1910977
- [@parseihian] Parseihian, Katz 2012, Rapid head-related transfer function adaptation using a virtual auditory environment, JASA 131 (abstract only). https://doi.org/10.1121/1.3687448
- [@chrpanner] Chromium, hrtf_panner.cc. https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/audio/hrtf_panner.cc
- [@waissue2417] W3C Web Audio issue 2417, loadHRTFDatabase for SpatialPanner. https://github.com/WebAudio/web-audio-api/issues/2417
- [@sss] SoundStage Solo, Latency: a new concern for audiophiles (Bluetooth impulse-response measurements). https://www.soundstagesolo.com/index.php/features/185-latency-a-new-concern-for-audiophiles
- [@sadie] SADIE II database, University of York. https://www.york.ac.uk/sadie-project/database.html
- [@hutubs] HUTUBS HRTF database, TU Berlin, DataCite record (CC BY 4.0). https://doi.org/10.14279/depositonce-8487 (record read at https://depositonce.tu-berlin.de/signposting/describedby/dc2a3076-a291-417e-97f0-7697e332c960)
- [@kemar] MIT Media Lab, KEMAR HRTF measurements (Gardner, Martin 1994). https://sound.media.mit.edu/resources/KEMAR.html
- [@hearrev] Hearing Review 2020, Standards for safe listening: past, present and future (H.870, H.871, Directive 2003/10/EC, IEC 62368-1). https://hearingreview.com/hearing-loss/hearing-loss-prevention/risk-factors/standards-for-safe-listening-past-present-and-future
- [@chrlat] Chromium Windows audio: 30 files scanned in https://github.com/chromium/chromium/tree/main/media/audio/win ; https://raw.githubusercontent.com/chromium/chromium/main/media/audio/win/audio_low_latency_output_win.cc ; https://raw.githubusercontent.com/chromium/chromium/main/media/base/audio_latency.cc
- [@waspec] W3C Web Audio API editor's draft (source). https://raw.githubusercontent.com/WebAudio/web-audio-api/main/index.bs
- [@mckenzie] McKenzie, Murphy, Kearney 2019, Interaural level difference optimization of binaural Ambisonic rendering, Appl. Sci. 9(6):1226 (abstract only). https://doi.org/10.3390/app9061226
- [@zaun] Zaunschirm, Schörkhuber, Höldrich 2018, Binaural rendering of Ambisonic signals by HRIR time alignment and a diffuseness constraint, JASA 143 (abstract only). https://doi.org/10.1121/1.5040489
- [@bertet] Bertet, Daniel, Parizet, Warusfel 2013, Investigation on localisation accuracy for first and higher order Ambisonics reproduced sound sources, Acta Acust. 99 (abstract only). https://pure.qub.ac.uk/en/publications/investigation-on-localisation-accuracy-for-first-and-higher-order/
- [@engel] Engel, Goodman, Picinali 2022, Assessing HRTF preprocessing methods for Ambisonics rendering through perceptual models, Acta Acust. 6:4 (abstract only). https://doi.org/10.1051/aacus/2021055
- [@benhur] Ben-Hur, Brinkmann, Sheaffer, Weinzierl, Rafaely 2017, Spectral equalization in binaural signals represented by order-truncated spherical harmonics, JASA 141 (abstract only). https://doi.org/10.1121/1.4983652
- [@hebrank] Hebrank, Wright 1974, Spectral cues used in the localization of sound sources on the median plane, JASA 56 (abstract only). https://doi.org/10.1121/1.1903520
- [@romigh2] Romigh, Brungart, Simpson 2015, Free-field localization performance with a head-tracked virtual auditory display, IEEE JSTSP (abstract only). https://doi.org/10.1109/jstsp.2015.2421874
- [@selftrans] Self-translation induced minimum audible angle, JASA 144, 2018 (abstract only). https://doi.org/10.1121/1.5064957
- [@mills] Mills 1958, On the minimum audible angle, JASA 30 (abstract only). https://doi.org/10.1121/1.1909553
- [@midd] Middlebrooks 1999, Virtual localization improved by scaling nonindividualized external-ear transfer functions in frequency, JASA 106 (abstract only). https://doi.org/10.1121/1.427147
- [@brimijoin] Brimijoin, Akeroyd 2012, The role of head movements and signal spectrum in an auditory front/back illusion, i-Perception 3 (abstract only). https://doi.org/10.1068/i7173sas
- [@dubus] Dubus, Bresin 2013, A systematic review of mapping strategies for the sonification of physical quantities, PLOS ONE 8(12):e82491. https://doi.org/10.1371/journal.pone.0082491
- [@apavou] Apavou, Bouchara, Bourdot 2024, Accessibility of shooting task for blind and visually impaired: a sonification method comparison, ICAD (abstract only). https://doi.org/10.21785/icad2024.012
- [@neuhoff] Neuhoff 2001, An adaptive bias in the perception of looming auditory motion, Ecol. Psychol. 13 (abstract only). https://doi.org/10.1207/s15326969eco1302_2
- [@barde] Barde, Lee, Helton, Billinghurst 2016, Binaural spatialisation over a bone conduction headset: elevation perception, ICAD (abstract only). https://doi.org/10.21785/icad2016.013
- [@chrelev] Chromium, hrtf_elevation.cc (also hrtf_database.cc, hrtf_kernel.cc and resources/README in the same directory). https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/audio/hrtf_elevation.cc
- [@zahorik06] Zahorik, Bangayan, Sundareswaran, Wang, Tam 2006, Perceptual recalibration in human sound localization: learning to remediate front-back reversals, JASA 120 (abstract only). https://doi.org/10.1121/1.2208429
- [@cabrera] Cabrera, Morimoto 2007, Influence of fundamental frequency and source elevation on the vertical localization of complex tones and complex tone pairs, JASA 122 (abstract only). https://doi.org/10.1121/1.2736782
- [@parise] Parise, Knorre, Ernst 2014, Natural auditory scene statistics shapes human spatial hearing, PNAS 111 (abstract only). https://doi.org/10.1073/pnas.1322705111
- [@rogers] Chris Rogers, W3C public-audio mail on the WebKit composite HRTF set, 2012. https://lists.w3.org/Archives/Public/public-audio/2012OctDec/0338.html
- [@mozbug] Mozilla bug 865241, import of Blink HRTF data (comments 3, 17-20). https://bugzilla.mozilla.org/show_bug.cgi?id=865241
- [@gecko] Gecko HRTFElevation.cpp with IRC_Composite_C_R0195-incl.cpp, and the WebKit resources directory with IRC_Composite_C_R0195_*.wav. https://github.com/mozilla/gecko-dev/tree/master/dom/media/webaudio/blink ; https://github.com/WebKit/WebKit/tree/main/Source/WebCore/platform/audio/resources
- [@waissue17] W3C web-audio-api-v2 issue 17, Permit loading of custom HRTFs (including SOFA). https://github.com/WebAudio/web-audio-api-v2/issues/17
- [@ircamforum] IRCAM Forum, Using SOFA files in the browser, Nov 2023. https://discussion.forum.ircam.fr/t/using-sofa-files-in-the-browser/62341
- [@pcsound] PlayCanvas engine (MIT), src/platform/sound/instance3d.js. https://github.com/playcanvas/engine/blob/main/src/platform/sound/instance3d.js
- [@libmysofa] libmysofa, LICENSE. https://github.com/hoene/libmysofa/blob/main/LICENSE
- [@mslowlat] Microsoft, Low Latency Audio (Windows 10 audio stack). https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio
- [@gh] GitHub API metadata (licence, archived flag, last push), read 2026-11-07: https://github.com/GoogleChrome/omnitone ; https://github.com/resonance-audio/resonance-audio-web-sdk ; https://github.com/polarch/JSAmbisonics ; https://github.com/Ircam-RnD/binauralFIR ; https://github.com/Tonejs/Tone.js ; https://github.com/hoene/libmysofa ; https://github.com/Any2HRTF/Mesh2HRTF ; https://github.com/ValveSoftware/steam-audio ; https://github.com/jaakkopasanen/AutoEq
- [@omnitone] Omnitone README. https://github.com/GoogleChrome/omnitone/blob/master/README.md
- [@jsamb] JSAmbisonics README. https://github.com/polarch/JSAmbisonics/blob/master/README.md
- [@iem] IEM Plugin Suite. https://plugins.iem.at/
- [@katz12] Katz, Parseihian 2012, Perceptually based head-related transfer function database optimization, JASA 131 (abstract only). https://doi.org/10.1121/1.3672641
- [@pqk21] Poirier-Quinot, Katz 2021, On the improvement of accommodation to non-individual HRTFs via VR active learning and inclusion of a 3D room response, Acta Acust. 5 (abstract only). https://doi.org/10.1051/aacus/2021019
- [@zagala] Zagala, Noisternig, Katz 2020, Comparison of direct and indirect perceptual head-related transfer function selection methods, JASA 147 (abstract only). https://doi.org/10.1121/10.0001183
- [@gutierrez] Gutierrez-Parera, López 2016, Influence of the quality of consumer headphones in the perception of spatial audio, Appl. Sci. 6(4):117 (abstract only). https://doi.org/10.3390/app6040117
- [@wersenyi] Wersényi 2023, Evaluation of bone conduction and active-noise-cancellation headsets based on listening tests in a virtual environment, Infocommun. J. 15(3) (abstract only). https://doi.org/10.36244/icj.2023.3.6
- [@aiha] AIHA 2025, New standard sets sound level guidelines for video game consoles (ITU-T H.872). https://www.aiha.org/news/250313-new-standard-sets-sound-level-guidelines-for-video-game-consoles
