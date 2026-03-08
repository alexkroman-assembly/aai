import { expect } from "@std/expect";
import {
  decodeMulaw,
  encodeMulaw,
  mulawToPcm16,
  pcm16ToMulaw,
  resample,
} from "./mulaw.ts";

Deno.test("encodeMulaw / decodeMulaw roundtrip", async (t) => {
  await t.step("silence encodes and decodes to near-zero", () => {
    const encoded = encodeMulaw(0);
    const decoded = decodeMulaw(encoded);
    expect(Math.abs(decoded)).toBeLessThan(10);
  });

  await t.step("positive sample roundtrips within tolerance", () => {
    const sample = 10000;
    const decoded = decodeMulaw(encodeMulaw(sample));
    // mulaw is lossy — allow ~2% error for mid-range values
    expect(Math.abs(decoded - sample) / sample).toBeLessThan(0.05);
  });

  await t.step("negative sample roundtrips within tolerance", () => {
    const sample = -10000;
    const decoded = decodeMulaw(encodeMulaw(sample));
    expect(Math.abs(decoded - sample) / Math.abs(sample)).toBeLessThan(0.05);
  });

  await t.step("clamps values beyond max", () => {
    const encoded = encodeMulaw(40000);
    const decoded = decodeMulaw(encoded);
    // Should be clamped to max representable value
    expect(decoded).toBeLessThanOrEqual(32767);
  });

  await t.step("byte range is 0-255", () => {
    for (const sample of [-32768, -1000, 0, 1000, 32767]) {
      const byte = encodeMulaw(sample);
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });
});

Deno.test("mulawToPcm16 / pcm16ToMulaw", async (t) => {
  await t.step("roundtrips buffer of samples", () => {
    const pcm = new Int16Array([0, 1000, -1000, 16000, -16000]);
    const mulaw = pcm16ToMulaw(pcm);
    expect(mulaw.length).toBe(pcm.length);

    const back = mulawToPcm16(mulaw);
    expect(back.length).toBe(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      expect(Math.abs(back[i] - pcm[i]) / (Math.abs(pcm[i]) || 1))
        .toBeLessThan(0.1);
    }
  });

  await t.step("handles empty input", () => {
    expect(mulawToPcm16(new Uint8Array(0)).length).toBe(0);
    expect(pcm16ToMulaw(new Int16Array(0)).length).toBe(0);
  });
});

Deno.test("resample", async (t) => {
  await t.step("returns same array when rates match", () => {
    const input = new Int16Array([100, 200, 300]);
    const out = resample(input, 8000, 8000);
    expect(out).toBe(input);
  });

  await t.step("downsamples correctly", () => {
    const input = new Int16Array(16);
    for (let i = 0; i < 16; i++) input[i] = i * 100;
    const out = resample(input, 16000, 8000);
    expect(out.length).toBe(8);
  });

  await t.step("upsamples correctly", () => {
    const input = new Int16Array(8);
    for (let i = 0; i < 8; i++) input[i] = i * 100;
    const out = resample(input, 8000, 16000);
    expect(out.length).toBe(16);
  });

  await t.step("preserves DC signal", () => {
    const input = new Int16Array(100).fill(5000);
    const out = resample(input, 16000, 8000);
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i] - 5000)).toBeLessThan(2);
    }
  });
});
