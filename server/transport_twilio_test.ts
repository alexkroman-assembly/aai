import { encodeBase64 } from "@std/encoding/base64";
import { expect } from "@std/expect";
import {
  decodeMulaw,
  encodeMulaw,
  mulawToPcm16,
  pcm16ToMulaw,
  resample,
} from "./mulaw.ts";
import {
  createAudioBuffer,
  createTwilioTransport,
  decodeTwilioFrame,
} from "./transport_twilio.ts";

// --- mulaw codec ---

Deno.test("mulaw roundtrip", async (t) => {
  await t.step("encode/decode stays within tolerance", () => {
    for (
      const sample of [0, 100, -100, 1000, -1000, 8000, -8000, 32000, -32000]
    ) {
      const decoded = decodeMulaw(encodeMulaw(sample));
      const tolerance = Math.max(Math.abs(sample) * 0.1, 16);
      expect(
        Math.abs(decoded - sample) <= tolerance,
      ).toBe(true);
    }
  });

  await t.step("second roundtrip is exact", () => {
    for (let s = -32000; s <= 32000; s += 1000) {
      const once = decodeMulaw(encodeMulaw(s));
      expect(once).toBe(decodeMulaw(encodeMulaw(once)));
    }
  });

  await t.step("silence encodes to 0xFF", () => {
    expect(encodeMulaw(0)).toBe(0xff);
  });
});

Deno.test("batch mulaw", () => {
  const pcm = new Int16Array([0, 1000, -1000, 16000, -16000]);
  const mulaw = pcm16ToMulaw(pcm);
  expect(mulaw.length).toBe(pcm.length);
  const decoded = mulawToPcm16(mulaw);
  expect(decoded.length).toBe(pcm.length);

  // Second roundtrip is exact
  expect(mulawToPcm16(pcm16ToMulaw(decoded))).toEqual(decoded);
});

// --- resampler ---

Deno.test("resample", async (t) => {
  await t.step("identity when rates match", () => {
    const s = new Int16Array([100, 200, 300]);
    expect(resample(s, 8000, 8000)).toEqual(s);
  });

  await t.step("8kHz→16kHz doubles length and interpolates", () => {
    const r = resample(new Int16Array([0, 1000, 2000, 3000]), 8000, 16000);
    expect(r.length).toBe(8);
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(500);
  });

  await t.step("24kHz→8kHz reduces by 3x", () => {
    const s = new Int16Array(24);
    for (let i = 0; i < 24; i++) s[i] = i * 100;
    expect(resample(s, 24000, 8000).length).toBe(8);
  });
});

// --- audio buffer ---

Deno.test("createAudioBuffer", async (t) => {
  await t.step("accumulates until threshold then flushes", () => {
    const flushed: Uint8Array[] = [];
    const buf = createAudioBuffer((chunk) => flushed.push(chunk));

    // Push small chunk — should not flush (threshold is 3200 bytes)
    buf.push(new Uint8Array(1000));
    expect(flushed.length).toBe(0);

    // Push enough to cross threshold
    buf.push(new Uint8Array(2200));
    expect(flushed.length).toBe(1);
    expect(flushed[0].length).toBe(3200);
  });

  await t.step("drain flushes remaining", () => {
    const flushed: Uint8Array[] = [];
    const buf = createAudioBuffer((chunk) => flushed.push(chunk));

    buf.push(new Uint8Array(500));
    expect(flushed.length).toBe(0);

    buf.drain();
    expect(flushed.length).toBe(1);
    expect(flushed[0].length).toBe(500);
  });

  await t.step("drain with empty buffer is a no-op", () => {
    const flushed: Uint8Array[] = [];
    const buf = createAudioBuffer((chunk) => flushed.push(chunk));
    buf.drain();
    expect(flushed.length).toBe(0);
  });
});

// --- decodeTwilioFrame ---

Deno.test("decodeTwilioFrame produces PCM16 bytes at 16kHz", () => {
  // 80 mulaw samples at 8kHz = 10ms → should produce 160 PCM16 samples at 16kHz = 320 bytes
  const mulaw = new Uint8Array(80).fill(0xff); // silence
  const b64 = encodeBase64(mulaw);
  const result = decodeTwilioFrame(b64);
  expect(result.length).toBe(320); // 160 samples × 2 bytes
});

// --- twilio transport adapter ---

Deno.test("createTwilioTransport", async (t) => {
  function mockWs(): WebSocket & { sent: string[] } {
    const sent: string[] = [];
    return {
      readyState: WebSocket.OPEN,
      send(data: string) {
        sent.push(data);
      },
      sent,
    } as unknown as WebSocket & { sent: string[] };
  }

  await t.step("drops string messages (UI-only)", () => {
    const ws = mockWs();
    const t = createTwilioTransport(ws);
    t.send(JSON.stringify({ type: "ready" }));
    expect(ws.sent.length).toBe(0);
  });

  await t.step("converts PCM16 binary to mulaw media event", () => {
    const ws = mockWs();
    const transport = createTwilioTransport(ws);
    transport.streamSid = "stream-123";

    // Send 4 bytes of PCM16 (2 samples)
    const pcm = new Int16Array([1000, -1000]);
    transport.send(new Uint8Array(pcm.buffer));

    expect(ws.sent.length).toBe(1);
    const msg = JSON.parse(ws.sent[0]);
    expect(msg.event).toBe("media");
    expect(msg.streamSid).toBe("stream-123");
    expect(typeof msg.media.payload).toBe("string");
  });

  await t.step("skips binary when no streamSid", () => {
    const ws = mockWs();
    const transport = createTwilioTransport(ws);
    transport.send(new Uint8Array([0, 0, 0, 0]));
    expect(ws.sent.length).toBe(0);
  });

  await t.step("skips when socket not open", () => {
    const ws = mockWs();
    (ws as { readyState: number }).readyState = WebSocket.CLOSED;
    const transport = createTwilioTransport(ws);
    transport.streamSid = "stream-1";
    transport.send(new Uint8Array([0, 0, 0, 0]));
    expect(ws.sent.length).toBe(0);
  });
});
