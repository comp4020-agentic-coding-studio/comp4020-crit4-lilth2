// Pure mapping functions for the Driftglass instrument. No DOM, no
// AudioContext, no randomness — kept separate from main.ts so the contracts
// (speed -> loudness/brightness, gust -> reach, scale -> frequencies) are
// testable without a real audio graph. Whether it actually sounds good is a
// listening judgement these tests can't make; see PROCESS.md.

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// A major pentatonic scale has no dissonant interval in it, so however a
// player strings notes together, nothing clashes — part of "no way to play
// it wrong" is making the note choices themselves forgiving.
const PENTATONIC_STEPS = [0, 2, 4, 7, 9];

export function pentatonicScale(rootHz: number, count: number): number[] {
  const freqs: number[] = [];
  for (let i = 0; i < count; i++) {
    const octave = Math.floor(i / PENTATONIC_STEPS.length);
    const step = PENTATONIC_STEPS[i % PENTATONIC_STEPS.length];
    const semitones = octave * 12 + step;
    freqs.push(rootHz * 2 ** (semitones / 12));
  }
  return freqs;
}

// Speed is in canvas pixels per millisecond of pointer/keyboard-cursor
// movement. Both mappings saturate rather than clip, so a wild swipe can't
// produce a harsh or silent extreme.
const SPEED_NORM = 1.6;

export function velocityToGain(speed: number): number {
  const norm = clamp(speed / SPEED_NORM, 0, 1);
  return 0.05 + norm * 0.35;
}

export function velocityToCutoffHz(speed: number): number {
  const norm = clamp(speed / SPEED_NORM, 0, 1);
  return 500 + norm * 6000;
}

// A gust (click/tap/space) widens how far a gesture reaches so it reads as a
// distinct, deliberate action rather than the same brush at a bigger radius.
export function triggerRadius(gustActive: boolean): number {
  return gustActive ? 150 : 60;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

// Detune a chime's frequency slightly and unpredictably per pluck so the
// same chime never rings back exactly the same way twice.
export function detune(freq: number, randomUnit: number): number {
  const cents = (randomUnit - 0.5) * 12; // +/- 6 cents
  return freq * 2 ** (cents / 1200);
}

export function xToPan(x: number, width: number): number {
  if (width <= 0) return 0;
  return clamp((x / width) * 2 - 1, -1, 1);
}

const MIN_DECAY = 0.7;
const MAX_DECAY = 3.2;
const HOLD_NORM_MS = 1400;

export function holdDurationToDecay(holdMs: number): number {
  const norm = clamp(holdMs / HOLD_NORM_MS, 0, 1);
  return MIN_DECAY + norm * (MAX_DECAY - MIN_DECAY);
}
