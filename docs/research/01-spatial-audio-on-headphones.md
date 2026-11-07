# Spatial audio on headphones for a sound-only FPV simulator
Research note 01 for ShramkoSonicFPV, an open-source FPV drone simulator that blind and low-vision pilots can fly by sound alone, in the browser (Web Audio, PlayCanvas, TypeScript), on ordinary good stereo headphones. Written 2026-11-07. Evidence tags: **MEASURED** (a study, spec, source file or my own benchmark gives the number), **REPORTED** (a credible source states it, no measurement I could check), **INFERRED** (my reasoning or calculation). "Abstract only" means I could read only the abstract, so the claim goes no further than it. Citations are [n]. Section 10 lists what I searched for and did not find.

## Summary
- **Encoding:** render each important sound as its own object through a per-source HRTF. On headphones the output is two channels, so 5.1 / 7.1 / 7.1.4 beds add panning error and no resolution; Atmos, DTS:X and Windows Sonic objects are native-only and I found no browser API that reaches them [1] (section 1).
- **Ambisonics** only as a fixed-cost ambience bus: order 1 is too coarse, order 3 the minimum, order 4-5 reaches the limit set by the HRTF [2]; a Chrome bus carries 32 channels (order 4), and decoders cost 4.7-21.7 % of a core at orders 3-7 (measured here).
- **Human limits:** azimuth is good (MAA about 1° [3], lateral error 11-18° [4]); elevation and front/back are weak even with own HRTFs (polar error about 30°, 8-9 % quadrant errors) and worse with generic ones (10-50 %) [5][6].
- **Yaw by stick:** a listener-moved source removed front/back confusions with the head still [7]; 32° of head rotation nearly eliminates them [8]; vestibular input may matter. Likely useful, unproven for a stick: test first.
- **Distance:** level and DRR work but are compressive and coarse (blind listeners: 0.8 m at 2 m, 1.5 m at 5 m) [9]; air absorption is negligible at track distances (computed); code distance redundantly and exaggerate it.
- **Elevation:** the HRTF alone is not enough: add a pitch-height code (works for blind people [10]), coarse bands and short ear training (10-15° gain [11][4]).
- **Web Audio and latency:** the built-in HRTF panner is one IRCAM composite, azimuth 1.9° steps, elevation 15° steps rounded down, +5.3 ms, 0.18 % (static) to 1.3 % (moving) of a core per source, and cannot load another HRTF [12][13]. MVP: 8 moving + 24 static sources (about 15 % of a core here); later: own ConvolverNode/AudioWorklet engine with SADIE II or HUTUBS data. Stick-to-ear is about 70 ms on Windows (measured parts, summed); Bluetooth SBC adds 180-250 ms [14]: wired headphones only.
- **Licences:** SADIE II (Apache-2.0), HUTUBS (CC BY 4.0) and MIT KEMAR (free, cite) [15] can ship in an MIT or Apache app; CIPIC, ARI and LISTEN terms are unverified.
- **Safety and headphones:** children's reference is 75 dBA for 40 h/week (WHO/ITU) [16]; a page cannot know SPL, so calibrate school devices once, cap at 75/80 dBA, limiter at the chain end; closed-back wired headphones with matched channels, OS spatial sound off.
- **Test with people** (section 9): stick yaw vs static, built-in vs best-of-7 HRTF, elevation and distance codes, latency, double spatialisation, loudness.

## 1. Which encoding loses least on headphones
On headphones the last stage is always two channels, so every format is judged by how much directional detail survives the trip to two ears. CPU figures are my own measurements (Chrome 156, Windows 10, Core i9-7980XE, OfflineAudioContext, 48 kHz, percent of one core; method in 5.2). Beam widths are my own calculation (INFERRED): full width at -3 dB of an order-N max-rE pattern.

| Approach | What happens | Resolution / error | CPU, one core | Verdict |
|---|---|---|---|---|
| 5.1 / 7.1 / 7.1.4 / 8.1.4.4 bed (also the Atmos, DTS, Sonic beds) | one HRTF pair per virtual speaker (12-17 fixed positions, 4 overhead in 7.1.4 [1]); between speakers only amplitude panning | set by speaker spacing; no height below 7.1.4 (INFERRED); fixed vendor HRTF in the OS versions | 6-12 stereo convolutions | reject; OS versions unreachable (below) |
| Atmos / DTS / Sonic dynamic objects | the OS renders each object binaurally; 128 objects on Windows since the May servicing release of build 22621, 0 when spatial sound is off [1] | any position; vendor HRTF the app cannot personalise | native `ISpatialAudioClient` only | not usable from Web Audio |
| Ambisonics order 1 (4 ch) | SH-domain bus, binaural decode | beam 115°; ILD lower than with the HRIR, poor localisation and externalisation [17][18] | 1.2 % | too coarse |
| order 3 (16 ch) | same | beam 56° | 4.7 % | minimum for an ambience bus |
| order 4 (25 ch) | same | beam 45°; an HRTF kept at order 4 still gave accurate localisation (own-HRTF listeners) [2] | 8.0 % | largest order on one 32-channel bus |
| order 5 / 7 (36 / 64 ch) | same | beam 37° / 28°; I found no listening test of 5 vs 7 | 11.7 % / 21.7 % (2 buses) | HRTF-limited at 5; no evidence of benefit at 7 |
| Direct HRTF per source | one HRTF pair per source, direction interpolated | no encoding loss; error = HRTF mismatch (section 2); grid: built-in 1.9° az / 15° el, SADIE II 1° (dummy heads), 5° or 10° [15] | built-in 0.18 % static, 1.3 % moving, per source; ConvolverNode 0.32 % | **recommended** |

- **More speaker channels on headphones: no (INFERRED, supported by [1]).** Windows Sonic, DTS Headphone:X and Atmos "implement speaker mapping and virtualization to headphones", and Doppler, distance filtering, occlusion and reverb stay with the app's own engine [1]. A bed only fixes where the virtual loudspeakers sit; between them the result is panning, and the ears get two channels in every case. A scan of Chromium's 30 Windows audio files (`media/audio/win`) finds no use of `ISpatialAudioClient`, Atmos or Sonic APIs (MEASURED, [12]), and the Web Audio spec has no such interface [19]. Risk to test: with Windows Sonic or Atmos switched on, the OS may spatialise our already binaural stereo a second time.
- **Order vs perception.** Loudspeaker-ring tests with order 1-4 microphones: localisation improved with order [20] (abstract only). An HRTF represented at order 4 or higher kept accurate localisation, and even order 1 keeps several physical cues [2] (abstract only). Models predict accuracy rising with order (tested 1-44), methods differ mostly at low orders, and the magnitude-least-squares family is recommended [21] (abstract only). Low order lowers ILD [17] and rolls off high frequencies [22]. INFERRED: order N represents the head response only up to about f = N·c / (2π·0.0875 m), that is 0.6 kHz (N=1), 1.9 kHz (N=3), 3.1 kHz (N=5), 4.4 kHz (N=7), while pinna cues sit at 4-16 kHz [23], so every practical order needs high-frequency magnitude correction [18][21]. Order does not repair a mismatched HRTF (section 2).
- **Direct rendering is the reference.** A head-tracked headphone display with each listener's own HRTFs matched free-field localisation [24] (abstract only). Any loss in our product is HRTF mismatch, latency or cue design, not encoding.
- **Cost crossover (MEASURED, INFERRED).** A decoder costs the same for any number of sources; a moving built-in HRTF source costs 1.3 %. Order-3 decoding equals 3.6 moving sources, order 5 equals 9, order 7 equals 17 (encoding cost not counted). So direct rendering is cheaper than order 5 below about 9 moving sources and than order 7 below about 17.

## 2. Human localisation limits over headphones
| Quantity | Value | Condition | Tag | Src |
|---|---|---|---|---|
| Minimum audible angle (MAA) | 0.97° azimuth; 3.65° elevation (1.8° with the array tilted 80°) | real sources, 4 listeners; over headphones the resolution matched loudspeakers and the self-translation MAA was 3.3° (abstract only) | MEASURED | [3][25] |
| Interaural thresholds | time difference about 10 µs, level difference about 0.5 dB | tones, optimal conditions, 3 listeners | MEASURED | [26] |
| Lateral (azimuth) error | 11° own HRTF; 17-18° worst-rated non-individual HRTFs (mean of 10 sessions); localisation blur 9-12° vs 16-19° | 20 listeners, virtual sources | MEASURED | [4] |
| Polar error; quadrant errors (front/back, up/down) | own HRTF: polar 34° ± 5°, quadrant 9.3 % ± 6.0 (18 listeners); polar 29°, quadrant 7.7 % (Middlebrooks, 14 listeners, as quoted); model-predicted quadrant errors 10-30 % for a well-matched generic HRTF, 30-50 % for a poorly matched one | sources within ±30° lateral | MEASURED / REPORTED / model | [5][6] |
| Front/back reversals rated in VR | 0 % own HRTF; 27 % (21 of 78) generic KEMAR HRTF; 6 % and 24 % for best and worst model-selected generic HRTF | 39 listeners rating audiovisual scenes, not pointing | MEASURED | [6] |
| Foreign HRTF, frequency-scaled | scaling more than halved the penalty of another person's HRTF in most cases | abstract only | MEASURED | [27] |

- **Head rotation helps (MEASURED).** Front/back confusions made with the head restricted nearly disappeared when head movement was encouraged [7] (abstract only). With hard-to-localise noise, a 4° rotation window already reduced them significantly and about 32° nearly eliminated them; elevation error fell with rotation (about 14° at a 2° window, 16° of rotation needed for a significant gain); lateral error did not change; 8 listeners [8]. An earlier study quoted there saw a marked drop at 2.6° and elimination near 20°.
- **Does the listener's own control of rotation, with no head tracker, work like head turning? Probably yes for front/back, not proven for our case.** Wightman and Kistler, experiment 2: head restricted; when the experimenter moved the source nothing improved, when the listener moved the source front/back confusions disappeared [7] (MEASURED, abstract only). That is the closest published analogue of yawing a drone with a stick: the scene turns under the pilot's own command with no vestibular signal. Counter-evidence (REPORTED through [8]): Kim et al. 2013 concluded vestibular information was necessary and sufficient for the head-movement benefit and proprioception did not help, but their conditions were active head, passive head and body movement with the head fixed, not listener-controlled source motion.
- **The motion cue can override the spectrum (MEASURED, abstract only).** A source made to move as a frontal one would in response to head turns was heard in front even when it was behind; the effect was strongest for sounds low-passed at 500 Hz and weaker as the cut-off rose, and high-frequency-rich sounds flickered between front and back [28]. Design consequence (INFERRED): give every beacon low-frequency energy, and rotate the audio scene at once and in proportion to commanded yaw.
- **Gap.** I found no study of rate-commanded rotation (a stick) in a flight-like task, and none of stick yaw and elevation judgements. Expect a smaller benefit than natural head turns; it must be tested (section 9).

## 3. Distance perception
| Cue | Over headphones | Accuracy / numbers | Tag | Src |
|---|---|---|---|---|
| Level | yes, the dominant cue; free field loses 6 dB per doubling of distance | judged distance follows a compressive power law r' = k·r^a with a < 1: near sources overestimated, far ones underestimated | MEASURED (review) | [9] |
| Distance discrimination | virtual sources, level and reverberation | thresholds about 0.8 m at 2 m and 1.5 m at 5 m for blind listeners, larger for sighted; blind listeners are better at relative, worse at absolute judgements | MEASURED (review) | [9] |
| Direct-to-reverberant ratio (DRR) | yes, needs a simulated room | noise-burst DRR JND 2-3 dB at 0 and +10 dB, 6-8 dB at -10 and +20 dB; blind listeners used level and DRR cues more effectively than sighted | MEASURED (review) | [9] |
| High-frequency loss | weak at track distances | "spectral cues do not provide distance information" for 1-15 m; computed air loss (ISO 9613-1 formula, see section 10) at 20 °C, 50 % RH, at 10 / 30 / 100 m: 4 kHz 0.3 / 0.9 / 3.0 dB, 8 kHz 1.1 / 3.2 / 10.5 dB | REPORTED / INFERRED | [9] |
| Near-field ILD; motion parallax, acoustic tau | ILD only inside about 1 m; parallax and tau help beyond 2 m only | beyond 1 m ILD no longer depends on distance; dynamic cues are ambiguous without known speed | MEASURED (review) | [9] |
| Tempo (repetition rate) | no accuracy figure for tempo as a distance code found; across sonification studies distance is mapped to loudness in 12 uses and to pitch in 8 [29]; in VR aiming guidance, 24 sighted participants preferred pitch and tempo combined [30] | | REPORTED | [29][30] |

- **Looming (MEASURED, abstract only).** Rising level changes loudness more than the same fall; approaching sounds were judged to start and stop closer than equidistant receding ones, more for tones than for noise [31]. Time to arrival was generally underestimated, least for bands centred on 120-250 Hz and most for 2-7.5 kHz (Gordon et al., as reported in [9]); another author warns that end level, not change, may drive such judgements [9]. Design (INFERRED): the bias errs on the safe side (hazards seem nearer); keep arrival-timing beacons rich in low frequencies and avoid stacking contradictory cues.
- **Doppler (INFERRED).** At 20 m/s relative speed the shift is +6.2 % (+1.04 semitone) approaching and -5.5 % (-0.98 semitone) receding: easy to hear and a natural "gate passed" cue. The Web Audio spec text has no Doppler [19]; implement it with resampling or a variable delay line.
- **Implication (INFERRED).** Raw 1/r level over a 5-200 m course spans 32 dB, while judged distance is compressive and discrimination is coarse. Code distance redundantly and exaggerate it: a level slope gentler than 6 dB per doubling, DRR that falls with distance, a low-pass that starts earlier than physics (air loss is under 1 dB at 4 kHz up to 30 m), a repetition rate that rises as a gate nears, and an ILD boost inside 1-2 m. Calibrate each code with pointing or ranking tests with blind pilots; I found no published figures for this combination.

## 4. Elevation over headphones
**Why it is weak.**
- Elevation rests on pinna spectral cues between 4 and 16 kHz: a one-octave notch whose lower edge rises with elevation (frontal sources), a peak at 7-9 kHz ("above") and a small peak at 10-12 kHz ("behind") [23] (abstract only). They are personal. With another person's HRTF, features lying lower in frequency make low frontal targets sound low and behind, and high rear targets high and in front; features lying higher bias elevation upward [27] (abstract only).
- Even with the listener's own HRTF the polar error is about 30° [5], against a vertical MAA of 3.65° and a horizontal one of 0.97° for real sources [3].
- In the browser (INFERRED from source [12]): the built-in HRTF panner does not interpolate elevation; it takes the 15° slice at or below the requested angle (error up to 15°, mean 7.5° low) and clamps below -45°.

| Remedy | Evidence | Size of effect | Cost |
|---|---|---|---|
| Own HRTF | quadrant errors 8-9 % vs 10-50 % with generic [5][6]; head-tracked own-HRTF display close to free field [24] | largest | measurement or 3D scan (sections 6-7) |
| Frequency scaling of a foreign HRTF | penalty more than halved in most cases [27] | large | needs a per-listener scale estimate |
| Best-of-N selection | section 7 | medium | about 5 min |
| Training with feedback | elevation error down 10° after three 12-minute sessions [11]; 15° more improvement than procedural learning over 10 sessions, but only 3 of 8 listeners reached own-HRTF level [4]; two 30-minute sessions cut reversals for 4 of 5 listeners, lasting at least 4 months [32] | 10-15° | 36 min to 10 sessions; game-like |
| Pitch-height mapping (Pratt effect) | higher-pitched tones are heard higher, also by congenitally blind people and young children; shown for complex tones, while a square wave follows true position; the mapping mirrors natural scene statistics and ear filtering [10] | a free redundant cue that also biases perceived elevation | mapping tuned to the course |
| Yaw (azimuth) rotation | elevation error falls with azimuth rotation [8] | up to a few degrees | free with stick yaw |

## 5. Web Audio in Chrome and Edge (2026)
Edge is Chromium, so Chrome facts should apply to it (INFERRED; I benchmarked Chrome only). Source files read on 2026-11-07 from the Chromium mirror (main branch).

### 5.1 What `panningModel = "HRTF"` does (MEASURED from source)
| Item | Value |
|---|---|
| Dataset | composite `IRC_Composite_C_R0195`: "a set of composite impulse responses generated from several individuals"; "derived from IRCAM Listen Project measurements", "Listen project data is public domain" (REPORTED, bug comments); same data in Gecko and WebKit [33]; the spec names no dataset [19] |
| Grid | 24 azimuths (15° steps) x 10 elevations (-45 to +90, 15° steps) = 240 responses, 256 frames each at 44.1 kHz (5.8 ms), resampled to the context rate [12] |
| Azimuth, elevation | azimuth interpolated x8 to 192 positions (1.875°) in the frequency domain, each ear's average group delay removed from the response and re-applied by a fractional delay line, interpolated continuously; elevation not interpolated: slice = floor((elevation + 45) / 15), clamped to -45...+90 [12] |
| Convolution, latency | FFT 512 at 44.1 and 48 kHz (1024 at 96 kHz); stereo input: left HRTF for L, right HRTF for R; latency 256 frames = 5.3 ms at 48 kHz (5.8 ms at 44.1 kHz), plus tail [12] |
| Update rate | k-rate: position is read once per 128-frame quantum; a-rate is "not implemented" (code comment: 15-20x more complex). When the azimuth index or elevation changes, a 2048-frame (43 ms at 48 kHz) crossfade runs two kernel sets, so 4 convolvers instead of 2 [12] |
| Custom HRTF | none. The spec only says "convolution with measured impulse responses from human subjects", stereo output, k-rate [19]. `loadHRTFDatabase` request #2417 is open, last update 2025-05; the custom-SOFA request was closed in 2019 with "to be handled in #21"; IRCAM, Nov 2023: "nothing has changed with regard to loading custom HRTFs" [13] |

PlayCanvas (MIT, active): `SoundInstance3d` calls `createPanner()`, and none of the six files in `src/platform/sound` mentions `HRTF` or `panningModel`, so shipped 3D sound uses the default equal-power panner, not HRTF, with a linear distance model [34]. Setting `instance.panner.panningModel = 'HRTF'` is needed (INFERRED).

### 5.2 CPU cost, own benchmark
Chrome 156.0.8078.80 (headless), Windows 10, Core i9-7980XE (2017 desktop, 36 logical processors; rendering still ran on one thread, since 173 % means 17.3 s to render 10 s). `OfflineAudioContext`, stereo, 48 kHz, 10 s; each source plays a 10 s noise buffer through the node under test on rings of 5-11 m radius; "moving" = two revolutions in 10 s with `setValueCurveAtTime` on X, Y, Z. Cost = render time / 10 s, one run per cell (the first N=1 run was discarded: it includes loading the HRTF set), expect about ±10 %. Offline rendering is a lower bound for real-time load (INFERRED).

| Sources | 8 | 16 | 32 | 64 | 128 |
|---|---|---|---|---|---|
| HRTF PannerNode, static | 1.3 % | 2.6 % | 5.3 % | 12.2 % | 23.3 % |
| HRTF PannerNode, moving | 9.8 % | 20.1 % | 40.9 % | 84.6 % | 173 % |
| equalpower PannerNode, static | - | - | 2.3 % | - | 9.1 % |
| ConvolverNode, 256-tap stereo IR, static | 2.3 % | 4.8 % | 10.1 % | 20.8 % | - |
| AudioWorklet, plain JS FIR, 2 x 256 taps | 26.7 % | 52.1 % | 105.8 % | - | - |
| AudioWorklet, plain JS FIR, 2 x 128 taps | - | 27.3 % | 55.2 % | - | - |

Reproduce the HRTF rows in the Chrome console (`await bench(32, true)` returns percent of one core). A rerun of this snippet gave 1.2 and 5.5 % (8 and 32 static), 10.1 and 39.5 % (8 and 32 moving).

```js
async function bench(N, moving = false) {            // percent of one core for a 10 s offline render
  const SR = 48000, D = 10, c = new OfflineAudioContext(2, SR * D, SR), b = c.createBuffer(1, SR * D, SR);
  b.getChannelData(0).forEach((_, i, d) => d[i] = (Math.random() - 0.5) * 0.2);
  for (let i = 0; i < N; i++) {
    const s = c.createBufferSource(), p = c.createPanner(), a = 2 * Math.PI * i / N, r = 5 + i % 7;
    s.buffer = b; p.panningModel = 'HRTF';
    if (moving) { const K = 2000, x = new Float32Array(K), z = new Float32Array(K);
      for (let k = 0; k < K; k++) { const t = a + 4 * Math.PI * k / K; x[k] = r * Math.sin(t); z[k] = -r * Math.cos(t); }
      p.positionX.setValueCurveAtTime(x, 0, D - 0.01); p.positionZ.setValueCurveAtTime(z, 0, D - 0.01);
    } else { p.positionX.value = r * Math.sin(a); p.positionZ.value = -r * Math.cos(a); }
    s.connect(p); p.connect(c.destination); s.start();
  }
  const t = performance.now(); await c.startRendering(); return 100 * (performance.now() - t) / (D * 1000);
}
```

- **How many sources (INFERRED from the table).** At 50 % of one core this CPU carries about 37 moving or 270 static built-in HRTF sources. School laptops are unknown; assuming 3x slower, a safe MVP budget is 8 moving plus 24 static sources (about 15 % here, 45 % there).
- **Alternative engine.** A native `ConvolverNode` with a 256-tap stereo HRIR costs 0.32 % per static source; a moving source needs two nodes crossfaded, about 0.64 % (INFERRED), half of the built-in panner. Plain JavaScript FIR in an AudioWorklet costs 3.3 % per source at 256 taps, ten times more; a real engine needs WASM SIMD or partitioned FFT convolution (INFERRED). `ConvolverNode` accepts 1-, 2- or 4-channel responses [19]. Chrome 156 rejected 36- and 64-channel `AudioBuffer`s (limit 32, the spec minimum), so orders 5+ need two buses (MEASURED). SOFA path: IRCAM converted SOFA to JSON and loaded it into a `ConvolverNode` [13]; `libmysofa` reads SOFA in C [35] (WASM build: INFERRED, not tested).

### 5.3 Output latency on Windows
- **Measured here:** default output device, 48 kHz: `baseLatency` 10 ms and `outputLatency` 40 ms for "interactive", "balanced", 0 and 0.002; 20 ms and 48 ms for "playback" and 0.02; `destination.maxChannelCount` = 2. The spec defines `outputLatency` as the time from handing a buffer to the OS until the sound is produced [19]; values depend on the device. Why: shared-mode default buffer 10 ms; drivers may offer 128-480 frames (2.7-10 ms) through `IAudioClient3`; engine latency 1.3 ms since Windows 10 [1]. Chrome's "interactive" hint takes the hardware buffer size on Windows and asks for the minimum `IAudioClient3` period only when the requested buffer equals it [12].
- **Total (INFERRED sum):** 60 Hz frame 16.7 ms + panner 5.3 ms + 10 + 40 ms is about 70 ms from stick to ear on this machine. Measure it by loopback before relying on it.
- **Bluetooth (MEASURED, trade press, impulse response):** SBC 248 ms vs aptX Low Latency 34 ms on one headset; SBC 181 ms vs aptX 112 ms on another; aptX Low Latency 31 and 54 ms on two more, true-wireless slower [14]. LE Audio claims of about 20 ms are vendor claims I could not verify. Use wired headphones for tests; any wireless set must pass a loopback test (INFERRED target: under 50 ms).

## 6. Open libraries and datasets
Licence, last push and archive flag read from the GitHub API on 2026-11-07 [36]. "Cost" for decoders is my measured ConvolverNode bank (section 1), not the library itself.

| Item | Licence | Maintained? | What it is / cost | Bundle in an MIT or Apache web app? |
|---|---|---|---|---|
| Built-in HRTF (Chrome, Edge, Firefox, Safari) | engine BSD-style [12]; data "public domain" (REPORTED, bug comments) [33] | yes | fixed set, nothing to download; section 5 | nothing to bundle |
| Omnitone 2.0 | Apache-2.0 | yes: commit "Release 2.0.0" on 2026-09-19 | FOA and HOA to order 3 (16 ch) with GainNode + ConvolverNode and SADIE filters [37]; decoder cost 1.2 % (FOA), 4.7 % (order 3) | yes |
| Resonance Audio Web SDK | Apache-2.0 | no: archived, last push 2022-03-08; built on Omnitone [37] | FOA/HOA scene with rooms | yes, unmaintained |
| JSAmbisonics | BSD-3-Clause | low: v0.4.0 in 2022, one commit 2026-09-17 | mono encoder, scene rotator, binaural decoder with user HRTF filters, order limiter [37] | yes |
| IRCAM binauralFIR | BSD-3-Clause | no: last push 2017-03-06 | binaural FIR node; reference code | yes, as reference |
| IEM Plugin Suite | GPLv3, up to order 7 [37] | yes | DAW plug-ins, not web | no; offline tool only |
| libmysofa | BSD-style, Symonics / C. Hoene [35] | yes: push 2026-10-25 | SOFA reader in C | yes; WASM build not tested |
| Tone.js | MIT | yes: push 2026-11-01 | music framework; I did not evaluate its spatial nodes | yes; not needed |
| Mesh2HRTF | EUPL-1.2 | yes: push 2026-07-14 | computes HRTFs from 3D head meshes, offline | no (copyleft); use as a tool |
| SADIE II | Apache-2.0, (c) 2018 University of York; dataset must be referenced [15] | static | 20 subjects (2 dummy heads, 18 humans); grids 1° (8802 points, dummy), 5° (2818) and 10° (2114); WAV and SOFA | yes, with notice and citation |
| HUTUBS | CC BY 4.0 [15] | static | 96 subjects: HRTFs, 3D head meshes, anthropometry, headphone responses | yes, with attribution |
| MIT KEMAR | "free with no restrictions on use", authors must be cited [15] | static | 710 positions, -40 to +90° elevation, 1.4 m, 44.1 kHz | yes, with citation |
| CIPIC, ARI, IRCAM LISTEN | not verified: official pages gave 410, 403 or 404, or did not load, on 2026-11-07 | - | - | not until the licence text is read |

- **Are generic HRTF sets legally redistributable? (INFERRED, not legal advice.)** Verified permissive: SADIE II (Apache-2.0), HUTUBS (CC BY 4.0), MIT KEMAR (free, cite authors). Browsers already ship the IRCAM-derived composite, with a bug-tracker statement that the Listen data is public domain (REPORTED, secondary). Rule: one `HRTF-LICENSES.md`; keep each set's licence and citation beside its files; do not add ShareAlike or NonCommercial data without reading its licence; keep any personal HRTF or head scan of a pupil on the device (personal data).
- **Maintained 2025-2026 browser library:** only Omnitone 2.0 (Ambisonics, not object-based) and the low-activity JSAmbisonics. GitHub searches found young hobby repositories, no mature object-based SOFA renderer for the browser. We write a thin one (section 9).

## 7. Quick HRTF selection
| Method | How | Time | Evidence of benefit |
|---|---|---|---|
| Orthogonal shortlist | 45 listeners rated 46 LISTEN HRTFs; a subset of 7 covered all judgements, and each of the 7 was somebody's best and somebody's worst [38][4] | rate 7 sets, minutes | on new subjects, errors were smaller with the best-rated than the worst-rated HRTF (abstract, no figures) [38] |
| Interactive pick in VR | HRTF chosen in about 5 min, then 3 x 12 min training over 5 days; a dry room response sped learning [38] | 5 min + training | learning faster than earlier studies (abstract only) |
| Direct vs indirect | localisation and subjective-quality rankings of 8 HRTFs; mean correlation positive and significant for some metrics; the best set by one method was above average in the other [38] | two short tests | some metrics correlate (no coefficients in the abstract), so one test can serve as a proxy for the other (INFERRED) |

- **How much it helps (INFERRED from the ranges).** Own HRTF 8-9 % quadrant errors, a well-matched generic 10-30 %, a badly matched 30-50 %: a good pick recovers roughly 10-20 percentage points. No study I opened reports the gain of "best of 7" directly.
- **A bad HRTF can be learned, with limits.** Worst-rated sets improved by at least 10° in three sessions and 15° beyond procedural learning in ten; learning varied by listener, 3 of 8 reached own-HRTF level, and no predictor of learning ability was found [4].
- **Protocol to validate (INFERRED).** Seven shortlisted sets, one 60-second find-the-beacon game each (8 azimuths x 3 elevations, scoring front/back and elevation hits), keep the best two, choose by rating: about 8 minutes.

## 8. Headphones and loudness safety
| Choice | Evidence | Recommendation |
|---|---|---|
| Wired vs Bluetooth | Bluetooth SBC 181-248 ms, aptX 112 ms, aptX Low Latency 31-54 ms (section 5.3) [14] | wired for every test and for home use of the sim |
| Open-back vs closed | I found no study comparing them for localisation or externalisation. INFERRED: closed-back isolates a noisy classroom and keeps sound in; open-back is lighter and more natural at home but leaks | school: closed-back, circumaural, wired, one identical model per room (one EQ), adjustable for children; home: either, wired |
| Driver quality | left/right sensitivity mismatch changed localisation, some frequency bands matter for front/back, perceived quality tracked spatial impression [39] (abstract only) | match L/R below the 0.5 dB ILD threshold [26] (INFERRED target); no bass boost, no "surround" mode, OS spatial sound off |
| Noise cancelling, bone conduction | with 80 dB background noise cancelling did not improve performance; commercial bone-conduction sets gave the same detection accuracy for up to 5 frontal horizontal positions [40]; over bone conduction elevated sources were compressed into about ±15° (preliminary) [40] | cancelling not needed; bone conduction is a mobility option, not for the seated MVP (INFERRED) |
| Equalisation | AutoEq (MIT) computes headphone equalisation from measured frequency responses [36]; I found no study quantifying the localisation gain of EQ | start with a per-model preset, check tonal balance by ear, keep an EQ stage in the chain |

**Loudness anchors (REPORTED).** WHO/ITU H.870 (2018): weekly dose not above 80 dBA for 40 h; for children and sensitive users not above 75 dBA for 40 h; warn at 100 % of the weekly allowance; if the warning is ignored the default lowers output below the chosen level [16]. ITU-T H.872 (game consoles, 2025): same references, children option 75 dBA, rolling 7-day dose, automatic cap of 80 dBA (adult) or 75 dBA (children) without user action [16]. EU Directive 2003/10/EC (workplace noise): 80 / 85 / 87 dBA LEX,8h as lower action, upper action and exposure limit values; an occupational rule, not a limit for children's play [16]. IEC 62368-1: output limit 100 dBA, 85 dBA or lower regarded as safe [16]. The 3 dB equal-energy rule follows from H.871's example "89 dBA limits exposure to 5 hours per week" [16]. INFERRED, hours per week = 40 x 10^((reference - L)/10): children (75 dBA reference) 40 h at 75 dBA, 12.6 h at 80, 4.0 h at 85, 1.3 h at 90, 8 min at 100; adults (80 dBA reference) 40 h at 80 dBA, 12.6 h at 85, 4.0 h at 90, 1.3 h at 95, 24 min at 100.

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
| Azimuth, front/back | low-frequency energy in every beacon; scene yaws at once and in proportion to stick yaw; test an exaggerated marker (rear: +3-6 dB at 10-12 kHz; front: notch plus lift above 13 kHz [23]) | [7][28] |
| Elevation | HRTF + pitch-height code + coarse bands; 10-minute ear-training game | sections 2, 4 |
| Distance | gentle level slope, reverb send, early low-pass, rising repetition rate, ILD boost under 2 m, own Doppler | section 3 |
| Output | brick-wall limiter, 1 s fade-in, OS spatial sound off, wired closed-back headphones | 5.3, 8 |

**Later, high-quality version.**
- Own renderer: per-source direct HRTF from SOFA sets (SADIE II 5° or 10° human sets, HUTUBS); two crossfaded ConvolverNodes per source first, then an AudioWorklet with WASM SIMD partitioned convolution, ITD alignment and barycentric direction interpolation (INFERRED); 16+ direct objects.
- Ambience bus: Ambisonics order 3 (at most order 4 on one bus) for wind, ground and room tail, with a magnitude-least-squares-type decoder; 16 objects plus order 3 is about 25 % of a core here (INFERRED sum).
- Personalisation: 7-set shortlist, 8-minute pick, ear training, optional frequency-scale estimate; Mesh2HRTF only as research. VR: head pose added to stick yaw, audio update under 50 ms (INFERRED target).

**Must be tested with people (baselines in sections 2-8).** (1) Front/back with static scene, stick yaw and experimenter-driven rotation, same HRTF, blind/low-vision and sighted groups apart, outcome = quadrant errors. (2) Built-in set vs best of 7 SADIE II/HUTUBS sets: pointing errors and gate-pass rate. (3) Elevation codes: HRTF only, plus pitch, plus 3 x 12 min training. (4) Distance codes: ranking and gate-arrival timing, level-only vs redundant. (5) Stick-to-ear loopback latency, with 0/50/100/200 ms added. (6) Headphones: closed vs open, wired models, L/R balance, child comfort. (7) Double spatialisation with Windows Sonic or Atmos on and off. (8) SPL per device and volume at school, limiter behaviour. (9) School laptops: 8 moving + 24 static for 30 minutes, count underruns. (10) Sessions to criterion and retention after one week.

## 10. Searched for and not found
- No study of rate-commanded rotation (a stick) and front/back or elevation judgements in a flight-like task; closest is the listener-moved source of [7]. No measured accuracy of tempo as a distance code, no distance-exponent values (only a < 1), no looming time-to-contact study with binaural HRTF rendering.
- No comparison of open-back and closed-back headphones for localisation, and no study quantifying the gain of headphone EQ (a headphone-compensation paper appeared only as a search snippet, not opened). I did not open EN 50332 or the EU toy standard; the only EU limit I read is the occupational Directive 2003/10/EC.
- Could not open: Engel 2022 full text (403), Thresh et al. 2017 on Ambisonics order (AES, 403: dropped), the Zotter and Frank Ambisonics book (Springer cookie redirect), PubMed Central pages (CAPTCHA, not bypassed), HAL (bot check), AES library, MDPI and web.archive.org (blocked). Where I read only an abstract, the claim stops at the abstract.
- Licence text not verified: CIPIC (410), ARI (403/404), IRCAM LISTEN (unreachable). LE Audio latency: no primary or independent figure found. ISO 9613-1: not opened, I computed air absorption from its published formula and checked it against table values quoted in a secondary source.
- No maintained 2025-2026 browser object-based SOFA renderer, no Steam Audio browser build [36], no public PannerNode HRTF performance numbers besides mine (one machine, one Chrome build, offline rendering, single runs: an order of magnitude, not a benchmark). Not searched: anthropometry- or photo-based HRTF personalisation, head-tracker latency thresholds, per-device LE Audio tests.

## Sources
Opened on 2026-11-07. "Abstract only" = I read the abstract through the DOI or an open metadata record, not the full text.
1. Microsoft docs: Spatial Sound for app developers (beds, dynamic object limits) https://learn.microsoft.com/en-us/windows/win32/coreaudio/spatial-sound ; Low Latency Audio https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio
2. Romigh, Brungart, Stern, Simpson 2015, Efficient real spherical harmonic representation of HRTFs, IEEE JSTSP (abstract only). https://doi.org/10.1109/jstsp.2015.2421876
3. Perrott, Saberi 1990, Minimum audible angle thresholds for sources varying in both elevation and azimuth, JASA 87 (abstract only). https://doi.org/10.1121/1.399421
4. Stitt, Picinali, Katz 2019, Auditory accommodation to poorly matched non-individual spectral localization cues through active learning, Sci. Rep. 9. https://doi.org/10.1038/s41598-018-37873-0
5. Majdak, Baumgartner, Laback 2014, Acoustic and non-acoustic factors in modeling listener-specific performance of sagittal-plane sound localization, Front. Psychol. 5:319. https://doi.org/10.3389/fpsyg.2014.00319
6. Jenny, Reuter 2020, Usability of individualized HRTFs in virtual reality, JMIR Serious Games 8(3):e17576. https://doi.org/10.2196/17576
7. Wightman, Kistler 1999, Resolution of front-back ambiguity in spatial hearing by listener and source movement, JASA 105 (abstract only). https://doi.org/10.1121/1.426899
8. McAnally, Martin 2014, Sound localization with head movement: implications for 3-d audio displays, Front. Neurosci. 8:210. https://doi.org/10.3389/fnins.2014.00210
9. Kolarik, Moore, Zahorik, Cirstea, Pardhan 2016, Auditory distance perception in humans: a review of cues, development, neuronal bases, and effects of sensory loss, Atten. Percept. Psychophys. 78. https://doi.org/10.3758/s13414-015-1015-1
10. Pitch and height (abstract only): Roffler, Butler 1968, JASA 43 https://doi.org/10.1121/1.1910977 ; Cabrera, Morimoto 2007, JASA 122 https://doi.org/10.1121/1.2736782 ; Parise, Knorre, Ernst 2014, PNAS 111 https://doi.org/10.1073/pnas.1322705111
11. Parseihian, Katz 2012, Rapid head-related transfer function adaptation using a virtual auditory environment, JASA 131 (abstract only). https://doi.org/10.1121/1.3687448
12. Chromium source (main branch), read 2026-11-07: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/audio/hrtf_panner.cc ; .../hrtf_elevation.cc ; .../hrtf_database.cc ; .../hrtf_kernel.cc ; .../resources/README (same directory); https://raw.githubusercontent.com/chromium/chromium/main/media/base/audio_latency.cc ; https://raw.githubusercontent.com/chromium/chromium/main/media/audio/win/audio_low_latency_output_win.cc ; scan of all 30 files in https://github.com/chromium/chromium/tree/main/media/audio/win
13. Custom-HRTF status: W3C Web Audio issue 2417 https://github.com/WebAudio/web-audio-api/issues/2417 ; web-audio-api-v2 issue 17 https://github.com/WebAudio/web-audio-api-v2/issues/17 ; IRCAM Forum, Using SOFA files in the browser, Nov 2023 https://discussion.forum.ircam.fr/t/using-sofa-files-in-the-browser/62341
14. SoundStage Solo, Latency: a new concern for audiophiles (Bluetooth impulse-response measurements). https://www.soundstagesolo.com/index.php/features/185-latency-a-new-concern-for-audiophiles
15. HRTF datasets: SADIE II, University of York https://www.york.ac.uk/sadie-project/database.html ; HUTUBS, TU Berlin, DataCite record (CC BY 4.0) https://doi.org/10.14279/depositonce-8487 (read at https://depositonce.tu-berlin.de/signposting/describedby/dc2a3076-a291-417e-97f0-7697e332c960) ; MIT Media Lab KEMAR, Gardner and Martin 1994 https://sound.media.mit.edu/resources/KEMAR.html
16. Loudness standards as reported: Hearing Review 2020, Standards for safe listening (H.870, H.871, Directive 2003/10/EC, IEC 62368-1) https://hearingreview.com/hearing-loss/hearing-loss-prevention/risk-factors/standards-for-safe-listening-past-present-and-future ; AIHA 2025, ITU-T H.872 for game consoles https://www.aiha.org/news/250313-new-standard-sets-sound-level-guidelines-for-video-game-consoles
17. McKenzie, Murphy, Kearney 2019, Interaural level difference optimization of binaural Ambisonic rendering, Appl. Sci. 9(6):1226 (abstract only). https://doi.org/10.3390/app9061226
18. Zaunschirm, Schörkhuber, Höldrich 2018, Binaural rendering of Ambisonic signals by HRIR time alignment and a diffuseness constraint, JASA 143 (abstract only). https://doi.org/10.1121/1.5040489
19. W3C Web Audio API editor's draft (source). https://raw.githubusercontent.com/WebAudio/web-audio-api/main/index.bs
20. Bertet, Daniel, Parizet, Warusfel 2013, Investigation on localisation accuracy for first and higher order Ambisonics reproduced sound sources, Acta Acust. 99 (abstract only). https://pure.qub.ac.uk/en/publications/investigation-on-localisation-accuracy-for-first-and-higher-order/
21. Engel, Goodman, Picinali 2022, Assessing HRTF preprocessing methods for Ambisonics rendering through perceptual models, Acta Acust. 6:4 (abstract only). https://doi.org/10.1051/aacus/2021055
22. Ben-Hur, Brinkmann, Sheaffer, Weinzierl, Rafaely 2017, Spectral equalization in binaural signals represented by order-truncated spherical harmonics, JASA 141 (abstract only). https://doi.org/10.1121/1.4983652
23. Hebrank, Wright 1974, Spectral cues used in the localization of sound sources on the median plane, JASA 56 (abstract only). https://doi.org/10.1121/1.1903520
24. Romigh, Brungart, Simpson 2015, Free-field localization performance with a head-tracked virtual auditory display, IEEE JSTSP (abstract only). https://doi.org/10.1109/jstsp.2015.2421874
25. Self-translation induced minimum audible angle, JASA 144, 2018 (abstract only). https://doi.org/10.1121/1.5064957
26. Mills 1958, On the minimum audible angle, JASA 30 (abstract only). https://doi.org/10.1121/1.1909553
27. Middlebrooks 1999, Virtual localization improved by scaling nonindividualized external-ear transfer functions in frequency, JASA 106 (abstract only). https://doi.org/10.1121/1.427147
28. Brimijoin, Akeroyd 2012, The role of head movements and signal spectrum in an auditory front/back illusion, i-Perception 3 (abstract only). https://doi.org/10.1068/i7173sas
29. Dubus, Bresin 2013, A systematic review of mapping strategies for the sonification of physical quantities, PLOS ONE 8(12):e82491. https://doi.org/10.1371/journal.pone.0082491
30. Apavou, Bouchara, Bourdot 2024, Accessibility of shooting task for blind and visually impaired: a sonification method comparison, ICAD (abstract only). https://doi.org/10.21785/icad2024.012
31. Neuhoff 2001, An adaptive bias in the perception of looming auditory motion, Ecol. Psychol. 13 (abstract only). https://doi.org/10.1207/s15326969eco1302_2
32. Zahorik, Bangayan, Sundareswaran, Wang, Tam 2006, Perceptual recalibration in human sound localization: learning to remediate front-back reversals, JASA 120 (abstract only). https://doi.org/10.1121/1.2208429
33. Origin of the built-in HRTF set: C. Rogers, W3C public-audio mail 2012 https://lists.w3.org/Archives/Public/public-audio/2012OctDec/0338.html ; Mozilla bug 865241, comments 3 and 17-20 https://bugzilla.mozilla.org/show_bug.cgi?id=865241 ; Gecko source https://github.com/mozilla/gecko-dev/tree/master/dom/media/webaudio/blink ; WebKit resources, 241 entries incl. IRC_Composite_C_R0195_*.wav https://github.com/WebKit/WebKit/tree/main/Source/WebCore/platform/audio/resources
34. PlayCanvas engine (MIT), src/platform/sound/instance3d.js. https://github.com/playcanvas/engine/blob/main/src/platform/sound/instance3d.js
35. libmysofa, LICENSE. https://github.com/hoene/libmysofa/blob/main/LICENSE
36. GitHub API metadata (licence, archived flag, last push), read 2026-11-07: https://github.com/GoogleChrome/omnitone ; https://github.com/resonance-audio/resonance-audio-web-sdk ; https://github.com/polarch/JSAmbisonics ; https://github.com/Ircam-RnD/binauralFIR ; https://github.com/Tonejs/Tone.js ; https://github.com/hoene/libmysofa ; https://github.com/Any2HRTF/Mesh2HRTF ; https://github.com/ValveSoftware/steam-audio ; https://github.com/jaakkopasanen/AutoEq
37. Library pages: Omnitone README https://github.com/GoogleChrome/omnitone/blob/master/README.md ; JSAmbisonics README https://github.com/polarch/JSAmbisonics/blob/master/README.md ; IEM Plugin Suite https://plugins.iem.at/
38. HRTF selection studies (abstract only): Katz, Parseihian 2012, JASA 131 https://doi.org/10.1121/1.3672641 ; Poirier-Quinot, Katz 2021, Acta Acust. 5 https://doi.org/10.1051/aacus/2021019 ; Zagala, Noisternig, Katz 2020, JASA 147 https://doi.org/10.1121/10.0001183
39. Gutierrez-Parera, López 2016, Influence of the quality of consumer headphones in the perception of spatial audio, Appl. Sci. 6(4):117 (abstract only). https://doi.org/10.3390/app6040117
40. Bone conduction (abstract only): Wersenyi 2023, Evaluation of bone conduction and active-noise-cancellation headsets, Infocommun. J. 15(3) https://doi.org/10.36244/icj.2023.3.6 ; Barde, Lee, Helton, Billinghurst 2016, Binaural spatialisation over a bone conduction headset: elevation perception, ICAD https://doi.org/10.21785/icad2016.013
