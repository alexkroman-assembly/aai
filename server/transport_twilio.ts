import { concat } from "@std/bytes/concat";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { Hono } from "@hono/hono";
import { getLogger } from "./logger.ts";
import { loadPlatformConfig } from "./config.ts";
import {
  type AgentSlot,
  createRpcToolExecutor,
  ensureAgent,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import { createSession, type SessionTransport } from "./session.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
} from "./protocol.ts";

const log = getLogger("twilio");

// Mulaw codec

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;
const MULAW_RATE = 8000;

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

// Base64

// TwiML helper

export function twiml(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

// Twilio ↔ SessionTransport adapter
//
// Twilio sends mulaw 8kHz over JSON WebSocket messages.
// ServerSession expects a SessionTransport that receives PCM16 binary
// and sends PCM16 binary (TTS) or JSON strings (UI events).
// This adapter bridges the two: incoming mulaw → PCM16, outgoing PCM16 → mulaw.

export function createTwilioTransport(ws: WebSocket): SessionTransport & {
  streamSid: string | null;
} {
  let streamSid: string | null = null;

  return {
    get readyState() {
      return ws.readyState;
    },
    get streamSid() {
      return streamSid;
    },
    set streamSid(sid: string | null) {
      streamSid = sid;
    },
    send(data: string | ArrayBuffer | Uint8Array) {
      if (ws.readyState !== WebSocket.OPEN) return;

      if (typeof data === "string") {
        // JSON from ServerSession — log chat/error, drop UI-only messages
        try {
          const msg = JSON.parse(data) as Record<string, unknown>;
          if (msg.type === "chat") {
            log.info("Agent response", {
              text: (msg.text as string)?.slice(0, 100),
            });
          } else if (msg.type === "error") {
            log.error("Session error", { message: msg.message });
          }
        } catch { /* ignore */ }
        return;
      }

      // Binary = TTS audio (PCM16 at TTS sample rate) → convert to mulaw
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      if (!streamSid || bytes.length < 2) return;

      const pcm16 = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength >> 1,
      );
      const mulaw = pcm16ToMulaw(
        resample(pcm16, DEFAULT_TTS_SAMPLE_RATE, MULAW_RATE),
      );
      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: encodeBase64(mulaw) },
      }));
    },
  };
}

// Audio buffer — accumulates small Twilio frames into STT-friendly chunks.
// Twilio sends 20ms mulaw frames; AssemblyAI wants ≥100ms.
// At 16kHz PCM16: 100ms = 1600 samples × 2 bytes = 3200 bytes.

const MIN_AUDIO_BYTES = 3200;

export function createAudioBuffer(
  flush: (chunk: Uint8Array) => void,
): { push(data: Uint8Array): void; drain(): void } {
  let buf = new Uint8Array(0);
  return {
    push(data: Uint8Array) {
      buf = concat([buf, data]);
      if (buf.length >= MIN_AUDIO_BYTES) {
        flush(buf);
        buf = new Uint8Array(0);
      }
    },
    drain() {
      if (buf.length > 0) {
        flush(buf);
        buf = new Uint8Array(0);
      }
    },
  };
}

// Decode incoming Twilio media frame to PCM16 bytes at STT sample rate.

export function decodeTwilioFrame(payload: string): Uint8Array {
  const pcm16 = mulawToPcm16(decodeBase64(payload));
  const resampled = resample(pcm16, MULAW_RATE, DEFAULT_STT_SAMPLE_RATE);
  return new Uint8Array(
    resampled.buffer,
    resampled.byteOffset,
    resampled.byteLength,
  );
}

// Routes

export function createTwilioRoutes(ctx: {
  slots: Map<string, AgentSlot>;
  store: BundleStore;
}): Hono {
  const app = new Hono();

  function getTwilioSlot(slug: string): AgentSlot | null {
    const slot = ctx.slots.get(slug);
    return slot?.transport.includes("twilio") ? slot : null;
  }

  app.post("/:slug/twilio/voice", async (c) => {
    const slug = c.req.param("slug");
    const slot = getTwilioSlot(slug);
    if (!slot) return twiml("<Say>Agent not found. Goodbye.</Say>");

    try {
      await ensureAgent(slot, (s) => ctx.store.getFile(s, "worker"));
    } catch (err: unknown) {
      log.error("Failed to start agent for call", {
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
      return twiml(
        "<Say>Sorry, the agent is unavailable. Please try again later.</Say>",
      );
    }

    const host = c.req.header("host") ?? "localhost";
    const streamUrl = `wss://${host}/${slug}/twilio/stream`;
    log.info("Incoming call, connecting media stream", { slug, streamUrl });
    return twiml(`<Connect><Stream url="${streamUrl}" /></Connect>`);
  });

  app.get("/:slug/twilio/stream", async (c) => {
    const slug = c.req.param("slug");
    const slot = getTwilioSlot(slug);
    if (!slot) return c.json({ error: "Not found" }, 404);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "Expected WebSocket upgrade" }, 400);
    }

    let info;
    try {
      info = await ensureAgent(slot, (s) => ctx.store.getFile(s, "worker"));
    } catch (err: unknown) {
      log.error("Failed to initialize agent for media stream", { slug, err });
      return c.json({ error: "Agent failed to initialize" }, 500);
    }

    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    const transport = createTwilioTransport(socket);

    const session = createSession({
      id: `twilio-${crypto.randomUUID().slice(0, 8)}`,
      transport,
      agentConfig: info.config,
      toolSchemas: info.toolSchemas,
      platformConfig: loadPlatformConfig(slot.env),
      executeTool: createRpcToolExecutor(info.workerApi),
      secrets: slot.env,
    });

    trackSessionOpen(slot);

    const audioBuf = createAudioBuffer((chunk) => session.onAudio(chunk));

    socket.addEventListener("open", () => {
      log.info("Twilio media stream connected", { slug });
      void session.start();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let msg: {
        event: string;
        start?: { streamSid: string };
        media?: { payload: string };
      };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.event) {
        case "start":
          transport.streamSid = msg.start?.streamSid ?? null;
          log.info("Twilio stream started", {
            slug,
            streamSid: transport.streamSid,
          });
          session.onAudioReady();
          break;
        case "media":
          if (msg.media?.payload) {
            audioBuf.push(decodeTwilioFrame(msg.media.payload));
          }
          break;
        case "stop":
          audioBuf.drain();
          log.info("Twilio stream stopped", { slug });
          void session.stop();
          break;
      }
    });

    socket.addEventListener("close", () => {
      log.info("Twilio media stream disconnected", { slug });
      void session.stop();
      trackSessionClose(slot);
    });

    socket.addEventListener("error", (event) => {
      log.error("Twilio media stream error", {
        slug,
        error: event instanceof ErrorEvent ? event.message : "WebSocket error",
      });
    });

    return response;
  });

  return app;
}
