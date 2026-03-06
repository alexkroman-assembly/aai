const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

const DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const mu = ~i & 0xff;
  const sign = mu & 0x80;
  const exp = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let mag = ((mantissa << 1) + 33) << (exp + 2);
  mag -= MULAW_BIAS;
  DECODE_TABLE[i] = sign ? -mag : mag;
}

export function decodeMulaw(byte: number): number {
  return DECODE_TABLE[byte & 0xff];
}

export function encodeMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let mag = Math.abs(sample);
  if (mag > MULAW_CLIP) mag = MULAW_CLIP;
  mag += MULAW_BIAS;

  let exp = 7;
  for (let i = 0; i < 8; i++) {
    if (mag & (0x4000 >> i)) {
      exp = 7 - i;
      break;
    }
  }

  return ~(sign | (exp << 4) | ((mag >> (exp + 3)) & 0x0f)) & 0xff;
}

export function mulawToPcm16(mulaw: Uint8Array): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) out[i] = DECODE_TABLE[mulaw[i]];
  return out;
}

export function pcm16ToMulaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = encodeMulaw(pcm[i]);
  return out;
}

export function resample(
  samples: Int16Array,
  fromRate: number,
  toRate: number,
): Int16Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const len = Math.ceil(samples.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const src = i * ratio;
    const idx = Math.floor(src);
    const frac = src - idx;
    out[i] = idx + 1 < samples.length
      ? Math.round(samples[idx] * (1 - frac) + samples[idx + 1] * frac)
      : samples[Math.min(idx, samples.length - 1)];
  }
  return out;
}
