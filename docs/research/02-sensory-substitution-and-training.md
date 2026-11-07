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

(pending)

## 6. Blind people flying, and drone sonification

(pending)

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
