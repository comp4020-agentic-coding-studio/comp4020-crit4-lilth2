import {
  advanceMelodyIndex,
  clamp,
  detune,
  distance,
  holdDurationToDecay,
  NOTE_ORDER,
  noteAndOctaveAtStep,
  noteToHz,
  pitchIndexForY,
  resolveHit,
  triggerRadius,
  velocityToCutoffHz,
  velocityToGain,
  xToPan,
  type NoteName,
  type PlayMode,
} from "./audio-map.ts";

// --- DOM -------------------------------------------------------------

const stage = document.querySelector<HTMLElement>('[data-testid="stage"]');
const canvas = document.querySelector<HTMLCanvasElement>("#sky");
const invite = document.querySelector<HTMLElement>('[data-testid="invite"]');
const status = document.querySelector<HTMLElement>('[data-testid="status"]');
const modeToggle = document.querySelector<HTMLElement>('[data-testid="mode-toggle"]');
if (!stage || !canvas) throw new Error("Driftglass: stage or canvas missing from the page");
const ctx2d = canvas.getContext("2d");
if (!ctx2d) throw new Error("Driftglass: 2D canvas context unavailable");

// --- Stars ---------------------------------------------------------------
// The whole screen is one playable starfield: every star can be swept,
// clicked/tapped, or reached with the keyboard cursor and will sound, on the
// same hexatonic scale, so free improvisation never clashes. A "Twinkle,
// Twinkle" guide is layered on top by pointing at six of these same stars in
// sequence (see melodyAnchors below) — it never adds a star of its own, and
// never plays a sound by itself.

interface Star {
  fx: number; // fractional home position, 0..1
  fy: number;
  note: NoteName;
  octave: number;
  freq: number;
  phase: number;
  bobAmp: number;
  bobSpeed: number;
  energy: number; // 0..1, decays each frame, drives the visual glow
  lastTriggered: number;
  rippleStart: number;
  special: boolean; // a few larger, longer-ringing, more reverberant stars
}

const ROOT_HZ = 130.81; // C3
const BASE_OCTAVE = 3;
const OCTAVES = 4; // C3..C6
const TOTAL_STEPS = NOTE_ORDER.length * OCTAVES;
const AMBIENT_COUNT = 24;
const SPECIAL_COUNT = 4;

// Higher on screen -> higher scale step -> higher pitch, everywhere a star
// can appear. This is the exact inverse of audio-map's pitchIndexForY, used
// here only to place the six melody anchors at a precise pitch.
function fyForStep(step: number): number {
  return clamp(1 - step / (TOTAL_STEPS - 1), 0.04, 0.96);
}

function makeStar(note: NoteName, octave: number, fx: number, fy: number): Star {
  return {
    fx,
    fy: clamp(fy, 0.04, 0.96),
    note,
    octave,
    freq: noteToHz(note, ROOT_HZ, octave, BASE_OCTAVE),
    phase: Math.random() * 10,
    bobAmp: 5 + Math.random() * 9,
    bobSpeed: 0.0004 + Math.random() * 0.0006,
    energy: 0,
    lastTriggered: -Infinity,
    rippleStart: -Infinity,
    special: false,
  };
}

const stars: Star[] = [];
let melodyAnchors: Record<NoteName, Star>;

function buildStars() {
  stars.length = 0;

  // Six of the stars double as melody anchors, one per pitch class, placed
  // near the middle of the pitch range so the guide has somewhere legible to
  // point. They look identical to every other star until it's their turn.
  const anchors = {} as Record<NoteName, Star>;
  NOTE_ORDER.forEach((note, i) => {
    const step = i + NOTE_ORDER.length; // octave 4
    const { octave } = noteAndOctaveAtStep(step, BASE_OCTAVE);
    const fx = 0.12 + (i / (NOTE_ORDER.length - 1)) * 0.76 + (Math.random() - 0.5) * 0.05;
    const fy = fyForStep(step) + (Math.random() - 0.5) * 0.03;
    const star = makeStar(note, octave, clamp(fx, 0.04, 0.96), fy);
    anchors[note] = star;
    stars.push(star);
  });
  melodyAnchors = anchors;

  // The rest of the starfield: random positions, pitch read straight off
  // vertical position through the same mapping the guide anchors used.
  for (let i = 0; i < AMBIENT_COUNT; i++) {
    const fy = 0.05 + Math.random() * 0.9;
    const step = pitchIndexForY(fy, TOTAL_STEPS);
    const { note, octave } = noteAndOctaveAtStep(step, BASE_OCTAVE);
    stars.push(makeStar(note, octave, Math.random(), fy));
  }

  const pool = stars.map((_, i) => i);
  for (let i = 0; i < SPECIAL_COUNT && pool.length; i++) {
    const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    stars[pick].special = true;
  }
}
buildStars();

function starPosition(s: Star, t: number, w: number, h: number) {
  const x = s.fx * w + Math.sin(t * s.bobSpeed + s.phase) * s.bobAmp;
  const y = s.fy * h + Math.cos(t * s.bobSpeed * 0.7 + s.phase) * s.bobAmp * 0.6;
  return { x, y };
}

function hueForFreq(freq: number): number {
  const pitchNorm = clamp(Math.log2(freq / ROOT_HZ) / OCTAVES, 0, 1);
  return 195 + pitchNorm * 85; // cyan -> blue -> violet, low to high
}

// --- Canvas sizing -------------------------------------------------------

let width = 0;
let height = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = stage!.clientWidth;
  height = stage!.clientHeight;
  canvas!.width = Math.round(width * dpr);
  canvas!.height = Math.round(height * dpr);
  ctx2d!.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();
stage.focus({ preventScroll: true });

// --- Audio ---------------------------------------------------------------

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let delaySend: GainNode | null = null;

function ensureAudio(): AudioContext {
  if (audioCtx) {
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  }
  audioCtx = new AudioContext();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioCtx.destination);

  // A cheap feedback delay stands in for a reverb tail: no impulse-response
  // asset to fetch, still gives the stars somewhere to hang in the air.
  const delay = audioCtx.createDelay(1);
  delay.delayTime.value = 0.31;
  const feedback = audioCtx.createGain();
  feedback.gain.value = 0.34;
  delaySend = audioCtx.createGain();
  delaySend.gain.value = 0.5;

  delaySend.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(masterGain);

  return audioCtx;
}

function pluck(
  star: Star,
  gain: number,
  cutoffHz: number,
  now: number,
  decayOverride?: number,
  pan = 0,
  reverbBoost = 1,
) {
  const ac = ensureAudio();
  star.lastTriggered = now;
  star.energy = 1;
  star.rippleStart = now;
  roomEnergy = Math.min(1, roomEnergy + 0.28);

  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = detune(star.freq, Math.random());

  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(cutoffHz, 400, 12000);
  filter.Q.value = 0.5;

  const panner = ac.createStereoPanner();
  panner.pan.value = clamp(pan, -1, 1);

  const env = ac.createGain();
  const t0 = ac.currentTime;
  const decay = decayOverride ?? 0.7 + Math.random() * 0.9;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

  const revSend = ac.createGain();
  revSend.gain.value = reverbBoost;

  osc.connect(filter);
  filter.connect(panner);
  panner.connect(env);
  env.connect(masterGain!);
  env.connect(revSend);
  revSend.connect(delaySend!);

  osc.start(t0);
  osc.stop(t0 + decay + 0.05);
  osc.addEventListener("ended", () => {
    osc.disconnect();
    filter.disconnect();
    panner.disconnect();
    env.disconnect();
    revSend.disconnect();
  });
}

// --- Melody guide ----------------------------------------------------------
// A non-blocking layer on top of free play: it names the next star in
// "Twinkle, Twinkle, Little Star" and advances only when a real gesture hits
// that exact star. Hitting any other star still sounds normally and never
// resets or penalises progress. It never plays a note by itself.

// prettier-ignore
const MELODY: NoteName[] = [
  "C", "C", "G", "G", "A", "A", "G",
  "F", "F", "E", "E", "D", "D", "C",
  "G", "G", "F", "F", "E", "E", "D",
  "G", "G", "F", "F", "E", "E", "D",
  "C", "C", "G", "G", "A", "A", "G",
  "F", "F", "E", "E", "D", "D", "C",
];

let melodyIndex = 0;
let lastMelodyHitPos: { x: number; y: number } | null = null;
const CONSTELLATION_MS = 5200;
const constellationSegments: { x1: number; y1: number; x2: number; y2: number; t: number }[] = [];

// Guided Twinkle (default) highlights a target star and only a genuine hit
// on it advances the guide; Free play is the whole sky as a plain
// instrument, no target, no advance, no "wrong" note. Both modes share every
// input handler below — only what happens after a hit differs.
let playMode: PlayMode = "guided";
let completionMessageUntil = -Infinity;
let completionGlowUntil = -Infinity;

function currentMelodyTarget(): Star {
  return melodyAnchors[MELODY[melodyIndex]];
}

function updateStatusText() {
  if (!status) return;
  if (performance.now() < completionMessageUntil) return;
  status.textContent =
    playMode === "guided" ? `Next note: ${MELODY[melodyIndex]}` : "Free play — the whole sky is yours.";
}

function setMode(mode: PlayMode) {
  playMode = mode;
  completionMessageUntil = -Infinity;
  if (modeToggle) {
    for (const btn of modeToggle.querySelectorAll<HTMLButtonElement>(".mode-btn")) {
      btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
    }
  }
  updateStatusText();
}

modeToggle?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".mode-btn");
  if (!btn?.dataset.mode) return;
  setMode(btn.dataset.mode as PlayMode);
});

function advanceMelody(star: Star, now: number) {
  const pos = starPosition(star, now, width, height);
  if (lastMelodyHitPos) {
    constellationSegments.push({ x1: lastMelodyHitPos.x, y1: lastMelodyHitPos.y, x2: pos.x, y2: pos.y, t: now });
  }
  lastMelodyHitPos = pos;
  const { next, completed } = advanceMelodyIndex(melodyIndex, MELODY.length);
  melodyIndex = next;
  if (completed) {
    if (status) status.textContent = "Melody complete — the sky is open.";
    completionMessageUntil = now + 2400;
    completionGlowUntil = now + 1400;
  } else {
    updateStatusText();
  }
}

// Plucks a star, boosting gain/decay/reverb for the current melody target or
// a "special" star, and advances the guide if — and only if — this is the
// star the guide is currently pointing at (and only in Guided Twinkle mode).
// A non-target hit in Guided mode still plucks the same star, just much
// quieter, so brushing past it never reads as a wrong note.
function pluckWithMelody(star: Star, gain: number, cutoffHz: number, now: number, pan: number, baseDecay?: number) {
  const isTarget = star === currentMelodyTarget();
  const { gainScale, advances } = resolveHit(playMode, isTarget);
  let decay = baseDecay;
  let reverbBoost = 1;
  if (gainScale >= 1) {
    if (star.special) decay = (decay ?? 0.7 + Math.random() * 0.9) * 1.6;
    if (isTarget) decay = Math.max(decay ?? 0, 1.1 + Math.random() * 0.3);
    reverbBoost = star.special ? 1.8 : 1;
  }
  const finalGain = isTarget && gainScale >= 1 ? gain * 1.15 * gainScale : gain * gainScale;
  pluck(star, finalGain, cutoffHz, now, decay, pan, reverbBoost);
  if (advances) advanceMelody(star, now);
}

// A hold can reach a little further than a gust, since it's a deliberate,
// stationary gesture rather than a passing brush — but it shares the gust
// radius rather than an unbounded one, for the same reason gustBurst is
// bounded.
function sustainNearest(x: number, y: number, holdMs: number, now: number) {
  const reach = triggerRadius("gust");
  let nearest: Star | null = null;
  let best = Infinity;
  for (const s of stars) {
    const pos = starPosition(s, now, width, height);
    const d = distance(x, y, pos.x, pos.y);
    if (d < best && d <= reach) {
      best = d;
      nearest = s;
    }
  }
  if (!nearest) return;
  pluckWithMelody(
    nearest,
    velocityToGain(0.9),
    velocityToCutoffHz(0.5),
    now,
    xToPan(x, width),
    holdDurationToDecay(holdMs),
  );
}

// --- Interaction shared by pointer and keyboard --------------------------

const TRIGGER_COOLDOWN_MS = 110;
let gustActive = false;
let gustTimer: number | undefined;

// Idle sound is an echo of recent play, not an independent voice: it only
// fires while roomEnergy (fed by real plucks, decaying every frame) is above
// a floor, so a page left alone eventually goes silent instead of reading as
// background music the page started on its own. It never touches the melody
// guide — only a genuine gesture can advance that.
let roomEnergy = 0;

function startGust() {
  gustActive = true;
  window.clearTimeout(gustTimer);
  gustTimer = window.setTimeout(() => {
    gustActive = false;
  }, 380);
}

function firstGesture() {
  ensureAudio();
  invite?.classList.add("faded");
  updateStatusText();
  status?.classList.add("visible");
}

function attemptTrigger(x: number, y: number, speed: number, now: number, pointerType: "normal" | "touch" = "normal") {
  const radius = triggerRadius(gustActive ? "gust" : pointerType);
  const gain = velocityToGain(speed);
  const cutoff = velocityToCutoffHz(speed);
  const pan = xToPan(x, width);
  for (const s of stars) {
    const pos = starPosition(s, now, width, height);
    if (distance(x, y, pos.x, pos.y) <= radius && now - s.lastTriggered > TRIGGER_COOLDOWN_MS) {
      pluckWithMelody(s, gain, cutoff, now, pan);
    }
  }
}

// A short-lived spark drawn near a gust's origin — smaller and quicker than
// the comet-particle decoration around the melody target, since a gust is a
// small nearby burst, not a wide effect.
const gustSparks: { x: number; y: number; t: number }[] = [];
const GUST_SPARK_MS = 320;

function gustBurst(x: number, y: number, now: number) {
  // A gust also plucks the nearest handful of stars immediately — a comet
  // burst — bounded to the same small radius as any other gust, so a
  // click/tap/space reads as a deliberate but nearby chord, not a reach
  // clear across the stage.
  const reach = triggerRadius("gust");
  const pan = xToPan(x, width);
  gustSparks.push({ x, y, t: now });
  const withDist = stars
    .map((s) => ({ s, d: distance(x, y, starPosition(s, now, width, height).x, starPosition(s, now, width, height).y) }))
    .filter(({ d }) => d <= reach)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  for (const { s } of withDist) {
    pluckWithMelody(s, velocityToGain(1.6), velocityToCutoffHz(1.6), now, pan);
  }
}

// --- Pointer / touch -------------------------------------------------------

let lastPointer: { x: number; y: number; t: number } | null = null;
let pointerDown: { x: number; y: number; t: number } | null = null;
let pointerHeading = 0;
const trail: { x: number; y: number; t: number }[] = [];
const TRAIL_MS = 260;
const POINTER_COMET_MS = 500;

function recordTrail(x: number, y: number, t: number) {
  trail.push({ x, y, t });
  while (trail.length && t - trail[0].t > TRAIL_MS) trail.shift();
}

stage.addEventListener("pointerdown", (e) => {
  firstGesture();
  startGust();
  const now = performance.now();
  gustBurst(e.offsetX, e.offsetY, now);
  lastPointer = { x: e.offsetX, y: e.offsetY, t: now };
  pointerDown = { x: e.offsetX, y: e.offsetY, t: now };
  recordTrail(e.offsetX, e.offsetY, now);
});

stage.addEventListener("pointermove", (e) => {
  const now = performance.now();
  if (lastPointer) {
    const dx = e.offsetX - lastPointer.x;
    const dy = e.offsetY - lastPointer.y;
    if (dx !== 0 || dy !== 0) pointerHeading = Math.atan2(dx, -dy);
    const dt = Math.max(1, now - lastPointer.t);
    const d = distance(e.offsetX, e.offsetY, lastPointer.x, lastPointer.y);
    const speed = d / dt;
    if (audioCtx) attemptTrigger(e.offsetX, e.offsetY, speed, now, e.pointerType === "touch" ? "touch" : "normal");
  }
  lastPointer = { x: e.offsetX, y: e.offsetY, t: now };
  recordTrail(e.offsetX, e.offsetY, now);
});

// Holding still (a small drag distance over a real hold) reads as "drawing
// out" one star rather than brushing past it, so it gets a longer sustain on
// release instead of the usual short pluck.
stage.addEventListener("pointerup", (e) => {
  const now = performance.now();
  if (pointerDown) {
    const holdMs = now - pointerDown.t;
    const moved = distance(e.offsetX, e.offsetY, pointerDown.x, pointerDown.y);
    if (holdMs > 150 && moved < 24 && audioCtx) {
      sustainNearest(e.offsetX, e.offsetY, holdMs, now);
    }
  }
  pointerDown = null;
});

stage.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);

// --- Keyboard ----------------------------------------------------------
// Bound to the window, not the stage: a stranger who presses an arrow key
// without first tabbing to the stage should still hear something.

const pressed = new Set<string>();
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const virtualCursor = { x: 0, y: 0, initialised: false, heading: 0 };
let keyboardActive = false;
let lastKeyboardActivity = -Infinity;
let spaceDownAt = -Infinity;

window.addEventListener("keydown", (e) => {
  // Let a player who has tabbed to the mode toggle use Space/Enter to
  // activate it normally, instead of the arrow/space handling below eating
  // the keystroke stage-wide.
  if (modeToggle?.contains(document.activeElement)) return;
  if (ARROW_KEYS.has(e.key) || e.key === " ") e.preventDefault();
  else return;
  firstGesture();
  keyboardActive = true;
  lastKeyboardActivity = performance.now();
  if (e.key === " ") {
    if (spaceDownAt === -Infinity) spaceDownAt = performance.now();
    startGust();
    gustBurst(virtualCursor.x, virtualCursor.y, performance.now());
  } else {
    pressed.add(e.key);
  }
});

window.addEventListener("keyup", (e) => {
  pressed.delete(e.key);
  if (e.key === " " && spaceDownAt !== -Infinity && audioCtx) {
    const holdMs = performance.now() - spaceDownAt;
    if (holdMs > 150) sustainNearest(virtualCursor.x, virtualCursor.y, holdMs, performance.now());
    spaceDownAt = -Infinity;
  }
});

const KEY_SPEED = 0.7; // px per ms

function updateVirtualCursor(dt: number, now: number) {
  if (!virtualCursor.initialised) {
    virtualCursor.x = width / 2;
    virtualCursor.y = height / 2;
    virtualCursor.initialised = true;
  }
  let dx = 0;
  let dy = 0;
  if (pressed.has("ArrowLeft")) dx -= 1;
  if (pressed.has("ArrowRight")) dx += 1;
  if (pressed.has("ArrowUp")) dy -= 1;
  if (pressed.has("ArrowDown")) dy += 1;
  if (dx === 0 && dy === 0) return;

  const mag = Math.hypot(dx, dy) || 1;
  const step = KEY_SPEED * dt;
  const prevX = virtualCursor.x;
  const prevY = virtualCursor.y;
  virtualCursor.heading = Math.atan2(dx, -dy);
  virtualCursor.x = clamp(virtualCursor.x + (dx / mag) * step, 0, width);
  virtualCursor.y = clamp(virtualCursor.y + (dy / mag) * step, 0, height);

  const speed = distance(virtualCursor.x, virtualCursor.y, prevX, prevY) / Math.max(1, dt);
  if (audioCtx) attemptTrigger(virtualCursor.x, virtualCursor.y, speed, now);
  recordTrail(virtualCursor.x, virtualCursor.y, now);
}

// --- Ambient idle: an echo of recent play, gated on roomEnergy -------------
// Deliberately calls pluck() directly, not pluckWithMelody: an idle star
// shimmering on its own is not a "genuine user-triggered match" and must
// never advance the melody guide.

let nextIdleAt = Infinity;

function maybeIdlePluck(now: number) {
  if (!audioCtx) return;
  if (roomEnergy < 0.08) return;
  if (now < nextIdleAt) return;
  const s = stars[Math.floor(Math.random() * stars.length)];
  pluck(s, (0.02 + Math.random() * 0.02) * roomEnergy, 900 + Math.random() * 1500, now);
  nextIdleAt = now + 4000 + Math.random() * 5000;
}

// --- Draw loop ---------------------------------------------------------

const RIPPLE_MS = 420;
let lastFrame = performance.now();

// A small comet — glowing head, tapering tail, a flicker of trailing dust
// while actively moving — shared by the keyboard's virtual cursor and the
// live mouse/touch pointer, so steering with either input feels like the
// same instrument rather than two different cursors.
function drawComet(x: number, y: number, heading: number, fade: number, moving: boolean, now: number) {
  ctx2d!.save();
  ctx2d!.translate(x, y);
  ctx2d!.rotate(heading);

  // Tapering tail, streaming behind the direction of travel.
  ctx2d!.beginPath();
  ctx2d!.moveTo(-2.6, -7);
  ctx2d!.quadraticCurveTo(0, -9, 2.6, -7);
  ctx2d!.quadraticCurveTo(1.1, 5, 0, 15);
  ctx2d!.quadraticCurveTo(-1.1, 5, -2.6, -7);
  ctx2d!.closePath();
  const tailGrad = ctx2d!.createLinearGradient(0, -7, 0, 15);
  tailGrad.addColorStop(0, `rgba(210, 230, 255, ${0.35 + fade * 0.4})`);
  tailGrad.addColorStop(1, "rgba(210, 230, 255, 0)");
  ctx2d!.fillStyle = tailGrad;
  ctx2d!.fill();

  if (moving) {
    for (let i = 0; i < 3; i++) {
      const flicker = 0.5 + 0.5 * Math.sin(now * 0.03 + i * 2.1);
      const len = 10 + i * 5 + flicker * 3;
      const spread = (i - 1) * 2.2;
      ctx2d!.beginPath();
      ctx2d!.arc(spread, len, 1.4 - i * 0.25, 0, Math.PI * 2);
      ctx2d!.fillStyle = `hsla(${205 + i * 8}, 80%, 88%, ${(0.5 - i * 0.15) * (0.4 + fade * 0.6)})`;
      ctx2d!.fill();
    }
  }

  // Glowing head (nucleus), drawn last so it sits in front of the tail.
  const headGrad = ctx2d!.createRadialGradient(0, -6, 0, 0, -6, 5);
  headGrad.addColorStop(0, `rgba(255, 250, 235, ${0.6 + fade * 0.4})`);
  headGrad.addColorStop(0.55, `rgba(255, 224, 150, ${0.35 + fade * 0.35})`);
  headGrad.addColorStop(1, "rgba(255, 224, 150, 0)");
  ctx2d!.beginPath();
  ctx2d!.arc(0, -6, 5, 0, Math.PI * 2);
  ctx2d!.fillStyle = headGrad;
  ctx2d!.fill();
  ctx2d!.beginPath();
  ctx2d!.arc(0, -6, 2.2, 0, Math.PI * 2);
  ctx2d!.fillStyle = `rgba(255, 255, 255, ${0.55 + fade * 0.4})`;
  ctx2d!.fill();
  ctx2d!.restore();
}

function draw(now: number) {
  const dt = now - lastFrame;
  lastFrame = now;

  updateVirtualCursor(dt, now);
  roomEnergy *= 0.999;
  if (nextIdleAt === Infinity && audioCtx) nextIdleAt = now + 4000;
  maybeIdlePluck(now);

  // The completion message is shown by directly setting #status's text
  // (bypassing updateStatusText's own guard); once its window passes, revert
  // to the normal guide/free-play text on the next frame that notices.
  if (completionMessageUntil !== -Infinity && now >= completionMessageUntil) {
    completionMessageUntil = -Infinity;
    updateStatusText();
  }

  ctx2d!.clearRect(0, 0, width, height);

  // The sweep/drag trail: a fading trace of stardust behind the gesture.
  if (trail.length > 1) {
    ctx2d!.beginPath();
    ctx2d!.moveTo(trail[0].x, trail[0].y);
    for (const p of trail) ctx2d!.lineTo(p.x, p.y);
    ctx2d!.strokeStyle = "rgba(225, 235, 255, 0.3)";
    ctx2d!.lineWidth = 2;
    ctx2d!.lineCap = "round";
    ctx2d!.stroke();
  }

  // Faint constellation path left behind by correctly-hit melody stars. Low
  // opacity and a short life so it never competes with free play.
  for (let i = constellationSegments.length - 1; i >= 0; i--) {
    const seg = constellationSegments[i];
    const age = now - seg.t;
    if (age > CONSTELLATION_MS) {
      constellationSegments.splice(i, 1);
      continue;
    }
    const alpha = (1 - age / CONSTELLATION_MS) * 0.32;
    ctx2d!.beginPath();
    ctx2d!.moveTo(seg.x1, seg.y1);
    ctx2d!.lineTo(seg.x2, seg.y2);
    ctx2d!.strokeStyle = `rgba(255, 224, 150, ${alpha})`;
    ctx2d!.lineWidth = 1.4;
    ctx2d!.stroke();
  }

  for (const s of stars) {
    const { x, y } = starPosition(s, now, width, height);
    s.energy *= 0.965;
    const glow = s.energy;
    const hue = hueForFreq(s.freq);
    const twinkle = 0.5 + 0.5 * Math.sin(now * 0.0015 + s.phase);
    const baseR = (s.special ? 3.6 : 2) + glow * 3.2;
    const lightness = clamp(60 + glow * 28 + twinkle * 6, 0, 96);
    const alpha = clamp(0.55 + twinkle * 0.25 + glow * 0.3, 0, 1);

    // A soft twinkling glint (cross of light) reads as a star, not a dot.
    const glintLen = baseR * (2.2 + glow * 1.4);
    ctx2d!.strokeStyle = `hsla(${hue}, 80%, ${Math.min(96, lightness + 10)}%, ${alpha * 0.55})`;
    ctx2d!.lineWidth = 1;
    ctx2d!.beginPath();
    ctx2d!.moveTo(x - glintLen, y);
    ctx2d!.lineTo(x + glintLen, y);
    ctx2d!.moveTo(x, y - glintLen);
    ctx2d!.lineTo(x, y + glintLen);
    ctx2d!.stroke();

    if (s.special) {
      ctx2d!.beginPath();
      ctx2d!.arc(x, y, baseR + 6, 0, Math.PI * 2);
      ctx2d!.fillStyle = `hsla(${hue}, 70%, 75%, ${0.1 + glow * 0.15})`;
      ctx2d!.fill();
    }

    ctx2d!.beginPath();
    ctx2d!.arc(x, y, baseR, 0, Math.PI * 2);
    ctx2d!.fillStyle = `hsla(${hue}, 85%, ${lightness}%, ${alpha})`;
    ctx2d!.fill();

    // A ripple ring expands outward for a moment right after a pluck.
    const sinceRipple = now - s.rippleStart;
    if (sinceRipple >= 0 && sinceRipple < RIPPLE_MS) {
      const t = sinceRipple / RIPPLE_MS;
      ctx2d!.beginPath();
      ctx2d!.arc(x, y, 6 + t * 30, 0, Math.PI * 2);
      ctx2d!.strokeStyle = `hsla(${hue}, 90%, 80%, ${(1 - t) * 0.5})`;
      ctx2d!.lineWidth = 2;
      ctx2d!.stroke();
    }
  }

  if (playMode === "guided") {
    // The current melody target: a gold, dashed, pulsing ring (shape, not
    // just colour, so it doesn't rely on colour perception alone) plus a few
    // comet-like particles drifting toward it. Purely decorative — it makes
    // no sound and only ever highlights, never plays, the next note.
    const target = currentMelodyTarget();
    const targetPos = starPosition(target, now, width, height);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
    ctx2d!.save();
    ctx2d!.setLineDash([5, 5]);
    ctx2d!.lineDashOffset = -now * 0.02;
    ctx2d!.beginPath();
    ctx2d!.arc(targetPos.x, targetPos.y, 14 + pulse * 4, 0, Math.PI * 2);
    ctx2d!.strokeStyle = `hsla(45, 95%, 70%, ${0.55 + pulse * 0.35})`;
    ctx2d!.lineWidth = 2.2;
    ctx2d!.stroke();
    ctx2d!.restore();

    const COMET_COUNT = 3;
    for (let i = 0; i < COMET_COUNT; i++) {
      const cycle = (now / 1100 + i / COMET_COUNT) % 1;
      const angle = (i * (Math.PI * 2)) / COMET_COUNT + now * 0.0006;
      const r = 34 * (1 - cycle);
      const px = targetPos.x + Math.cos(angle) * r;
      const py = targetPos.y + Math.sin(angle) * r;
      const alpha = (1 - cycle) * 0.8;
      ctx2d!.beginPath();
      ctx2d!.arc(px, py, 2, 0, Math.PI * 2);
      ctx2d!.fillStyle = `hsla(48, 95%, 82%, ${alpha})`;
      ctx2d!.fill();
    }

    // A one-time glow connecting all six melody anchors right after a full
    // Twinkle pass completes — purely decorative, plays no sound, and fades
    // on its own; it never gates or blocks anything.
    if (now < completionGlowUntil) {
      const glowAge = completionGlowUntil - now;
      const glowAlpha = clamp(glowAge / 1400, 0, 1) * 0.5;
      ctx2d!.beginPath();
      NOTE_ORDER.forEach((note, i) => {
        const pos = starPosition(melodyAnchors[note], now, width, height);
        if (i === 0) ctx2d!.moveTo(pos.x, pos.y);
        else ctx2d!.lineTo(pos.x, pos.y);
      });
      ctx2d!.closePath();
      ctx2d!.strokeStyle = `rgba(255, 224, 150, ${glowAlpha})`;
      ctx2d!.lineWidth = 2.4;
      ctx2d!.stroke();
    }
  }

  // Gust sparks: a small, quick burst near where a gust landed — smaller and
  // faster than the melody-target comet decoration above, since a gust is a
  // small nearby cluster, not a wide effect.
  for (let i = gustSparks.length - 1; i >= 0; i--) {
    const spark = gustSparks[i];
    const age = now - spark.t;
    if (age > GUST_SPARK_MS) {
      gustSparks.splice(i, 1);
      continue;
    }
    const t = age / GUST_SPARK_MS;
    ctx2d!.beginPath();
    ctx2d!.arc(spark.x, spark.y, 4 + t * 18, 0, Math.PI * 2);
    ctx2d!.strokeStyle = `rgba(210, 230, 255, ${(1 - t) * 0.6})`;
    ctx2d!.lineWidth = 1.6;
    ctx2d!.stroke();
  }

  // A small comet at the keyboard's virtual cursor, visible only while it
  // has been used recently — a keyboard-only player needs to see where they
  // are, without a big circle obscuring the stars underneath it. It points
  // the way it last moved, with a short flickering tail trailing behind.
  const sinceKey = now - lastKeyboardActivity;
  if (keyboardActive && sinceKey < 1600) {
    const fade = clamp(1 - sinceKey / 1600, 0, 1);
    const moving = pressed.size > 0;
    drawComet(virtualCursor.x, virtualCursor.y, virtualCursor.heading, fade, moving, now);
  }

  // The same comet trails the live mouse/touch pointer while it's actually
  // moving, so dragging across the sky reads the same as steering with the
  // keyboard — fading quickly once the pointer stops, since the browser's
  // own cursor already marks a resting position.
  const sincePointerMove = lastPointer ? now - lastPointer.t : Infinity;
  if (sincePointerMove < POINTER_COMET_MS) {
    const pointerFade = clamp(1 - sincePointerMove / POINTER_COMET_MS, 0, 1);
    const pointerMoving = sincePointerMove < 50;
    drawComet(lastPointer!.x, lastPointer!.y, pointerHeading, pointerFade, pointerMoving, now);
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
