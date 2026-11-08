# Lane s13-elev: up and down by direction too (owner's message 42)

Branch `s13-elev`, in a worktree of its own, cut from `main` 16c01a1 (v0.13 merged and pushed, not yet released in
the simulator). Never pushed; the lead merges. Read first: `AGENTS.md`, `docs/design/virtual-listener.md` (why height
is carried by pitch: with Chrome's generic HRTF, up/down and front/back quadrant errors are 29 to 37 %; its rule: do not
rely on the HRTF alone, and make every HRTF-reliant cue broadband to about 16 kHz), `docs/dev/status-v0.13-sound.md`
(the cue design) and `docs/dev/review-v0.13-merge.md` (observations, open items).

## The request

The owner (message 42), about the sentence "height and the way past an obstacle above or below are carried by pitch,
not by the direction of the sound": keep the direction of the sound for up and down too, because someone with very
good headphones or very good hearing may tell it. So pitch stays the primary carrier and the direction is added on top
of it, never instead of it: every cue that means up or down also comes from its real direction in 3D through the
browser's HRTF (the open-way chime from the way above or below the obstacle, the target height note from the target,
a ceiling or floor hazard from above or below), with energy up to about 16 kHz so the HRTF has something to shape,
while every pitch contour, interval and timing stays as in v0.13. One setting, on by default, turns the up/down
direction off and gives back v0.13's placement exactly. The words that say the chime comes "from ahead" for above
and below change with it. In the same lane: "wrong way" between gates, which the 8 m line-up rule never told in the
5 to 7 m gaps of the v0.13 rooms (M41-15).

## Status

- [ ] E1-1 Audit: every cue that means up or down or has a place above or below the pilot, its placement and spectrum
  today (table below)
- [ ] E1-2 Direction for up and down: the open-way chime, the target height note, ceiling and floor hazards from their
  real direction, broadband to about 16 kHz; pitch, intervals and timing unchanged
- [ ] E1-3 The setting (on by default) that gives back v0.13's placement exactly; its label and spoken description in
  four languages
- [ ] E1-4 Words: the glossary and the lesson lines say "from above or below"; tunnel-gaps intro.3 plays the chime
  above and below; walls-pillar names its chime
- [ ] E1-5 Wrong way between gates: the line-up distance scaled with the lesson's gate spacing (control: the 8 m rule)
- [ ] E1-6 Measure: Node tests, the listener check of the placement (Chrome's HRTF, headless), the localization models
  where runnable; all repository checks, the proofs and `pnpm listen`
- [ ] E1-7 This lane's E1 status final
- [ ] E2-1 (the next agent's; its task names it)
- [ ] E2-2 (the next agent's)
- [ ] E2-3 (the next agent's)
- [ ] E2-4 (the next agent's)

## Needs from the simulator

(filled as the steps land)
