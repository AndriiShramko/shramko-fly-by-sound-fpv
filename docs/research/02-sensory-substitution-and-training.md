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

(pending)

## 4. Echolocation training

(pending)

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
