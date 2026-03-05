import { expect } from "@std/expect";
import { float32ToInt16, resample } from "./resample.ts";

Deno.test("resample", async (t) => {
  await t.step("returns same array when rates match", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const out = resample(input, 16000, 16000);
    expect(out).toBe(input); // same reference
  });

  await t.step("returns empty array for empty input", () => {
    const out = resample(new Float32Array(0), 48000, 16000);
    expect(out.length).toBe(0);
  });

  await t.step("downsamples 24kHz to 16kHz (3:2 ratio)", () => {
    const input = new Float32Array(24);
    for (let i = 0; i < 24; i++) input[i] = i / 24;
    const out = resample(input, 24000, 16000);
    expect(out.length).toBe(16);
  });

  await t.step("upsamples 16kHz to 24kHz (2:3 ratio)", () => {
    const input = new Float32Array(16);
    for (let i = 0; i < 16; i++) input[i] = i / 16;
    const out = resample(input, 16000, 24000);
    expect(out.length).toBe(24);
  });

  await t.step("preserves DC signal through resampling", () => {
    const input = new Float32Array(100).fill(0.5);
    const out = resample(input, 24000, 16000);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(0.5, 5);
    }
  });

  await t.step("single sample input produces output", () => {
    const out = resample(new Float32Array([0.7]), 48000, 16000);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]).toBeCloseTo(0.7);
  });
});

Deno.test("float32ToInt16", async (t) => {
  await t.step("converts float values to int16 range", () => {
    const input = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
    const out = float32ToInt16(input);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(16384);
    expect(out[2]).toBe(-16384);
  });

  await t.step("clamps values beyond +-1.0", () => {
    const input = new Float32Array([2.0, -2.0]);
    const out = float32ToInt16(input);
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });

  await t.step("handles empty input", () => {
    const out = float32ToInt16(new Float32Array(0));
    expect(out.length).toBe(0);
  });
});
