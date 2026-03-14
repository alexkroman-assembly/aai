// Copyright 2025 the AAI authors. MIT license.
import { encodeBase64 } from "@std/encoding/base64";
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  decodeMulaw,
  encodeMulaw,
  mulawToPcm16,
  pcm16ToMulaw,
  resample,
} from "./mulaw.ts";
import {
  createAudioBuffer,
  createTwilioClientSink,
  decodeTwilioFrame,
  type WsSink,
} from "./transport_twilio.ts";

// --- mulaw codec ---

Deno.test("mulaw roundtrip", async (t) => {
  await t.step("encode/decode stays within tolerance", () => {
    for (
      const sample of [0, 100, -100, 1000, -1000, 8000, -8000, 32000, -32000]
    ) {
      const decoded = decodeMulaw(encodeMulaw(sample));
      const tolerance = Math.max(Math.abs(sample) * 0.1, 16);
      assert(Math.abs(decoded - sample) <= tolerance);
    }
  });

  await t.step("second roundtrip is exact", () => {
    for (let s = -32000; s <= 32000; s += 1000) {
      const once = decodeMulaw(encodeMulaw(s));
      assertStrictEquals(once, decodeMulaw(encodeMulaw(once)));
    }
  });

  await t.step("silence encodes to 0xFF", () => {
    assertStrictEquals(encodeMulaw(0), 0xff);
  });
});

Deno.test("batch mulaw", () => {
  const pcm = new Int16Array([0, 1000, -1000, 16000, -16000]);
  const mulaw = pcm16ToMulaw(pcm);
  assertStrictEquals(mulaw.length, pcm.length);
  const decoded = mulawToPcm16(mulaw);
  assertStrictEquals(decoded.length, pcm.length);

  // Second roundtrip is exact
  assertEquals(mulawToPcm16(pcm16ToMulaw(decoded)), decoded);
});

// --- resampler ---

Deno.test("resample", async (t) => {
  await t.step("identity when rates match", () => {
    const s = new Int16Array([100, 200, 300]);
    assertEquals(resample(s, { fromRate: 8000, toRate: 8000 }), s);
  });

  await t.step("8kHz→16kHz doubles length and interpolates", () => {
    const r = resample(new Int16Array([0, 1000, 2000, 3000]), {
      fromRate: 8000,
      toRate: 16000,
    });
    assertStrictEquals(r.length, 8);
    assertStrictEquals(r[0], 0);
    assertStrictEquals(r[1], 500);
  });

  await t.step("24kHz→8kHz reduces by 3x", () => {
    const s = new Int16Array(24);
    for (let i = 0; i < 24; i++) s[i] = i * 100;
    assertStrictEquals(
      resample(s, { fromRate: 24000, toRate: 8000 }).length,
      8,
    );
  });
});

// --- audio buffer ---

Deno.test("createAudioBuffer", async (t) => {
  await t.step("accumulates until threshold then flushes", () => {
    const flushed: Uint8Array[] = [];
    const buf = createAudioBuffer((chunk) => flushed.push(chunk));

    // Push small chunk — should not flush (threshold is 3200 bytes)
    buf.push(new Uint8Array(1000));
    assertStrictEquals(flushed.length, 0);

    // Push enough to cross threshold
    buf.push(new Uint8Array(2200));
    assertStrictEquals(flushed.length, 1);
    assertStrictEquals(flushed[0]!.length, 3200);
  });

  await t.step("drain flushes remaining", () => {
    const flushed: Uint8Array[] = [];
    const buf = createAudioBuffer((chunk) => flushed.push(chunk));

    buf.push(new Uint8Array(500));
    assertStrictEquals(flushed.length, 0);

    buf.drain();
    assertStrictEquals(flushed.length, 1);
    assertStrictEquals(flushed[0]!.length, 500);
  });

  await t.step("drain with empty buffer is a no-op", () => {
    const flushed: Uint8Array[] = [];
    const buf = createAudioBuffer((chunk) => flushed.push(chunk));
    buf.drain();
    assertStrictEquals(flushed.length, 0);
  });
});

// --- decodeTwilioFrame ---

Deno.test("decodeTwilioFrame produces PCM16 bytes at 16kHz", () => {
  // 80 mulaw samples at 8kHz = 10ms → should produce 160 PCM16 samples at 16kHz = 320 bytes
  const mulaw = new Uint8Array(80).fill(0xff); // silence
  const b64 = encodeBase64(mulaw);
  const result = decodeTwilioFrame(b64);
  assertStrictEquals(result.length, 320); // 160 samples × 2 bytes
});

// --- twilio transport adapter ---

Deno.test("createTwilioClientSink", async (t) => {
  function mockWs(): {
    ws: WsSink;
    sent: string[];
    setReady(v: number): void;
  } {
    const sent: string[] = [];
    let readyState = 1;
    return {
      ws: {
        send: (data: string) => sent.push(data),
        get readyState() {
          return readyState;
        },
      },
      sent,
      setReady(v: number) {
        readyState = v;
      },
    };
  }

  await t.step("event method does not send to ws for text events", () => {
    const { ws, sent } = mockWs();
    const sink = createTwilioClientSink(ws);
    sink.event({ type: "transcript", text: "hello", isFinal: false });
    sink.event({ type: "transcript", text: "hello", isFinal: true });
    sink.event({ type: "turn", text: "hello" });
    sink.event({ type: "tts_done" });
    sink.event({ type: "cancelled" });
    sink.event({ type: "reset" });
    // chat and error just log, no ws send
    sink.event({ type: "chat", text: "hi" });
    sink.event({ type: "error", message: "oops" });
    assertStrictEquals(sent.length, 0);
  });

  await t.step("playAudioStream converts PCM16 to mulaw media event", async () => {
    const { ws, sent } = mockWs();
    const sink = createTwilioClientSink(ws);
    sink.streamSid = "stream-123";

    // Send 4 bytes of PCM16 (2 samples) via a ReadableStream
    const pcm = new Int16Array([1000, -1000]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(pcm.buffer));
        controller.close();
      },
    });
    sink.playAudioStream(stream);
    // Allow the async reader to consume
    await new Promise((r) => setTimeout(r, 10));

    assertStrictEquals(sent.length, 1);
    const msg = JSON.parse(sent[0]!);
    assertStrictEquals(msg.event, "media");
    assertStrictEquals(msg.streamSid, "stream-123");
    assertStrictEquals(typeof msg.media.payload, "string");
  });

  await t.step("playAudioStream skips when no streamSid", async () => {
    const { ws, sent } = mockWs();
    const sink = createTwilioClientSink(ws);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 0, 0]));
        controller.close();
      },
    });
    sink.playAudioStream(stream);
    await new Promise((r) => setTimeout(r, 10));
    assertStrictEquals(sent.length, 0);
  });

  await t.step("playAudioStream skips when socket not open", async () => {
    const mock = mockWs();
    mock.setReady(3);
    const sink = createTwilioClientSink(mock.ws);
    sink.streamSid = "stream-1";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 0, 0]));
        controller.close();
      },
    });
    sink.playAudioStream(stream);
    await new Promise((r) => setTimeout(r, 10));
    assertStrictEquals(mock.sent.length, 0);
  });

  await t.step("open reflects WebSocket readyState", () => {
    const mock = mockWs();
    const sink = createTwilioClientSink(mock.ws);
    assertStrictEquals(sink.open, true);
    mock.setReady(3);
    assertStrictEquals(sink.open, false);
  });
});
