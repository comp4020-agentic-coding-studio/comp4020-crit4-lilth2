// Pure mapping functions for the Driftglass instrument. No DOM, no
// AudioContext, no randomness — kept separate from main.ts so the contracts
// (speed -> loudness/brightness, gust -> reach, scale -> frequencies) are
// testable without a real audio graph. Whether it actually sounds good is a
// listening judgement these tests can't make; see PROCESS.md.

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// A major hexatonic scale (major scale minus the leading tone) still has no
// dissonant interval in it, so however a player strings notes together,
// nothing clashes — part of "no way to play it wrong" is making the note
// choices themselves forgiving. Unlike the pentatonic scale this project
// started with, it includes F, which "Twinkle, Twinkle, Little Star" needs.
export type NoteName = "C" | "D" | "E" | "F" | "G" | "A";

export const NOTE_ORDER: readonly NoteName[] = ["C", "D", "E", "F", "G", "A"];

export const NOTE_SEMITONES: Record<NoteName, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
};

export function noteToHz(note: NoteName, rootHz: number, octave: number, baseOctave = 3): number {
  const semitones = NOTE_SEMITONES[note] + (octave - baseOctave) * 12;
  return rootHz * 2 ** (semitones / 12);
}

// Walks the hexatonic scale as one continuous ladder of steps, six per
// octave, so a star field can be laid out by step index without every call
// site re-deriving note/octave arithmetic by hand.
export function noteAndOctaveAtStep(step: number, baseOctave = 3): { note: NoteName; octave: number } {
  const s = Math.max(0, Math.round(step));
  const note = NOTE_ORDER[s % NOTE_ORDER.length];
  const octave = baseOctave + Math.floor(s / NOTE_ORDER.length);
  return { note, octave };
}

export function hexatonicScale(rootHz: number, count: number): number[] {
  const freqs: number[] = [];
  for (let i = 0; i < count; i++) {
    const { note, octave } = noteAndOctaveAtStep(i);
    freqs.push(noteToHz(note, rootHz, octave));
  }
  return freqs;
}

// Maps a star's normalised vertical position (0 = top of the stage, 1 =
// bottom) onto a scale-step index, higher on screen -> higher pitch, so the
// "look up for a higher note" spatial intuition is a real, testable contract
// rather than just a rendering choice.
export function pitchIndexForY(yNorm: number, totalSteps: number): number {
  const norm = clamp(yNorm, 0, 1);
  const index = Math.round((1 - norm) * (totalSteps - 1));
  return clamp(index, 0, totalSteps - 1);
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
// Touch gets a slightly larger radius than a mouse/keyboard brush since a
// fingertip is imprecise, but not so large that it mis-hits neighbouring
// stars on a field this sparse (~30 stars across the whole stage).
export function triggerRadius(mode: "normal" | "touch" | "gust"): number {
  if (mode === "gust") return 85;
  if (mode === "touch") return 40;
  return 30;
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

// Free play: every star is a full, equal voice, nothing to get "wrong".
// Guided Twinkle: only the current melody target advances the guide and
// rings at full volume; every other star (including the other five anchors,
// off-turn) still sounds — just as a very light preview, so brushing past it
// on the way to the target never reads as a wrong note, and still glows
// (pluck() sets a star's visual energy regardless of gain).
export type PlayMode = "guided" | "free";

export const PREVIEW_GAIN_SCALE = 0.14;

export function resolveHit(mode: PlayMode, isTarget: boolean): { gainScale: number; advances: boolean } {
  if (mode === "free") return { gainScale: 1, advances: false };
  return isTarget ? { gainScale: 1, advances: true } : { gainScale: PREVIEW_GAIN_SCALE, advances: false };
}

// Steps the melody guide forward, wrapping back to the start. There is no
// end state — only a "just completed one full pass" event the caller can use
// to show a brief, non-blocking completion message before the guide keeps
// going, so a full Twinkle pass never reads as a finish line.
export function advanceMelodyIndex(index: number, length: number): { next: number; completed: boolean } {
  const completed = index >= length - 1;
  const next = completed ? 0 : index + 1;
  return { next, completed };
}
