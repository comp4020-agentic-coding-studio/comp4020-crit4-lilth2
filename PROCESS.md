# Process overview

## What I built

Driftglass: a full sky of playable stars tuned to a major hexatonic scale.
Moving the mouse, touching the screen, or holding an arrow key plucks
whichever stars you pass near — live through the Web Audio API, not a
recorded sample — with how fast you move setting how loud and how bright the
note is, and a star's height on screen setting its pitch. A click, tap, or
space bar is a "gust": a bounded-range reach that also plucks the nearest
handful of stars as a comet burst. Six of the stars, indistinguishable from
the rest until it's their turn, are quietly wired up as anchors for an
optional Twinkle-Twinkle-Little-Star guide: the current target pulses with a
gold dashed ring, and touching it — genuinely, not just nearby — advances the
guide and leaves a fading constellation line. A top-corner toggle switches
between **Guided Twinkle** (the default) and **Free play**: in free play
every star is an equal, full-volume voice with no target and nothing to get
"wrong"; in guided play, only the highlighted target advances the tune at
full volume, while brushing any other star still rings it, just at a much
lighter preview volume, so sweeping toward the target never sounds like a
mistake. Finishing a full pass through the tune shows a brief, gentle
completion line, then the guide quietly resets to the start so it can be
played again — never a win screen, never a stop. The keyboard cursor is a
small comet — a glowing head with a tapering tail streaming behind it — that
points the way it's moving, not a generic ring, and the live mouse/touch
pointer trails the same comet while actually in motion, fading within half a
second so it never fights with the browser's own cursor at rest. Every other
star, including the other five anchors when
they're not the target, is always just a normal star: nothing you play can
be wrong, the guide never plays itself, and it loops forever with no finish
screen. Nothing sounds until the first gesture.

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

6. **Rebuilding wind chimes into a starlight instrument without losing the
   "anyone can play it" core.** The brief asked for something that reads
   visually as a night sky and optionally teaches Twinkle Twinkle without
   ever blocking free play. The scale had to change first: the old
   pentatonic scale (0, 2, 4, 7, 9 semitones) has no F, so it can't produce
   the melody at all. Swapping to a major hexatonic scale (adding 5, i.e. F)
   still lands every pairwise interval inside the existing "no dissonant
   interval" whitelist, so the original consonance contract in
   `audio-map.ts` held without being loosened. The bigger design choice was
   *where* the melody lives: rather than building six dedicated
   melody-only stars alongside a smaller decorative field, the guide reuses
   six ordinary stars from a full 30-star sky (`buildStars()` in `main.ts`)
   as anchors, chosen so they sit in a mid-height band but otherwise look
   identical to every other star until the guide highlights one. That way
   the opening screen is always "a whole sky of stars you can play," and the
   melody is discoverable, not the point of the page. The target/non-target
   distinction is deliberately double-encoded — a gold dashed pulsing ring
   plus comet particles, not just a color change — so it doesn't rely on
   color vision alone.

7. **A headless browser pass caught a real bug a green test suite couldn't:
   a "small" gesture that wasn't actually small.** `gustBurst()` (the
   click/tap/space "comet burst") plucked the 5 nearest stars to the
   pointer with no distance limit. That's fine on a dense field, but with
   only ~30 stars spread across a 1920x1080 canvas, the average gap between
   stars is wide enough that a click far from the highlighted target could
   still rank a melody anchor among its "5 nearest" and silently advance the
   guide — directly against the spec's "a click/tap triggers a small
   cluster nearby, not a burst anywhere on screen." I found this by scripting
   Playwright to click ten points deliberately outside the anchors'
   theoretical vertical band and asserting the on-screen "Next note" status
   never changed; it changed anyway, which is what a purely visual/manual
   check would likely have missed since the effect only shows up as a status
   text update, not a rendering glitch. Fixed by giving both `gustBurst`
   (`COMET_RADIUS`) and the hold-to-sustain gesture (`SUSTAIN_MAX_REACH`) a
   real maximum trigger distance, then re-ran the same script to confirm the
   status genuinely stops changing on off-target clicks while still
   advancing correctly on real hits — via mouse, and separately via a
   keyboard-only raster scan with no prior pointer interaction at all.

8. **A real hands-on pass found four rough edges automated checks alone
   wouldn't have flagged — and my own test harness hid one of them from
   me at first.** After trying the starlight build directly, four things
   read as friction rather than as an instrument: a finished Twinkle pass
   had no acknowledgement at all (it just silently wrapped to the start,
   as if it had stalled); the 60/150px trigger radii were loose enough on
   a sparse ~30-star field that sweeping toward the guide's target could
   ring an unrelated neighbour and sound like a wrong note; the keyboard
   cursor was a plain 16px white ring with no relation to the "starlight
   instrument" theme; and, most fundamentally, guided play and free play
   were the same mode wearing different clothes — any hit was full volume
   and any hit near the path could be mistaken for an error, because
   nothing distinguished "just passing through" from "playing the guide."
   I chose an explicit **Free play / Guided Twinkle** toggle over an
   implicit melody-lock: a stranger who has never used the page should be
   able to *see* that there are two ways to play, not discover a hidden
   volume rule by trial and error, and the brief's demand that "a stranger
   can play it uninstructed" argues for a visible affordance over an
   invisible one. Both modes reuse the exact same pointer/touch/keyboard
   pipeline; only the post-hit decision (advance the guide? scale the
   gain?) branches on mode, so there is exactly one interaction model, not
   two.
   Continuing the project's habit of pulling anything the agent can't
   hear or watch play out into a pure function, `resolveHit(mode,
   isTarget)` and `advanceMelodyIndex(index, length)` in `audio-map.ts`
   made "hitting the target advances, hitting anything else in Guided
   mode just previews quietly, and free play never advances" directly
   unit-testable, and caught a real bug during Playwright re-verification
   that a green `vitest run` couldn't have: the completion message was
   set once by `advanceMelody` but nothing ever re-checked whether its
   display window had expired, so it never reverted back to `Next note:
   C` — it just sat there permanently once shown. `pnpm check` was green
   throughout, because the bug was about *what fires every frame*, not
   about any pure function's return value. A scripted browser catching
   "the text never changes back three seconds later" is exactly the kind
   of runtime-only defect this project's earlier moments already flagged
   automated checks can't reach alone. Fixed by having the draw loop
   itself notice the expiry and call `updateStatusText()`, the same
   `now`-driven pattern the ripple/constellation-fade effects already
   use, then re-ran the same scripted pass to confirm the message now
   reverts and `melodyIndex` resets so replay works. My own first attempt
   at scripting this had a second, self-inflicted gap worth naming: an
   early version of the verification script used a single fixed click
   grid to hunt for the current melody target, and a fixed grid that
   misses a target once (because a grid point landed just outside the new,
   smaller 85px gust radius) misses it on every identical retry too — it
   reported a false "failed to advance" that was really a test-harness
   blind spot, not an app bug. Jittering the grid origin per pass fixed
   the harness itself before trusting its result.

## Before you ship

`pnpm check` is green (typecheck, build, 36 tests across the pure mapping
functions and the built page's structure), and the instrument is live at
<https://comp4020-agentic-coding-studio.github.io/comp4020-crit4-lilth2/>.
What automated checks still cannot verify, and what needs a human pass:

- **Listen to it — still open, and now with new material to check.** The
  starlight rework added a target-star gain/decay boost, a `special`-star
  reverb-send boost, and a wider hexatonic scale; I can only check the
  *numbers* stay in bounds (e.g. the target's 1.15x gain multiplier keeps
  peak gain under the same ceiling `velocityToGain` already caps at, so it
  shouldn't clip) — not whether hitting the melody target actually sounds
  like a rewarding little swell rather than a jarring pop, or whether the
  wider hexatonic scale still feels calm when several octaves ring at once.
  Try dragging fast vs. slow, holding still near a star, a rapid string of
  clicks, and specifically listening at the moment a melody target is hit
  vs. missed.
- **Test on an actual touch device**, not just Playwright's `hasTouch`
  emulation — real touch latency, and whether the on-screen gesture feels
  as direct as it does with a mouse.
- **Listen to the new Guided-mode preview volume and the shrunk radii.** I
  picked `PREVIEW_GAIN_SCALE = 0.14` and the 30/40/85px radii by reasoning
  about proportions (clearly audible but clearly secondary; small relative
  to the ~150-300px average gap between stars), not by ear or by hand-feel
  on a real trackpad/touchscreen. Whether 0.14 actually reads as "a light
  touch" rather than "broken/quiet-sounding," and whether the smaller
  radii feel accurate rather than fiddly on an actual mouse or finger, both
  need a real pass before shipping.
