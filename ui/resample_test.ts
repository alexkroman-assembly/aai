import { expect } from "@std/expect";
import { resample } from "./resample.ts";

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
