/**
 * Linear-interpolation resampler for voice audio.
 *
 * Sufficient quality for voice going to/from an STT model. Not suitable for
 * music or high-fidelity audio — use a polyphase filter for that.
 */
export function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  if (input.length === 0) return new Float32Array(0);
  const ratio = fromRate / toRate;
  const outLen = Math.ceil(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const idx = srcIdx | 0;
    const frac = srcIdx - idx;
    const a = input[idx];
    const b = idx + 1 < input.length ? input[idx + 1] : a;
    out[i] = a + frac * (b - a);
  }
  return out;
}

/** Convert Float32 PCM samples to Int16 PCM (clamped). */
export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i] * 32768;
    out[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
  }
  return out;
}
