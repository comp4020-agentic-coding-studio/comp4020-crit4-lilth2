# Process overview

## What I built

Driftglass: a canvas of floating chimes tuned to a pentatonic scale. Moving
the mouse, touching the screen, or holding an arrow key plucks whichever
chimes you pass near — live through the Web Audio API, not a recorded sample
— with how fast you move setting how loud and how bright the note is. A
click, tap, or space bar is a "gust": a wider reach that also plucks the
nearest handful of chimes as a burst, giving a second, distinct gesture on
top of plain movement. Nothing sounds until the first gesture; there's no
score, target, or way to play a wrong note.

## The moments that mattered

1. **Picking a concept whose risk was named up front.** I sketched six
   directions against the brief (theremin, step sequencer, chord keyboard,
   wind chimes, draw-a-melody, velocity synth) before writing any code, and
   flagged wind chimes' specific failure mode: if the causal link between a
   gesture and the sound it makes isn't unmistakable, it reads as a
   screensaver, not an instrument. That risk shaped the build directly — the
   glow on a plucked chime and the pulsing invite text both exist to make the
   gesture -> sound link visible, not just audible.
   [`5be5816...311bda2`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-lilth2/compare/5be5816...311bda2)

2. **Designing around "the agent can't hear it" instead of ignoring it.** A
   test suite can't judge whether Driftglass sounds harsh or expressive. So
   the gesture->sound math (speed -> gain/brightness, gust -> radius, the
   scale itself) lives in a DOM-free, AudioContext-free module,
   [`audio-map.ts`](audio-map.ts), specifically so it can be unit-tested on
   its own: monotonic louder/brighter with speed, gust reaches further than a
   plain brush, every scale step is a consonant interval. That is the ceiling
   of what an automated check can verify here — it can't confirm the
   instrument *sounds* good, only that the contract behind the sound is the
   one intended. [`5b95217`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-lilth2/commit/5b95217)

3. **Verifying with a browser, not just a green test suite.** `pnpm check`
   passing only proves the build and the pure-function contracts. I drove a
   headless Chromium against the dev server at both a 1920x1080 and a
   390x844 viewport, simulated a mouse drag and an arrow-key/space press, and
   checked the console for errors and the invite text's fade-on-first-gesture
   — because none of that shows up in `vitest run`. Screenshots at both sizes
   confirmed the chimes render and glow correctly on interaction, and the
   focus ring is visible on the stage for keyboard-only players. This is
   still not a listening test: the audio itself needs a human ear, noted as
   the open item below.

## Before you ship

`pnpm check` is green (typecheck, build, 26 tests across the pure mapping
functions and the built page's structure). What it cannot verify, and what
still needs a human pass before this is crit-ready:

- **Listen to it.** Low latency, expressive rather than exhausting, not
  harsh at high velocity, not monotonous when still — all ear-only
  judgements. Try dragging fast vs. slow, holding still near a chime, and a
  rapid string of clicks.
- **Replace `public/card.png`** — it's still the starter's placeholder image,
  not a Driftglass-specific link-preview card.
- **Test on an actual touch device**, not just Playwright's `hasTouch`
  emulation.
