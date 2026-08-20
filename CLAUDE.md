# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so look at the deployed head when you add pages.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out (a
linter, say), a fact about the stack that is easy to get wrong --- write it down
here and wire it into `check`. Growing this file is the work.

## Crit 4 rules: the browser is the instrument (Driftglass)

- Sound must be synthesized live via the Web Audio API in `main.ts`/`audio-map.ts`.
  Never add a pre-recorded audio file as the primary sound source, and never add
  an `<audio>`/`<video>` element for the instrument's own sound (the spec test
  in `spec/instrument.test.ts` checks the latter).
- The `AudioContext` starts suspended and is only created/resumed inside
  `ensureAudio()`, called from a real user gesture (`pointerdown` or
  `keydown`). Don't call it eagerly on load, and don't add anything that plays
  before the player's first action.
- Mouse, keyboard and touch must all be able to produce sound and shape it,
  not just trigger a fixed clip — see the pointer/keyboard sections of
  `main.ts` if you change input handling.
- No score, no fail state, no "you win/lose" UI, no correctness signal of any
  kind. `spec/instrument.test.ts` greps the built page for that language —
  don't add copy that would make it red.
- The opening screen must invite the first sound without requiring the player
  to read instructions first (the pulsing `.invite` text is a hint, not a
  manual — keep it short enough to ignore).
- **After any change to the audio graph, mappings, or envelopes in
  `main.ts`/`audio-map.ts`, do a manual listening pass before committing.**
  No test in this repo can hear the result — describe in the commit message or
  a `PROCESS.md` moment what you listened for (low latency? harsh at high
  velocity? monotonous when still?) and what you changed because of it.
- Verify both a desktop viewport (1920x1080) and a touch/mobile viewport
  (390x844, e.g. via the browser's device toolbar) before calling a step done
  — touch and pointer behaviour genuinely differ.
- Record process evidence as you go: commit at working checkpoints and note
  the moment in `PROCESS.md` while it's fresh, rather than reconstructing it
  from git log at the end.
