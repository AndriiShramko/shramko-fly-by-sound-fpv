# Warnings — what can go wrong

An honest list, including what nobody can predict yet.

## Hearing and comfort

- **Loudness.** The engine ends in a limiter at -6 dBFS and fades in over one second, but a web page cannot know how loud the headphones really are. Start with the volume low. For children aim at 75 dBA, for adults 80 dBA, and calibrate school devices once with the [loudness sheet](testing/school-loudness-sheet.md).
- **Fatigue.** Listening hard is tiring. Keep sessions short (10-15 minutes for children) with breaks.
- **Bluetooth headphones** add 180-250 ms of delay, enough to hit a wall you heard too late. Use wired headphones. Turn off Windows Sonic, Dolby Atmos and similar "virtual surround": they process the sound a second time.

## How well sound shows space

- **Front/back and up/down are weak on headphones** for everyone, more so with the browser's generic HRTF: errors of 10-50 % are reported. Turning the drone resolves front from back; height is also coded by pitch.
- **Every threshold is a starting value.** Pass rules, distances, tempi and theme numbers were not yet tuned with blind pilots. Expect them to change after tests.
- **Speech differs by device.** The voice comes from the operating system; some systems lack a voice for a language or speak slowly.
- **Scanned scenes have coarse walls.** The simulator's collision grid of a scan can be a few centimetres off the visible surface, more after scaling a scene up.

## What it is not

- **Not a mobility aid and not for real-world navigation.** A simulator is not the street; never use it in place of a cane, a guide dog or training.
- **Not a medical device and not a therapy.** It is a game.
- **Not a licence to fly real drones blind.** Real flight needs local law, a sighted spotter and a safe place.

## Data

- **Voice is personal data.** Recordings stay on the device until someone confirms sending. The consent template in [testing/](testing) is a template, not legal advice; a school needs its own data protection officer to approve it.

## Unpredictable

- **Browser changes.** Web Audio, speech synthesis and microphone rules change between browser versions; a release may need fixes.
- **People differ.** Some pilots will find a sound unpleasant or confusing that others like; that is why every layer has its own volume and pitch and the themes are swappable.
