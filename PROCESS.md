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

4. **Treating a hands-on test as ground truth over my own read of the
   screenshots.** A pass at a live URL surfaced a real bug my earlier
   headless checks missed: keyboard listeners were bound to the stage
   element, so a stranger who pressed an arrow key without first tabbing
   to the stage heard nothing — a direct violation of "a stranger can
   play it uninstructed." The same pass named the chime rendering as
   reading like a screensaver, not an instrument. Fixed by moving the
   keyboard listeners to `window`, auto-focusing the stage on load, and
   replacing the plain dots with hanging-glass-shard shapes, a
   sweep trail and pluck ripples so the gesture→sound link is visible,
   not just audible. Also added two small, deliberately narrow
   expressiveness knobs (x position → stereo pan, hold-and-release →
   longer sustain) and gated the ambient idle pluck behind a decaying
   room-energy accumulator so it reads as an echo of recent play rather
   than the page playing itself.
   [`08ac99b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-lilth2/commit/08ac99b)
5. **Deploying and independently re-verifying, not trusting the green
   check alone.** `configure-pages` failed on the first dispatch because
   Pages had never been enabled for this repo (`Get Pages site failed:
   Not Found`) — enabling it via `gh api POST .../pages` with
   `build_type=workflow` fixed the deploy job on the next run. Beyond the
   workflow's own "verify the deployed site is online" step, I `curl`'d
   the live URL and `card.png` myself afterward rather than taking the
   green run as sufficient.
   [`2f72025`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-lilth2/commit/2f72025)

## Before you ship

`pnpm check` is green (typecheck, build, 28 tests across the pure mapping
functions and the built page's structure), and the instrument is live at
<https://comp4020-agentic-coding-studio.github.io/comp4020-crit4-lilth2/>.
What automated checks still cannot verify, and what needs a human pass:

- **Listen to it.** Low latency, expressive rather than exhausting, not
  harsh at high velocity, not monotonous when still — all ear-only
  judgements. Try dragging fast vs. slow, holding still near a chime, and a
  rapid string of clicks.
- **Test on an actual touch device**, not just Playwright's `hasTouch`
  emulation — real touch latency, and whether the on-screen gesture feels
  as direct as it does with a mouse.
