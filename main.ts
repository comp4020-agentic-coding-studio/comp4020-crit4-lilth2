import {
  clamp,
  detune,
  distance,
  holdDurationToDecay,
  pentatonicScale,
  triggerRadius,
  velocityToCutoffHz,
  velocityToGain,
  xToPan,
} from "./audio-map.ts";

// --- DOM -------------------------------------------------------------

const stage = document.querySelector<HTMLElement>('[data-testid="stage"]');
const canvas = document.querySelector<HTMLCanvasElement>("#chimes");
const invite = document.querySelector<HTMLElement>('[data-testid="invite"]');
if (!stage || !canvas) throw new Error("Driftglass: stage or canvas missing from the page");
const ctx2d = canvas.getContext("2d");
if (!ctx2d) throw new Error("Driftglass: 2D canvas context unavailable");

// --- Chimes ------------------------------------------------------------

interface Chime {
  fx: number; // fractional home position, 0..1
  fy: number;
  freq: number;
  phase: number;
  bobAmp: number;
  bobSpeed: number;
  energy: number; // 0..1, decays each frame, drives the visual glow
  lastTriggered: number;
  rippleStart: number;
}

const CHIME_COUNT = 22;
const chimes: Chime[] = [];

function buildChimes() {
  chimes.length = 0;
  // Highest notes live near the top of the screen, lowest near the bottom,
  // so pitch has a spatial logic a player can feel out without reading it.
  const freqs = pentatonicScale(196, CHIME_COUNT).reverse();
  for (let i = 0; i < CHIME_COUNT; i++) {
    const row = i % 6;
    const col = Math.floor(i / 6);
    chimes.push({
      fx: 0.08 + col * 0.22 + (row % 2) * 0.06,
      fy: 0.12 + row * 0.15,
      freq: freqs[i],
      phase: i * 1.7,
      bobAmp: 8 + (i % 5) * 2,
      bobSpeed: 0.0006 + (i % 4) * 0.00015,
      energy: 0,
      lastTriggered: -Infinity,
      rippleStart: -Infinity,
    });
  }
}
buildChimes();

function chimePosition(c: Chime, t: number, w: number, h: number) {
  const x = c.fx * w + Math.sin(t * c.bobSpeed + c.phase) * c.bobAmp;
  const y = c.fy * h + Math.cos(t * c.bobSpeed * 0.7 + c.phase) * c.bobAmp * 0.6;
  return { x, y };
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
  // asset to fetch, still gives the chimes somewhere to hang in the air.
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

function pluck(chime: Chime, gain: number, cutoffHz: number, now: number, decayOverride?: number, pan = 0) {
  const ac = ensureAudio();
  chime.lastTriggered = now;
  chime.energy = 1;
  chime.rippleStart = now;
  roomEnergy = Math.min(1, roomEnergy + 0.28);

  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = detune(chime.freq, Math.random());

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

  osc.connect(filter);
  filter.connect(panner);
  panner.connect(env);
  env.connect(masterGain!);
  env.connect(delaySend!);

  osc.start(t0);
  osc.stop(t0 + decay + 0.05);
  osc.addEventListener("ended", () => {
    osc.disconnect();
    filter.disconnect();
    panner.disconnect();
    env.disconnect();
  });
}

// A deliberate hold-and-release (little movement, held past a threshold)
// plucks the nearest chime with sustain proportional to how long it was held,
// instead of the usual short pluck — a second way to shape the sound besides
// sweep speed.
function sustainNearest(x: number, y: number, holdMs: number, now: number) {
  let nearest: Chime | null = null;
  let best = Infinity;
  for (const c of chimes) {
    const pos = chimePosition(c, now, width, height);
    const d = distance(x, y, pos.x, pos.y);
    if (d < best) {
      best = d;
      nearest = c;
    }
  }
  if (!nearest) return;
  pluck(nearest, velocityToGain(0.9), velocityToCutoffHz(0.5), now, holdDurationToDecay(holdMs), xToPan(x, width));
}

// --- Interaction shared by pointer and keyboard --------------------------

const TRIGGER_COOLDOWN_MS = 110;
let gustActive = false;
let gustTimer: number | undefined;

// Idle sound is an echo of recent play, not an independent voice: it only
// fires while roomEnergy (fed by real plucks, decaying every frame) is above
// a floor, so a page left alone eventually goes silent instead of reading as
// background music the page started on its own.
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
}

function attemptTrigger(x: number, y: number, speed: number, now: number) {
  const radius = triggerRadius(gustActive);
  const gain = velocityToGain(speed);
  const cutoff = velocityToCutoffHz(speed);
  const pan = xToPan(x, width);
  for (const c of chimes) {
    const pos = chimePosition(c, now, width, height);
    if (distance(x, y, pos.x, pos.y) <= radius && now - c.lastTriggered > TRIGGER_COOLDOWN_MS) {
      pluck(c, gain, cutoff, now, undefined, pan);
    }
  }
}

function gustBurst(x: number, y: number, now: number) {
  // A gust also plucks the nearest handful of chimes immediately, so a
  // click/tap/space reads as a deliberate chord, not just a wider brush.
  const pan = xToPan(x, width);
  const withDist = chimes
    .map((c) => ({ c, d: distance(x, y, chimePosition(c, now, width, height).x, chimePosition(c, now, width, height).y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  for (const { c } of withDist) {
    pluck(c, velocityToGain(1.6), velocityToCutoffHz(1.6), now, undefined, pan);
  }
}

// --- Pointer / touch -------------------------------------------------------

let lastPointer: { x: number; y: number; t: number } | null = null;
let pointerDown: { x: number; y: number; t: number } | null = null;
const trail: { x: number; y: number; t: number }[] = [];
const TRAIL_MS = 260;

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
    const dt = Math.max(1, now - lastPointer.t);
    const d = distance(e.offsetX, e.offsetY, lastPointer.x, lastPointer.y);
    const speed = d / dt;
    if (audioCtx) attemptTrigger(e.offsetX, e.offsetY, speed, now);
  }
  lastPointer = { x: e.offsetX, y: e.offsetY, t: now };
  recordTrail(e.offsetX, e.offsetY, now);
});

// Holding still (a small drag distance over a real hold) reads as "drawing
// out" one chime rather than brushing past it, so it gets a longer sustain
// on release instead of the usual short pluck.
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
const virtualCursor = { x: 0, y: 0, initialised: false };
let keyboardActive = false;
let lastKeyboardActivity = -Infinity;
let spaceDownAt = -Infinity;

window.addEventListener("keydown", (e) => {
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
  virtualCursor.x = clamp(virtualCursor.x + (dx / mag) * step, 0, width);
  virtualCursor.y = clamp(virtualCursor.y + (dy / mag) * step, 0, height);

  const speed = distance(virtualCursor.x, virtualCursor.y, prevX, prevY) / Math.max(1, dt);
  if (audioCtx) attemptTrigger(virtualCursor.x, virtualCursor.y, speed, now);
  recordTrail(virtualCursor.x, virtualCursor.y, now);
}

// --- Ambient idle: an echo of recent play, gated on roomEnergy -------------

let nextIdleAt = Infinity;

function maybeIdlePluck(now: number) {
  if (!audioCtx) return;
  if (roomEnergy < 0.08) return;
  if (now < nextIdleAt) return;
  const c = chimes[Math.floor(Math.random() * chimes.length)];
  pluck(c, (0.02 + Math.random() * 0.02) * roomEnergy, 900 + Math.random() * 1500, now);
  nextIdleAt = now + 4000 + Math.random() * 5000;
}

// --- Draw loop ---------------------------------------------------------

const RIPPLE_MS = 420;
let lastFrame = performance.now();

function draw(now: number) {
  const dt = now - lastFrame;
  lastFrame = now;

  updateVirtualCursor(dt, now);
  roomEnergy *= 0.999;
  if (nextIdleAt === Infinity && audioCtx) nextIdleAt = now + 4000;
  maybeIdlePluck(now);

  ctx2d!.clearRect(0, 0, width, height);

  // The sweep/drag trail: the visible trace of "this gesture caused that sound".
  if (trail.length > 1) {
    ctx2d!.beginPath();
    ctx2d!.moveTo(trail[0].x, trail[0].y);
    for (const p of trail) ctx2d!.lineTo(p.x, p.y);
    ctx2d!.strokeStyle = "rgba(210, 235, 255, 0.35)";
    ctx2d!.lineWidth = 2;
    ctx2d!.lineCap = "round";
    ctx2d!.stroke();
  }

  for (const c of chimes) {
    const { x, y } = chimePosition(c, now, width, height);
    const anchorX = c.fx * width;
    c.energy *= 0.965;
    const hueFromPitch = clamp(220 - Math.log2(c.freq / 196) * 22, 150, 220);
    const glow = c.energy;

    // A thread from a fixed anchor above down to the bobbing chime, so it
    // reads as something hanging in the air rather than a floating dot.
    ctx2d!.beginPath();
    ctx2d!.moveTo(anchorX, -10);
    ctx2d!.lineTo(x, y);
    ctx2d!.strokeStyle = `rgba(200, 220, 240, ${0.12 + glow * 0.25})`;
    ctx2d!.lineWidth = 1;
    ctx2d!.stroke();

    // The chime itself: an elongated glass shard, angled toward its thread,
    // so it catches the eye as a physical object rather than a marker.
    const angle = Math.atan2(y - -10, x - anchorX);
    const len = 9 + glow * 6;
    const wid = 4 + glow * 4;
    ctx2d!.save();
    ctx2d!.translate(x, y);
    ctx2d!.rotate(angle);
    ctx2d!.beginPath();
    ctx2d!.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
    ctx2d!.fillStyle = `hsla(${hueFromPitch}, 85%, ${68 + glow * 20}%, ${0.45 + glow * 0.5})`;
    ctx2d!.fill();
    ctx2d!.restore();

    // A ripple ring expands outward for a moment right after a pluck.
    const sinceRipple = now - c.rippleStart;
    if (sinceRipple >= 0 && sinceRipple < RIPPLE_MS) {
      const t = sinceRipple / RIPPLE_MS;
      ctx2d!.beginPath();
      ctx2d!.arc(x, y, 6 + t * 34, 0, Math.PI * 2);
      ctx2d!.strokeStyle = `hsla(${hueFromPitch}, 90%, 75%, ${(1 - t) * 0.5})`;
      ctx2d!.lineWidth = 2;
      ctx2d!.stroke();
    }
  }

  // A soft ring at the keyboard's virtual cursor, visible only while it has
  // been used recently — a keyboard-only player needs to see where they are.
  const sinceKey = now - lastKeyboardActivity;
  if (keyboardActive && sinceKey < 1600) {
    const fade = clamp(1 - sinceKey / 1600, 0, 1);
    ctx2d!.beginPath();
    ctx2d!.arc(virtualCursor.x, virtualCursor.y, 16, 0, Math.PI * 2);
    ctx2d!.strokeStyle = `rgba(255, 255, 255, ${0.15 + fade * 0.35})`;
    ctx2d!.lineWidth = 1.5;
    ctx2d!.stroke();
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
