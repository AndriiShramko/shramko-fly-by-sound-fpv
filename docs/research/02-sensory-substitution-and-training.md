# Sensory substitution and training: learning to perceive space by sound, and how to build a course for flying a drone by ear

Research note 02 for ShramkoSonicFPV, an open-source browser FPV drone simulator (WebGPU, Web Audio, PlayCanvas, TypeScript) that blind and low-vision pilots can fly by sound alone. Written 2026-11-07. Every claim is tagged with its strength: MEASURED (a study or a specification gives the number), REPORTED (a credible source states it without a measurement, or I could read only a secondary summary), INFERRED (my own reasoning from the evidence, not a finding). This is not legal or medical advice.

## Summary

(to be written last)

## 1. Sensory substitution: what training bought, and why devices get abandoned

| Device (channel) | Training | What was measured | Strength |
|---|---|---|---|
| The vOICe (camera image scanned left to right over 1-2 s; height = pitch, brightness = loudness [1]) | mean 73 h (2 h a week, several months) | 9 early or congenitally blind adults, Snellen-E test: acuity 20/200 to 20/600, 5 of 9 better than the WHO blindness line (20/400), 66 degree view, no zoom [2] | MEASURED |
| vOICe, object tasks | about 15 h | locating and recognising objects on a table, including new ones (Auvray et al. 2007, read only through the review [3]) | REPORTED |
| vOICe, learning by doing | 4 h a day in daily life for 21 days, versus tests only | blindfolded users who practised in daily life were faster and more accurate; users who never used it stayed at chance (13 people, 3 practised) [4] | MEASURED, small n |
| EyeMusic (notes on a pentatonic scale, instrument = colour) | 2-3 h | all participants decoded basic shape and colour; users rated the sound pleasant and tolerable for long use [5] | MEASURED, small n |
| Sound of Vision (audio plus vibration belt, 3.5 m range) | 8 h over 4 weeks (4 h virtual, 4 h real) | 6 low-vision or blind adults: after 4 h collisions in a hard course equalled the white cane, trials stayed slower; median collisions 6.25 to 3.50 [6] | MEASURED, n = 6 |
| BrainPort V100 (electrical pattern on the tongue) | 15-20 h in one week, then a year at home | untrained users could not beat chance [7]; FDA study: 52 of 57 completers passed object recognition (92.2%), 52 of 75 enrolled (69.3%) [8] | MEASURED |
| Neosensory Buzz and VEST (vibration; built for deaf users) | 1 month at home | 3-choice sound identification up to 95%, mean 70%, improving over the month [9]; authors work for the vendor | MEASURED |

- Narrow tasks with feedback pay off in hours (EyeMusic 2-3 h, Sound of Vision 4 h to cane-level collision avoidance); fine "vision-like" acuity took about 73 h. A flying display is a narrow task. INFERRED from the rows above.
- Active practice beats passive listening: practising in daily life helped [4], and the design review says training must be active so that the sensation is attributed to the outside world [3] (REPORTED). Maidenbaum's group stresses that its best results came only after a large amount of dedicated training [10] (REPORTED).
- Pleasantness is a design goal, not decoration: EyeMusic was built on a pentatonic scale because earlier devices "often generate unpleasant sensations" [5] (REPORTED).
- A vibration channel, for the later vest: motors on the lower back needed at least 6 cm spacing to be told apart (over 80% correct), and sweeps in time beat purely spatial patterns [11] (MEASURED).
- Abandonment, what is known: more than 40 years after the first devices they are still commoner in laboratories than in daily life; the review names ergonomics (blocking the ears; bone conduction suggested), cognitive overload, cost and availability, quality of the learning phase, and psychosocial factors [12] (REPORTED, a review, not a measurement).
- Choice behaviour is the only direct sign: given both aids, 4 of 6 Sound of Vision users picked the cane; the two who picked the device had more residual vision and less cane experience [6] (MEASURED, n = 6). The FDA BrainPort study lost 18 of 75 participants [8]; the earlier BrainPort rehabilitation study went from 18 to 13 people at 12 months [7] (MEASURED).
- Not found: any measured long-term daily-use or abandonment rate for an audio device. The dropout figures above are the only ones I could open.
- Consequence for ShramkoSonicFPV (INFERRED): do not build a general camera-to-sound aid that must beat the white cane. Build one display for an activity people already want to do for fun, so that the reason to return is the game, not the rehabilitation.

## 2. Sound design for non-speech displays

Cue types and what the evidence says:

| Type | Result | Strength |
|---|---|---|
| Earcons (abstract musical motifs), auditory icons (real-world sounds), spearcons (speech sped up until it stops sounding like speech) | In five menu experiments spearcons beat earcons, auditory icons and hybrids on speed, accuracy and learning rate, and were about as learnable as plain speech [13] | MEASURED |
| Several earcons at once | Identification falls as their number rises; a different timbre per earcon and a 300 ms onset-to-onset stagger raise it significantly [14] | MEASURED |
| Parameter-mapping sonification (data value to a sound parameter, which is what a flight display is) | Review of 179 papers: pitch is the most used parameter, horizontal quantities are mostly rendered by spatial position and vertical ones by pitch; only 30 of 495 mappings (6.1%) were tested objectively, and polarity was not examined [15] | REPORTED (review of design practice) |

Mapping polarity, the direction in which a quantity maps to a sound:

| Mapping | Evidence | Strength |
|---|---|---|
| Height to pitch | In sighted adults pitch maps spontaneously to vertical position, size and spatial frequency [16]; the pairing depends on language (Dutch "high/low" versus Farsi "thin/thick") [17]. In 24 early, late and congenitally blind adults, pitch change showed no congruency with the direction of a touch movement, while sighted adults did; the authors warn that vOICe-type designs assumed this link without testing it with blind users [18] | MEASURED |
| Speed to tempo | Faster tempo means faster speed for almost all sighted and blind listeners [19] | MEASURED |
| Size to pitch | Split about evenly in both groups, so avoid it; blind and sighted polarities agree overall (r = 0.82) but differ on some pairs, and early-blind listeners flipped one pair [19] | MEASURED |
| Closeness to pulse rate | Rate inversely proportional to distance, 1-15 Hz, exponential, plus a final "ping": 9 severely impaired walkers made smaller turn and path errors than with a single ping; some found the ticking annoying and masking [20] | MEASURED, n = 9 |
| Time to collision | Looming warnings that signal the true time to collision gave 80-160 ms faster braking than other non-looming warnings; braking time grew steadily as the signalled time to collision went from early to true to late (20 drivers) [21]; looming sounds are heard as faster than receding ones [22] | MEASURED |

- Pulses or a continuous tone: car parking aids pulse faster as the obstacle nears and switch to a continuous tone under 30 cm [23] (REPORTED, one manual). A continuous exponential tick was more accurate than discrete scale notes on long straight approaches; the authors attribute this to notes arriving too far apart to make the walker slow down [20] (MEASURED result, REPORTED explanation). I found no controlled study of pulse versus continuous tone for parking aids.
- Complexity costs time: in VR aiming at invisible targets (24 sighted people) pitch alone, pitch plus tempo and binary pitch plus tempo gave equal accuracy; a three-parameter display (Shepard tone, beats, roughness) was slower (median 15.8 s against 10.9-13.3 s), rated more demanding (NASA-TLX 52 against 42) and less usable (SUS 49 against 77). Audio-only aiming was more accurate than vision but 7 to 10 times slower (median 1.5 s with vision) [24] (MEASURED, sighted only).
- Cacophony: timbre and spatial position are the simple tools for keeping streams apart; dynamic pitch is a poor separator because it already carries data [25] (REPORTED), and an assistive display must convey only vital information to avoid overload [3] (REPORTED). I found no measured limit on how many non-speech streams can be tracked during a motor task.
- Musical structure: EyeMusic used a pentatonic scale on natural instruments to be pleasant [5]; a rising C-major scale of eight steps plus a final ping guided turns better than a lone ping, but one blind walker disliked music-like cues and another said he had to focus on the sound [20] (MEASURED). Roughness (amplitude modulation at 30-150 Hz) is the acoustic mark of screams and artificial alarms, and rougher sounds were rated more alarming [26] (MEASURED). Liking for consonance is learned, not universal: Tsimane' listeners rated consonant and dissonant chords equally pleasant yet reacted to roughness as Westerners do [27] (MEASURED).
- Harmony as guidance: the Bremen group reports that roughness and beating give an "innate" calm-to-urgent cue and that novices reach 4 mm invisible targets with it [28] (REPORTED by the authors), yet the three-parameter display above was the slowest for novices [24]. No study I opened compares dissonance with simple pitch or tempo as an off-course signal for blind users.
- Design consequences (INFERRED): use pitch for height only after teaching it and offer an inverted setting; map tempo to speed; drive hazard pulses from time to collision, not distance; keep one continuous stream plus one event stream, each with its own timbre and stereo position, and stagger events by at least 300 ms; carry "off course" with roughness added to a consonant tone, not with wrong notes.

## 3. Conveying shape by sound

| Method | Evidence | Strength |
|---|---|---|
| Scan an image left to right (vOICe, EyeMusic) | Naive blindfolded sighted users resolved letter orientation well above chance on a first test and improved on a second [29]. People given only the conversion rule and a few example sounds matched sounds to raised shapes above the 20% chance level, and improved over 5 days [30]. After about 1 h online plus 20 min on site, sighted users named and placed EyeMusic shapes far above chance and generalised to shapes they had not been trained on [31]. Learning to extract shape, unlike memorising sound-object pairs, engaged the shape area of visual cortex in blind and sighted users [32] | MEASURED, small n |
| One moving source tracing the outline around the head | 13 expert listeners at the centre of a loudspeaker ring named circle, triangle or square (3 choices): circles and triangles were better perceived than squares, and a 4-speaker ring caused confusions, mostly at slow speed [33]. Drawn shapes were recovered from friction sounds whose timbre follows a drawing hand's speed profile; similar shapes were confused [34] | REPORTED (author poster); MEASURED |
| Own movement coupled to sound | 22 blindfolded adults identified four shapes played over a vertical loudspeaker array; they improved only after active audio-motor training (reproducing the movement with the arm while a sound source on the wrist followed it), not after passive listening (11 per group) [35] | MEASURED |
| Pitch or loudness contour as the outline | Listeners read contours as straight or curved lines, and the scaling decides: pitch on an ERB-rate scale and linear amplitude sounded straight, other scalings sounded exponential or logarithmic; tempo contours were not reliably told apart [36] | MEASURED |

- Teach the rule first: knowing the conversion rule was enough to be above chance before any practice [29, 30], and musical training correlated with acuity [29] (MEASURED). So the first lesson states each mapping in words and demonstrates it; drills come after (INFERRED).
- Practice must use the learner's own movement: only active training improved shape recognition [35] and active practice helped localisation [4]. In a drone simulator the equivalent is flying the outline of a ring or gate rather than listening to a recording of it (INFERRED).
- A single moving source around the head is a coarse shape channel. Experts needed a dense speaker ring for reliable circle, triangle and square judgements [33]; headphones with a generic head model are coarser (INFERRED, not measured). Do not teach "circle versus square" as a listening quiz; teach it as the path the pilot flies and the sound sequence of gates on that path (INFERRED).
- Perceptually scaled ramps matter: build any pitch or loudness "line" on an ERB or similar perceptual scale so that a steady approach sounds steady [36] (MEASURED); do not use tempo to draw a contour.
- Not found: any study of circle versus square versus cube identification with a single moving source over headphones; any study of tapping points on an object to learn its shape by sound (the closest is the audio-motor training above); success rates for three-dimensional solids by sound.

## 4. Echolocation training

- The best controlled study: 14 sighted and 12 blind adults aged 21-79 trained for 20 sessions of 2-3 h on separate days over 10 weeks (about 40-60 h): echo size discrimination, orientation of a surface, virtual maze navigation from binaural echo recordings, and 20-30 min of walking indoors and outdoors. Both groups improved on every measure, sometimes to the level of expert echolocators; neither age nor blindness limited the rate of learning or transfer to untrained tasks; a no-click control task showed the gain came from click use. At the 3-month follow-up all blind participants reported better mobility and 83% better independence and wellbeing (self-report) [37] (MEASURED, small groups).
- Sighted learners sometimes beat blind learners, which the authors attribute to age or binaural hearing, not to vision [37] (REPORTED explanation). So a sighted pilot is a fair stand-in for a first test of the training design, but not for the end state.
- What to borrow (INFERRED): many sessions on separate days rather than one long block; a virtual task that provably transfers to a real one; a difficulty rule tied to success (in the study the target distance grew after two consecutive sessions above 90% correct [37], which is a ready-made pass criterion); a control task and an untrained-task test to separate learning from habituation; an independence questionnaire at follow-up.
- Scale of effort: near-expert echo skill took about 40-60 h of structured practice, against 2-8 h for narrow substitution tasks in section 1. Flying is closer to the narrow case, so the course should target hours, not months (INFERRED).
- Not found: independent outcome data for Daniel Kish's World Access for the Blind courses (I found only the organisation's own descriptions, which I did not cite); a controlled study of a game that trains echolocation in blind children.

## 5. Audio-only and blind-accessible games

| Game | Cues and design | What players or studies reported | Strength |
|---|---|---|---|
| The Last of Us Part II (2020) | Optional cues for jumpable gaps, ledges, pickups, incoming melee, aiming at an enemy and landed shots, each switchable, with volume sliders and a glossary to replay every cue; Enhanced Listen Mode plays a cue at each scanned target and its pitch changes with the target's height relative to the player (range 10-30 m and scan time 1-5 s adjustable); a button turns the camera toward the story path; speech covers menus; one preset switches the whole vision set on [38] | A visually disabled reviewer called the cues the most innovative setting; consultant Ian Hamilton said sighted players also used auto-rotation and the sonar ping, a lesson in universal design; a totally blind consultant advised on narration, cues and navigation [39] | REPORTED |
| Forza Motorsport (2023) | Blind Driving Assists: extra cues for position and orientation on the track, corner approach and progress, needed deceleration and shift points; each cue set can be enabled alone with its own pitch and volume; previewable with descriptions in the menu; built as a feature set, not a mode, with a blind consultant over two years [40] | A legally blind player: the first race was "a cacophony", then he tuned per-cue pitch and volume and lowered engine and tyre sound; finished 21st, 4th and 1st in three races [41] | REPORTED, one player |
| Columbia RAD (CHI 2018) | A "sound slider" for speed and trajectory plus a turn indicator that announces corners well ahead; built to avoid audio overload [42] | 15 participants in two studies preferred it to Mach 1; one blind player matched casual sighted players' lap times and paths (I read the press release, not the paper) [42] | REPORTED |
| A Blind Legend (2015) | Binaural-style audio with headphones; a companion voice gives directions and repeats on demand; heartbeat for low health; the screen reader steps aside during play [43] | The AccessWorld reviewer praised the tutorial; faults were menu taps that did not register, a fight he could not pass, and a purchase message telling blind users to ask for help [43] | REPORTED |
| Zform audio game (2002) | Hum from the centre of each hallway as a beacon (turn until it is equal in both ears), artificial stereo pan on wall bumps to show impact angle, per-room footstep sounds as landmarks, narration that can be interrupted; DirectX HRTF was judged discouraging [44] | Developer's account | REPORTED |
| Bucharest quadcopter game (2022-23) | Gamepad quadcopter, spatial audio, 20 min sessions: after 3 sessions most of 3 blindfolded players were at ease with the sonification; spectral tuning cut ear fatigue, and busier scenes raised it; players beelined at the target sound and got stuck in mazes, so a path cue is needed; aeroplane-style controls were dropped because the player could not hold a heading for audio orientation [45]; a later paper describes the game and its sonification model [46] (abstract only; the publisher blocks automated access) | Measured but n = 3 | MEASURED |

- What to copy (INFERRED): every cue switchable with its own volume and pitch plus a "calm" preset; a preview and glossary of every cue before play; one beacon sound that is steered until it is centred; a path cue and not only a target cue; bundles of assists that can be taken apart; features built for blind players that sighted players also use.
- The first-session failure mode is cacophony, not boredom: the Forza player's first race, Zform's "not so many that ears are overwhelmed" and Columbia's overload goal all point the same way [41, 42, 44] (REPORTED).
- Menus and speech: the Game Accessibility Guidelines ask for screen-reader support including menus, voiced text, separate volume for effects, speech and music, distinct sounds per object and event, binaural simulation and a pingable sonar-style audio map [47] (REPORTED). In a browser: ordinary DOM text with `aria-live="polite"` for status [48], the Web Speech `SpeechSynthesis` interface as a built-in voice for people without a screen reader [49], interruptible narration [44], and the Web Audio `HRTF` panner (measured human impulse responses; the default is the simpler `equalpower`) [50] (INFERRED design).
- Not found: documentation I could open for Top Speed, Mach 1 and Swamp (the audio-game database blocks automated access); any game called "Racing Blind"; any audio-only flying game with published cue design or player results, apart from the Bucharest work. Existence claims for Three-D Velocity and similar flight simulators came from search summaries only, so I do not cite them.

## 6. Blind people flying, and drone sonification

- Real aircraft: Miles Hilton-Barber had flight-instrument output converted to speech (angle of bank, altitude, track) and trained four years with a sighted co-pilot before his London to Sydney microlight flight; he still needed that co-pilot [51] (REPORTED, his own account). Blind pilots currently use an attitude sonification to control aircraft attitude [52] (REPORTED).
- Attitude by sound, simulator: blind and sighted pilots flying successive manoeuvres on sonification alone both reached target attitudes with good accuracy and did not differ significantly; harder manoeuvres raised subjective workload and lowered brain responses to unexpected sounds, so the authors restrict the display to simple recovery and guidance manoeuvres [52] (MEASURED).
- Attitude by sound, real aircraft (16 pilots, vision blocked): roll was an interaural level shift towards the high wing; pitch was a spectral tilt plus an added pitch of 1000 Hz nose-up and 2400 Hz nose-down, chosen over spatial elevation cues because elevation localises poorly without individual head models and in noise. Errors fell by about 40% (pitch) and 90% (roll) against no audio, the first recovery move was correct in about 85% of trials, 3 of 160 trials were aborted, and the authors say precise control was not expected. They also note that earlier displays made of plain tones and noise were fatiguing and annoying and pilots disengaged them, which is why they used the pilot's own music as the carrier [53] (MEASURED, REPORTED for the history).
- Drones and UAVs: continuous sonification of course deviation gave 1.9 s (19%) faster reactions than discrete alerts in 39 military participants, but it interfered with discrete late-arrival alerts [54] (MEASURED). A spatialised pulse sonification (shorter pulse period as the helicopter drifts to an obstacle) in cockpit noise was localised to between under 3 and 14 degrees, with front-back reversals; a narrowband tone with level differences beat a broadband tone with generic head-model spectral cues (4 participants, two of them authors) [55] (MEASURED, tiny n).
- Blind and low-vision drone pilots, interviews (59 survey answers, 13 interviews): 54% had high interest and 55% had never flown or been near a drone; the main motive was flying with sighted family. They want altitude, speed and direction, speech only for threats such as crash warnings, perceptual beeps and tones for 3D space, a user-controlled amount of feedback ("one brain and only two ears"), audio not from the noisy drone but through headphones (one asked for bone conduction), and a sighted instructor in the first flights because fear of a crash stops exploration [56] (REPORTED, small sample).

| Quantity | Cue with some evidence | Gap |
|---|---|---|
| Roll or bank | left-right level shift [53]; an attitude sonification used by blind pilots [52] | no test with FPV-style fast rotation (INFERRED gap) |
| Pitch angle | spectral tilt plus pitch [53] | nose-up got the lower tone, the reverse of "up = higher"; whether that was easy to learn is not reported |
| Altitude | none measured; users ask for it [56] | I found no study of altitude sonification with measured performance |
| Speed | tempo (polarity agreed by blind and sighted [19]); "sound slider" [42] | not tested for flight |
| Obstacle or wall | pulse period shrinks with closeness, spatialised [20, 55] | tested with 4 and 9 people |
| Off course | continuous sonified deviation [54] | masks discrete alerts |

- Not found: any published blind FPV racing pilot; a measured sonification of drone altitude or speed with blind users; the Neubauer and Teas 1992 Air Force report (the host blocked it) and the Sound Flyer's exact mapping (publisher blocked). EarPilot, an iPhone app that lets a blind pilot fly basic manoeuvres in an aeroplane, is described only in a conference talk blurb [57] (REPORTED, no results).
- Consequence (INFERRED): start flight training in a self-levelling mode with altitude hold, because the evidence supports coarse attitude and recovery by ear and not precise manual control; the Bucharest game also dropped aircraft-style controls for quadcopter-style translation [45]. Remove assists step by step.

## 7. Children and students

(pending)

## 8. Measuring progress

(pending)

## 9. Ethics and law for testing with minors in Poland and the EU

(pending)

## Recommended curriculum

(pending)

## Not found

(pending)

## Sources

1. Meijer P. The vOICe: image-to-sound mapping, technical description. seeingwithsound.com. https://www.seeingwithsound.com/im2sound.htm <!-- meijer_voice -->
2. Striem-Amit E, Guendelman M, Amedi A (2012). "Visual" acuity of the congenitally blind using visual-to-auditory sensory substitution. PLoS ONE 7(3):e33136. https://pmc.ncbi.nlm.nih.gov/articles/PMC3306374/ <!-- striem2012 -->
3. Kristjánsson Á, Moldoveanu A, Jóhannesson ÓI, et al. (2016). Designing sensory-substitution devices: principles, pitfalls and potential. Restor Neurol Neurosci 34(5):769-787. https://pmc.ncbi.nlm.nih.gov/articles/PMC5044782/ <!-- kristjansson2016 -->
4. Proulx MJ, Stoerig P, Ludowig E, Knoll I (2008). Seeing "where" through the ears: effects of learning-by-doing and long-term sensory deprivation on localization based on image-to-sound substitution. PLoS ONE 3(3):e1840 (abstract). https://pubmed.ncbi.nlm.nih.gov/18364998/ <!-- proulx2008 -->
5. Abboud S, Hanassy S, Levy-Tzedek S, Maidenbaum S, Amedi A (2014). EyeMusic: introducing a "visual" colorful experience for the blind using auditory sensory substitution. Restor Neurol Neurosci 32(2):247-257 (abstract). https://pubmed.ncbi.nlm.nih.gov/24398719/ <!-- abboud2014 -->
6. Hoffmann R, Spagnol S, Kristjánsson Á, Unnthorsson R (2018). Evaluation of an audio-haptic sensory substitution device for enhancing spatial awareness for the visually impaired. Optom Vis Sci 95(9):757-765. https://pmc.ncbi.nlm.nih.gov/articles/PMC6133230/ <!-- hoffmann2018 -->
7. Nau AC, Pintar C, Arnoldussen A, Fisher C (2015). Acquisition of visual perception in blind adults using the BrainPort artificial vision device. Am J Occup Ther 69(1):6901290010. https://pmc.ncbi.nlm.nih.gov/articles/PMC4281706/ <!-- nau2015 -->
8. U.S. Food and Drug Administration (2015). De Novo request DEN130039, BrainPort V100: decision summary. https://www.accessdata.fda.gov/cdrh_docs/reviews/DEN130039.pdf <!-- fda2015 -->
9. Perrotta MV, Asgeirsdottir T, Eagleman DM (2021). Deciphering sounds through patterns of vibration on the skin. Neuroscience 458:77-86 (abstract). https://pubmed.ncbi.nlm.nih.gov/33465416/ <!-- perrotta2021 -->
10. Maidenbaum S, Arbel R, Buchs G, Shapira S, Amedi A (2014). Vision through other senses: practical use of sensory substitution devices as assistive technology for visual rehabilitation (conference paper). https://www.runi.ac.il/media/yn0liz2u/46b504_ed97f61490af4fb78110d0b64c7b41a0.pdf <!-- maidenbaum2014 -->
11. Novich SD, Eagleman DM (2015). Using space and time to encode vibrotactile information: toward an estimate of the skin's achievable throughput. Exp Brain Res 233:2777-2788 (abstract). https://pubmed.ncbi.nlm.nih.gov/26080756/ <!-- novich2015 -->
12. Elli GV, Benetti S, Collignon O (2014). Is there a future for sensory substitution outside academic laboratories? Multisens Res 27:271-291. https://research.dial.uclouvain.be/handle/2078.5/176349 <!-- elli2014 -->
13. Walker BN, Lindsay J, Nance A, et al. (2013). Spearcons (speech-based earcons) improve navigation performance in advanced auditory menus. Hum Factors 55(1):157-182 (abstract). https://pubmed.ncbi.nlm.nih.gov/23516800/ <!-- walker2013 -->
14. McGookin DK, Brewster SA (2004). Understanding concurrent earcons: applying auditory scene analysis principles to concurrent earcon recognition. ACM Trans Appl Percept 1(2):130-155 (abstract). https://eprints.gla.ac.uk/3281/ <!-- mcgookin2004 -->
15. Dubus G, Bresin R (2013). A systematic review of mapping strategies for the sonification of physical quantities. PLoS ONE 8(12):e82491. https://pmc.ncbi.nlm.nih.gov/articles/PMC3866150/ <!-- dubus2013 -->
16. Evans KK, Treisman A (2010). Natural cross-modal mappings between visual and auditory features. J Vis 10(1):6. https://pmc.ncbi.nlm.nih.gov/articles/PMC2920420/ <!-- evans2010 -->
17. Dolscheid S, Shayan S, Majid A, Casasanto D (2013). The thickness of musical pitch: psychophysical evidence for linguistic relativity. Psychol Sci 24(5):613-621 (abstract). https://pubmed.ncbi.nlm.nih.gov/23538914/ <!-- dolscheid2013 -->
18. Deroy O, et al. (2016). Differentiated audio-tactile correspondences in sighted and blind individuals. J Exp Psychol Hum Percept Perform 42(8):1204-1214. https://sas-space.sas.ac.uk/6569/1/OD-ET-AL-JEP-16.pdf <!-- deroy2016 -->
19. Walker BN, Mauney LM (2010). Universal design of auditory graphs: a comparison of sonification mappings for visually impaired and sighted listeners. ACM Trans Access Comput 2(3):12. https://wirelessrerc.gatech.edu/sites/default/files/publications/walker_et_al_-_a_comparison_of_sonification_mappings.pdf <!-- walker2010 -->
20. Ahmetovic D, et al. (2023). Sonification of navigation instructions for people with visual impairment. Int J Hum-Comput Stud 177:103057. https://ludovico.lim.di.unimi.it/download/papers/IJHCS2023.pdf <!-- ahmetovic2023 -->
21. Gray R (2011). Looming auditory collision warnings for driving. Hum Factors 53(1):63-74 (abstract). https://pubmed.ncbi.nlm.nih.gov/21469534/ <!-- gray2011 -->
22. Neuhoff JG (2016). Looming sounds are perceived as faster than receding sounds. Cogn Res Princ Implic 1:15. https://pmc.ncbi.nlm.nih.gov/articles/PMC5256440/ <!-- neuhoff2016 -->
23. BMW 3 series (E46) owner's manual, parking distance control sound signals (web transcription). https://www.bmwman.ru/en/3er/E46/main/manual/signalizaciya-avariynogo-sblizheniya-pri-parkovke-pdc <!-- bmw_pdc -->
24. Apavou F, Bouchara T, Bourdot P (2024). Accessibility of shooting task for blind and visually impaired: a sonification method comparison. Proc ICAD 2024. https://icad2024.icad.org/wp-content/uploads/2024/06/ICAD_2024_paper_12.pdf <!-- apavou2024 -->
25. Walker BN, Nees MA (2011). Theory of sonification. In: Hermann T, Hunt A, Neuhoff JG (eds), The Sonification Handbook, ch. 2. https://sonification.de/handbook/download/TheSonificationHandbook-chapter2.pdf <!-- sonhb2 -->
26. Arnal LH, Flinker A, Kleinschmidt A, Giraud AL, Poeppel D (2015). Human screams occupy a privileged niche in the communication soundscape. Curr Biol 25(15):2051-2056. https://pmc.ncbi.nlm.nih.gov/articles/PMC4562283/ <!-- arnal2015 -->
27. McDermott JH, Schultz AF, Undurraga EA, Godoy RA (2016). Indifference to dissonance in native Amazonians reveals cultural variation in music perception. Nature 535:547-550 (abstract). https://pubmed.ncbi.nlm.nih.gov/27409816/ <!-- mcdermott2016 -->
28. Ziemer T, Nuchprayoon N, Schultheis H (2019). Psychoacoustic sonification as user interface for human-machine interaction. arXiv:1912.08609. https://arxiv.org/abs/1912.08609 <!-- ziemer2019 -->
29. Haigh A, Brown DJ, Meijer P, Proulx MJ (2013). How well do you see what you hear? The acuity of visual-to-auditory sensory substitution. Front Psychol 4:330. https://pmc.ncbi.nlm.nih.gov/articles/PMC3684791/ <!-- haigh2013 -->
30. Kim JK, Zatorre RJ (2011). Tactile-auditory shape learning engages the lateral occipital complex. J Neurosci 31(21):7848-7856. https://pmc.ncbi.nlm.nih.gov/articles/PMC6633131/ <!-- kimzatorre2011 -->
31. Shvadron S, et al. (2023). Shape detection beyond the visual field using a visual-to-auditory sensory augmentation device. Front Hum Neurosci 17:1058617. https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2023.1058617/full <!-- shvadron2023 -->
32. Amedi A, et al. (2007). Shape conveyed by visual-to-auditory sensory substitution activates the lateral occipital complex. Nat Neurosci 10(6):687-689 (abstract). https://pubmed.ncbi.nlm.nih.gov/17515898/ <!-- amedi2007 -->
33. Camier C, Féron FX, Boissinot J, Guastavino C (2015). Tracking moving sounds: perception of spatial figures. Proc ICAD 2015, 308-310 (authors' poster). https://www.slideshare.net/CdricCamier/postericad4 <!-- camier2015 -->
34. Thoret E, Aramaki M, Kronland-Martinet R, Velay JL, Ystad S (2014). From sound to shape: auditory perception of drawing movements. J Exp Psychol Hum Percept Perform 40(3):983-994 (abstract). https://pubmed.ncbi.nlm.nih.gov/24446717/ <!-- thoret2014 -->
35. Martolini C, Cappagli G, Campus C, Gori M (2020). Shape recognition with sounds: improvement in sighted individuals after audio-motor training. Multisens Res 33(4-5):417-431 (abstract). https://pubmed.ncbi.nlm.nih.gov/31751938/ <!-- martolini2020 -->
36. Lembke SA (2023). Distinguishing between straight and curved sounds: auditory shape in pitch, loudness, and tempo gestures. Atten Percept Psychophys 85(8):2751-2773. https://pmc.ncbi.nlm.nih.gov/articles/PMC10600048/ <!-- lembke2023 -->
37. Norman LJ, Dodsworth C, Foresteire D, Thaler L (2021). Human click-based echolocation: effects of blindness and age, and real-life implications in a 10-week training program. PLoS ONE 16(6):e0252330. https://pmc.ncbi.nlm.nih.gov/articles/PMC8171922/ <!-- norman2021 -->
38. PlayStation Blog (2020). The Last of Us Part II: accessibility features detailed. https://blog.playstation.com/2020/06/09/the-last-of-us-part-ii-accessibility-features-detailed <!-- tlou2_ps -->
39. Besztocha I (2022). The Last of Us Part 2: a milestone in accessibility. Gamemusic. https://gamemusic.net/the-last-of-us-part-2-a-milestone-in-accessibility/ <!-- tlou2_gm -->
40. Chintala N, Turn 10 Studios (2023). Blind Driving Assist and One Touch Driving, Forza Motorsport accessibility features (Xbox Wire, Spanish edition). https://news.xbox.com/es-latam/2023/04/27/blind-driving-assist-o-one-touch-driving-funciones-de-accesibilidad-forza-motorsport/ <!-- forza_xbox -->
41. Video Games Chronicle (2023). Blind player tries out Forza Motorsport's Blind Driving Assist feature, wins a race using it. https://www.videogameschronicle.com/news/blind-player-tries-out-forza-motorsports-blind-drive-assist-feature-wins-a-race-using-it <!-- forza_vgc -->
42. Columbia Engineering (2018). New interface makes racing games accessible to blind players: the Racing Auditory Display (RAD) of Smith BA and Nayar SK, CHI 2018 (press release). https://www.eurekalert.org/news-releases/658207 <!-- rad2018 -->
43. Audio game review: A Blind Legend from DOWiNO and France Culture. AccessWorld, American Foundation for the Blind. https://afb.org/aw/17/3/15351 <!-- ablindlegend -->
44. Andersen G (2002). Playing by ear: using audio to create blind-accessible games. Gamasutra, mirrored by GameSetWatch. https://www.gamesetwatch.com/audio/playing-by-ear-using-audio-to-create-blind-accessible-games <!-- zform2002 -->
45. Ivascu S, Moldoveanu A, Moldoveanu F, et al. (2022). Virtual reality game for training the visually impaired in sensory substitution. UPB Sci Bull Series C 84(2). https://www.scientificbulletin.upb.ro/static/pdfs/rez92c_263183.pdf <!-- ivascu2022 -->
46. Ivascu S, et al. (2023). Flying a quadcopter: an audio entertainment and training game for the visually impaired. Appl Sci 13(11):6769 (abstract via Crossref). https://doi.org/10.3390/app13116769 <!-- ivascu2023 -->
47. Game Accessibility Guidelines, full list (vision section). https://gameaccessibilityguidelines.com/full-list/ <!-- gag -->
48. MDN Web Docs: ARIA live regions. https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions <!-- mdn_live -->
49. MDN Web Docs: SpeechSynthesis. https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis <!-- mdn_speech -->
50. MDN Web Docs: PannerNode.panningModel. https://developer.mozilla.org/en-US/docs/Web/API/PannerNode/panningModel <!-- mdn_panner -->
51. Cackett P (2025). Danger zone: Miles Hilton-Barber (interview). Eye News 32(1), June/July 2025. https://www.eyenews.uk.com/media/41220/eyeam25-hilton-barber-final2.pdf <!-- hiltonbarber -->
52. Valéry B, Scannella S, Peysakhovich V, Barone P, Causse M (2017). Can an aircraft be piloted via sonification with an acceptable attentional cost? A comparison of blind and sighted pilots. Appl Ergon 62:227-236 (abstract). https://pubmed.ncbi.nlm.nih.gov/28411733/ <!-- valery2017 -->
53. Simpson BD, Brungart DS, Dallman RC, Yasky RJ, Romigh GD (2007). Flying by ear: blind flight with a music-based artificial horizon. Proc Human Factors and Ergonomics Society (NASA copy). https://ntrs.nasa.gov/citations/20080042307 <!-- simpson2007 -->
54. Donmez B, Cummings ML, Graham HD (2009). Auditory decision aiding in supervisory control of multiple unmanned aerial vehicles. Hum Factors 51(5):718-729 (abstract). https://pubmed.ncbi.nlm.nih.gov/20196296/ <!-- donmez2009 -->
55. Godfroy-Cooper M, Miller JD, Szoboszlay Z, Wenzel EM (2017). 3D-sonification for obstacle avoidance in brownout conditions. Proc AHS International 73rd Annual Forum. https://ntrs.nasa.gov/citations/20170011173 <!-- godfroy2017 -->
56. Gadiraju V, Garcia J, Kane SK, Brock AM (2021). "It is fascinating to make these beasts fly": understanding visually impaired people's motivations and needs for drone piloting. Proc ASSETS '21. https://par.nsf.gov/biblio/10323221 <!-- gadiraju2021 -->
57. George R. EarPilot: flying an airplane by ear (session description, Minnebar 19). https://sessions.minnestar.org/sessions/1687 <!-- earpilot -->
