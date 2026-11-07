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

(pending)

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
