import {
  clamp,
  detune,
  distance,
  pentatonicScale,
  triggerRadius,
  velocityToCutoffHz,
  velocityToGain,
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

function pluck(chime: Chime, gain: number, cutoffHz: number, now: number) {
  const ac = ensureAudio();
  chime.lastTriggered = now;
  chime.energy = 1;

  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = detune(chime.freq, Math.random());

  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(cutoffHz, 400, 12000);
  filter.Q.value = 0.5;

  const env = ac.createGain();
  const t0 = ac.currentTime;
  const decay = 0.7 + Math.random() * 0.9;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

  osc.connect(filter);
  filter.connect(env);
  env.connect(masterGain!);
  env.connect(delaySend!);

  osc.start(t0);
  osc.stop(t0 + decay + 0.05);
  osc.addEventListener("ended", () => {
    osc.disconnect();
    filter.disconnect();
    env.disconnect();
  });
}

// --- Interaction shared by pointer and keyboard --------------------------

const TRIGGER_COOLDOWN_MS = 110;
let gustActive = false;
let gustTimer: number | undefined;

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
  for (const c of chimes) {
    const pos = chimePosition(c, now, width, height);
    if (distance(x, y, pos.x, pos.y) <= radius && now - c.lastTriggered > TRIGGER_COOLDOWN_MS) {
      pluck(c, gain, cutoff, now);
    }
  }
}

function gustBurst(x: number, y: number, now: number) {
  // A gust also plucks the nearest handful of chimes immediately, so a
  // click/tap/space reads as a deliberate chord, not just a wider brush.
  const withDist = chimes
    .map((c) => ({ c, d: distance(x, y, chimePosition(c, now, width, height).x, chimePosition(c, now, width, height).y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  for (const { c } of withDist) {
    pluck(c, velocityToGain(1.6), velocityToCutoffHz(1.6), now);
  }
}

// --- Pointer / touch -------------------------------------------------------

let lastPointer: { x: number; y: number; t: number } | null = null;

stage.addEventListener("pointerdown", (e) => {
  firstGesture();
  startGust();
  const now = performance.now();
  gustBurst(e.offsetX, e.offsetY, now);
  lastPointer = { x: e.offsetX, y: e.offsetY, t: now };
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
});

stage.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);

// --- Keyboard --------------------------------------------------------------

const pressed = new Set<string>();
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const virtualCursor = { x: 0, y: 0, initialised: false };

stage.addEventListener("keydown", (e) => {
  if (ARROW_KEYS.has(e.key) || e.key === " ") e.preventDefault();
  firstGesture();
  if (e.key === " ") {
    startGust();
    gustBurst(virtualCursor.x, virtualCursor.y, performance.now());
  }
  pressed.add(e.key);
});

stage.addEventListener("keyup", (e) => {
  pressed.delete(e.key);
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
}

// --- Ambient idle (very soft, only after the player has begun) ------------

let nextIdleAt = Infinity;

function maybeIdlePluck(now: number) {
  if (!audioCtx) return;
  if (now < nextIdleAt) return;
  const c = chimes[Math.floor(Math.random() * chimes.length)];
  pluck(c, 0.03 + Math.random() * 0.03, 900 + Math.random() * 1500, now);
  nextIdleAt = now + 4000 + Math.random() * 5000;
}

// --- Draw loop ---------------------------------------------------------

let lastFrame = performance.now();

function draw(now: number) {
  const dt = now - lastFrame;
  lastFrame = now;

  updateVirtualCursor(dt, now);
  if (nextIdleAt === Infinity && audioCtx) nextIdleAt = now + 4000;
  maybeIdlePluck(now);

  ctx2d!.clearRect(0, 0, width, height);
  for (const c of chimes) {
    const { x, y } = chimePosition(c, now, width, height);
    c.energy *= 0.965;
    const hueFromPitch = clamp(220 - Math.log2(c.freq / 196) * 22, 150, 220);
    const r = 5 + c.energy * 14;
    ctx2d!.beginPath();
    ctx2d!.arc(x, y, r, 0, Math.PI * 2);
    ctx2d!.fillStyle = `hsla(${hueFromPitch}, 85%, ${68 + c.energy * 20}%, ${0.35 + c.energy * 0.6})`;
    ctx2d!.fill();
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
