import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  advanceMelodyIndex,
  clamp,
  distance,
  hexatonicScale,
  holdDurationToDecay,
  noteToHz,
  pitchIndexForY,
  resolveHit,
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

  it("trigger radii are small and ordered normal < touch < gust, within the agreed ranges", () => {
    const normal = triggerRadius("normal");
    const touch = triggerRadius("touch");
    const gust = triggerRadius("gust");
    expect(normal).toBeGreaterThanOrEqual(26);
    expect(normal).toBeLessThanOrEqual(36);
    expect(touch).toBeGreaterThanOrEqual(34);
    expect(touch).toBeLessThanOrEqual(44);
    expect(gust).toBeGreaterThanOrEqual(70);
    expect(gust).toBeLessThanOrEqual(95);
    expect(touch).toBeGreaterThan(normal);
    expect(gust).toBeGreaterThan(touch);
  });

  it("resolveHit: free play never advances the guide and never scales volume down", () => {
    expect(resolveHit("free", true)).toEqual({ gainScale: 1, advances: false });
    expect(resolveHit("free", false)).toEqual({ gainScale: 1, advances: false });
  });

  it("resolveHit: guided mode advances only on the target, and a non-target hit is quiet, not silent or wrong", () => {
    const onTarget = resolveHit("guided", true);
    expect(onTarget.advances).toBe(true);
    expect(onTarget.gainScale).toBe(1);

    const offTarget = resolveHit("guided", false);
    expect(offTarget.advances).toBe(false);
    expect(offTarget.gainScale).toBeGreaterThan(0);
    expect(offTarget.gainScale).toBeLessThan(0.3);
  });

  it("advanceMelodyIndex steps forward, and wraps to 0 with completed=true only at the last step", () => {
    expect(advanceMelodyIndex(0, 5)).toEqual({ next: 1, completed: false });
    expect(advanceMelodyIndex(3, 5)).toEqual({ next: 4, completed: false });
    expect(advanceMelodyIndex(4, 5)).toEqual({ next: 0, completed: true });
  });

  it("the scale has no dissonant clash: every step is a consonant interval", () => {
    const freqs = hexatonicScale(220, 12);
    const CONSONANT_SEMITONES = new Set([0, 2, 3, 4, 5, 7, 8, 9, 10, 12]);
    for (let i = 1; i < freqs.length; i++) {
      const semitones = Math.round(12 * Math.log2(freqs[i] / freqs[0])) % 12;
      expect(CONSONANT_SEMITONES.has(semitones)).toBe(true);
    }
  });

  it("note names map to monotonically rising frequencies within an octave, C to G is a fifth", () => {
    const c = noteToHz("C", 220, 3, 3);
    const d = noteToHz("D", 220, 3, 3);
    const e = noteToHz("E", 220, 3, 3);
    const f = noteToHz("F", 220, 3, 3);
    const g = noteToHz("G", 220, 3, 3);
    const a = noteToHz("A", 220, 3, 3);
    expect(c).toBeLessThan(d);
    expect(d).toBeLessThan(e);
    expect(e).toBeLessThan(f);
    expect(f).toBeLessThan(g);
    expect(g).toBeLessThan(a);
    expect(g / c).toBeCloseTo(2 ** (7 / 12));

    const cNextOctave = noteToHz("C", 220, 4, 3);
    expect(cNextOctave / c).toBeCloseTo(2);
  });

  it("higher on screen means a higher pitch step, lower means lower, monotonically", () => {
    const totalSteps = 24;
    const top = pitchIndexForY(0, totalSteps);
    const mid = pitchIndexForY(0.5, totalSteps);
    const bottom = pitchIndexForY(1, totalSteps);
    expect(top).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(bottom);
    expect(top).toBe(totalSteps - 1);
    expect(bottom).toBe(0);
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

  it("has a live-region status node for the melody guide, distinct from the invite text", () => {
    const status = doc!.querySelector('[data-testid="status"]');
    expect(status, 'no element with data-testid="status"').toBeTruthy();
    expect(status!.getAttribute("aria-live")).toBe("polite");
  });

  it("has a Free play / Guided Twinkle mode toggle reachable without a mouse", () => {
    const toggle = doc!.querySelector('[data-testid="mode-toggle"]');
    expect(toggle, 'no element with data-testid="mode-toggle"').toBeTruthy();
    const labels = Array.from(toggle!.querySelectorAll("button")).map((b) => b.textContent?.toLowerCase() ?? "");
    expect(labels.some((l) => l.includes("guided"))).toBe(true);
    expect(labels.some((l) => l.includes("free"))).toBe(true);
  });

  it("invites following a glowing star without requiring it, so free play is never blocked", () => {
    const invite = doc!.querySelector('[data-testid="invite"]')?.textContent?.toLowerCase() ?? "";
    const status = doc!.querySelector('[data-testid="status"]')?.textContent?.toLowerCase() ?? "";
    expect(invite + status).toMatch(/star/);
    expect(invite).toMatch(/freely|free/);
  });

  it("has no score, fail, win/lose, or game-over language anywhere on the page", () => {
    const text = doc!.body.textContent?.toLowerCase() ?? "";
    expect(text).not.toMatch(/\bscore\b/);
    expect(text).not.toMatch(/game over/);
    expect(text).not.toMatch(/\byou (win|lose|lost)\b/);
    expect(text).not.toMatch(/\bfail(ed|ure)?\b/);
    expect(text).not.toMatch(/\bwrong\b/);
  });

  it("ships no pre-recorded audio elements as the sound source", () => {
    expect(doc!.querySelectorAll("audio").length).toBe(0);
  });
});
