# School loudness sheet: 75 dBA for children, 80 dBA for adults

A one-sheet procedure and record for making the sound of Fly by Sound safe on a school's own computers and headphones. It is a **proposed procedure** written from [research 01, section 8](../research/01-spatial-audio-on-headphones.md): an acoustician or the school's occupational-health service should confirm it, and it is **not a certified calibration**. Consent and data rules are separate ([consent-template.md](consent-template.md), not legal advice), and so is the test protocol ([test-protocol.md](test-protocol.md)).

## The numbers

| Who | Reference level | What it means |
|---|---|---|
| **Children** | **75 dBA** | the level that WHO/ITU recommendations (H.870, and for game consoles H.872) give as a safe weekly dose of 40 hours for children and sensitive users |
| **Adults** | **80 dBA** | the same dose of 40 hours per week for adults |

Every 3 dB above the reference halves the safe time. Hours per week at a level L are `40 x 10^((reference - L) / 10)`:

| Level, dBA | Children (reference 75) | Adults (reference 80) |
|---|---|---|
| 75 | 40 h | 126 h (more than a week: no limit in practice) |
| 80 | 12.6 h | 40 h |
| 85 | 4.0 h | 12.6 h |
| 90 | 1.3 h | 4.0 h |
| 95 | 24 min | 1.3 h |
| 100 | 8 min | 24 min |

These are WHO/ITU weekly-dose references (and the 3 dB rule that follows from them), not legal limits for play. The EU workplace directive 2003/10/EC (80, 85 and 87 dBA over 8 hours) is an occupational rule and is not a limit for children.

## Why a number in the software is not enough

A web page cannot read the operating system's volume, the headphones' sensitivity or the sound pressure at the ear, and there is no browser interface for it. The engine ends in a limiter with a ceiling of -6 dBFS and a one-second fade-in on every start, resume and device change. That keeps the **digital** level bounded, but a typical headphone driven at full scale (0.5 V into 32 ohm, 100 dB SPL per milliwatt) gives about 109 dB SPL, 34 dB above the children's reference. Only a measurement on the real device, headphones and volume setting tells the truth. Also, **speech** is made by the browser's own voice and does **not** pass the limiter, so it has to be measured too.

## What you need

1. A sound level meter that meets IEC 61672 (class 1 or class 2) with A-weighting, and a **headphone coupler or artificial ear** (IEC 60318-1 or 60318-4) that the meter can read. Holding a meter next to a headphone, or measuring in the room, gives a number that means nothing: if there is no coupler, ask the school's occupational-health service or an acoustics laboratory at a university or technical school to measure.
2. A test signal: **pink noise, 30 seconds, RMS at -18 dBFS** (about -6 dBFS peaks, the limiter's ceiling). In Audacity: Generate, Noise, Pink, duration 30 s, then Effect, Loudness Normalization, with "RMS" set to -18 dB. This is the loudest steady sound the engine can send, much louder than any normal flight, so passing it is conservative.
3. The headphones that the tester will use, the computer, the browser (a current Chrome or Edge), and the page of the demo or the simulator for the speech check. Wired, closed-back headphones. Operating-system spatial sound and every equaliser or "loudness" feature off.

## Procedure, once per headphone model, per computer, per volume setting

1. Fit the headphones on the coupler as they sit on a head. Set the operating-system master volume to a low value, for example 20 %.
2. Play the pink-noise file from the browser (the same output device and sample rate as the game will use). Read **LAeq over 30 s**, A-weighted.
3. Raise the volume in small steps until LAeq is as close as possible to the reference **without exceeding it**: **75 dBA for children, 80 dBA for adults**. Write down the operating-system volume that gives it.
4. **Speech check.** Open the demo, press Start, choose a lesson (for example "Headphone check") and let the voice speak the first lesson's first lines. Read LAeq over the first 20 seconds. If it is above the reference, lower the voice level (the voice layer's gain in the Sound Lab, or the volume of the browser's voice) until it is not, and write the setting.
5. **Cap it.** Lock the operating-system volume at the value found: a policy or a profile that the children cannot change, and a note to the helper not to raise it. The helper must never raise the volume during a flight.
6. Record everything in the table below. Repeat for each headphone model and each computer (the same model on another computer, or another audio jack or USB socket, is not the same chain), and **again after any driver, operating-system or browser update, or if the headphones are changed**.
7. A child's headphones should be adjustable and fit snugly; check the fit of each child's pair at the start.

If a level cannot be reached with the headphones available (they are too sensitive and the lowest volume step is already above the reference), do not use that pair for children.

## At home, with no meter

There is no calibration at home, so use a relative method. An **adult** plays the glossary lesson and sets the volume to a comfortable level, about as loud as a normal conversation at arm's length, with the headphones on their own head; the child's volume is set **at or below** that, and is never raised without an adult doing it. Wired headphones, the operating-system spatial sound off, a break every 15 minutes. If the sound has to be raised to be heard over a noisy room, change the room first.

## When to stop

Stop and take the headphones off at any complaint of loudness, ear pain, ringing, headache or tiredness, at the first sign of distress, and when the test protocol's time limit for the sitting is reached. A child complaining of loudness is never told to wait.

## Record (one row per headphone model, computer and volume setting)

| Date | Room | Computer and audio output | Headphone model | Coupler and meter, and who measured | Group (children or adults) | OS volume (%) | Pink-noise LAeq, 30 s (dBA) | Speech LAeq, 20 s (dBA) | Pass (at or under 75 or 80) | Volume locked by | Next check due |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

Reference chosen: [ ] 75 dBA (children) [ ] 80 dBA (adults). Sheet checked by: [role] on [date]. Confirmed by an acoustician or occupational-health service: [ ] yes [ ] no, [name of the body], [date].
