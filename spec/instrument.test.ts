import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  clamp,
  distance,
  holdDurationToDecay,
  pentatonicScale,
  triggerRadius,
  velocityToCutoffHz,
  velocityToGain,
  xToPan,
} from "../audio-map.ts";

// This week's spec: "the player's choices shape what they hear", "a stranger
// can play it uninstructed", "no score, no fail state". A jsdom test can't
// hear the instrument or judge whether it feels good — that's the crit's
// job, see PROCESS.md — but the mapping from gesture to sound parameter, and
// the absence of a score/fail state, are contracts a test can hold.

describe("gesture -> sound mapping (audio-map.ts)", () => {
  it("louder and brighter the faster the player moves, never clipping or silent", () => {
    const slow = velocityToGain(0);
    const fast = velocityToGain(5);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeLessThanOrEqual(0.4);
    expect(fast).toBeGreaterThan(slow);

    const dark = velocityToCutoffHz(0);
    const bright = velocityToCutoffHz(5);
    expect(bright).toBeGreaterThan(dark);
  });

  it("a gust reaches further than an ordinary brush", () => {
    expect(triggerRadius(true)).toBeGreaterThan(triggerRadius(false));
  });

  it("the scale has no dissonant clash: every step is a consonant interval", () => {
    const freqs = pentatonicScale(220, 10);
    const CONSONANT_SEMITONES = new Set([0, 2, 3, 4, 5, 7, 8, 9, 10, 12]);
    for (let i = 1; i < freqs.length; i++) {
      const semitones = Math.round(12 * Math.log2(freqs[i] / freqs[0])) % 12;
      expect(CONSONANT_SEMITONES.has(semitones)).toBe(true);
    }
  });

  it("distance and clamp behave as plain geometry/bounds helpers", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("pans left/right with horizontal position and never exceeds the stereo field", () => {
    expect(xToPan(0, 1000)).toBeCloseTo(-1);
    expect(xToPan(1000, 1000)).toBeCloseTo(1);
    expect(xToPan(500, 1000)).toBeCloseTo(0);
    expect(xToPan(-500, 1000)).toBe(-1);
    expect(xToPan(1500, 1000)).toBe(1);
  });

  it("a longer hold sustains longer, within a bounded range", () => {
    const short = holdDurationToDecay(0);
    const long = holdDurationToDecay(5000);
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(0);
    expect(long).toBeLessThanOrEqual(holdDurationToDecay(100000));
  });
});

describe("the shipped page invites play without a score or fail state", () => {
  const distPath = resolve("dist/index.html");
  const doc = existsSync(distPath)
    ? new JSDOM(readFileSync(distPath, "utf8")).window.document
    : null;

  it("built the instrument page", () => {
    expect(doc, `${distPath} not found — run \`pnpm build\` first`).toBeTruthy();
  });

  it("has a focusable stage a keyboard-only player can reach", () => {
    const stage = doc!.querySelector('[data-testid="stage"]');
    expect(stage, "no element with data-testid=\"stage\"").toBeTruthy();
    expect(stage!.getAttribute("tabindex")).toBe("0");
  });

  it("names mouse, keyboard and touch somewhere a player or a screen reader can find before acting", () => {
    const stage = doc!.querySelector('[data-testid="stage"]');
    const label = (stage?.getAttribute("aria-label") ?? "") + (doc!.querySelector('[data-testid="invite"]')?.textContent ?? "");
    expect(label.toLowerCase()).toMatch(/touch/);
    expect(label.toLowerCase()).toMatch(/key/);
  });

  it("has no score, fail, win/lose, or game-over language anywhere on the page", () => {
    const text = doc!.body.textContent?.toLowerCase() ?? "";
    expect(text).not.toMatch(/\bscore\b/);
    expect(text).not.toMatch(/game over/);
    expect(text).not.toMatch(/\byou (win|lose|lost)\b/);
    expect(text).not.toMatch(/\bfail(ed|ure)?\b/);
  });

  it("ships no pre-recorded audio elements as the sound source", () => {
    expect(doc!.querySelectorAll("audio").length).toBe(0);
  });
});
