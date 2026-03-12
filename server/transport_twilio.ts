import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { concat } from "@std/bytes/concat";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { type AgentSlot, prepareSession } from "./worker_pool.ts";
import { createSession, type SessionTransport } from "./session.ts";
import type { HonoEnv } from "./hono_env.ts";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  ServerMessageSchema,
  TwilioMessageSchema,
} from "@aai/core/protocol";
import { mulawToPcm16, pcm16ToMulaw, resample } from "./mulaw.ts";
import { upgradeWebSocket } from "hono/deno";
import type { WSContext } from "hono/ws";

const MULAW_RATE = 8000;
const TWIML_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>`;
const TWIML_SUFFIX = `</Response>`;

export function createTwilioTransport(ws: WSContext): SessionTransport & {
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
        try {
          const parsed = ServerMessageSchema.safeParse(JSON.parse(data));
          if (parsed.success) {
            const msg = parsed.data;
            if (msg.type === "chat") {
              console.info("Agent response", {
                text: msg.text.slice(0, 100),
              });
            } else if (msg.type === "error") {
              console.error("Session error", { message: msg.message });
            }
          }
        } catch { /* ignore */ }
        return;
      }

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

export function decodeTwilioFrame(payload: string): Uint8Array {
  const pcm16 = mulawToPcm16(decodeBase64(payload));
  const resampled = resample(pcm16, MULAW_RATE, DEFAULT_STT_SAMPLE_RATE);
  return new Uint8Array(
    resampled.buffer,
    resampled.byteOffset,
    resampled.byteLength,
  );
}

function getTwilioSlot(
  slug: string,
  slots: Map<string, AgentSlot>,
): AgentSlot | null {
  const slot = slots.get(slug);
  return slot?.transport.includes("twilio") ? slot : null;
}

export function handleTwilioVoice(c: Context<HonoEnv>) {
  const { slug, slots } = c.var;
  const slot = getTwilioSlot(slug, slots);
  if (!slot) {
    return c.body(
      `${TWIML_PREFIX}<Say>Agent not found. Goodbye.</Say>${TWIML_SUFFIX}`,
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  const host = c.req.header("host") ?? "localhost";
  const streamUrl = `wss://${host}/${slug}/twilio/stream`;
  console.info("Incoming call, connecting media stream", { slug, streamUrl });
  return c.body(
    `${TWIML_PREFIX}<Connect><Stream url="${streamUrl}" /></Connect>${TWIML_SUFFIX}`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

export const handleTwilioStream = upgradeWebSocket(async (c) => {
  const { slug, slots, store, kvStore } = c.var;
  const slot = getTwilioSlot(slug, slots);
  if (!slot) throw new HTTPException(404, { message: "Not found" });

  const setup = await prepareSession(slot, slug, store, kvStore);

  type TwilioTransport = SessionTransport & { streamSid: string | null };
  let transport: TwilioTransport;
  let session: ReturnType<typeof createSession>;
  let audioBuf: ReturnType<typeof createAudioBuffer>;

  return {
    onOpen(_evt, ws) {
      transport = createTwilioTransport(ws);
      session = createSession({
        id: `twilio-${crypto.randomUUID().slice(0, 8)}`,
        agent: slug,
        transport,
        ...setup,
      });
      audioBuf = createAudioBuffer((chunk) => session.onAudio(chunk));
      console.info("Twilio media stream connected", { slug });
      void session.start();
    },

    onMessage(event) {
      if (!session || !transport) return;
      if (typeof event.data !== "string") return;
      if ((event.data as string).length > 1_000_000) return;
      let json: unknown;
      try {
        json = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const parsed = TwilioMessageSchema.safeParse(json);
      if (!parsed.success) return;
      const msg = parsed.data;

      switch (msg.event) {
        case "start":
          transport.streamSid = msg.start.streamSid;
          console.info("Twilio stream started", {
            slug,
            streamSid: transport.streamSid,
          });
          session.onAudioReady();
          break;
        case "media":
          audioBuf.push(decodeTwilioFrame(msg.media.payload));
          break;
        case "stop":
          audioBuf.drain();
          console.info("Twilio stream stopped", { slug });
          void session.stop();
          break;
      }
    },

    onClose() {
      console.info("Twilio media stream disconnected", { slug });
      if (session) void session.stop();
    },

    onError(event) {
      console.error("Twilio media stream error", {
        slug,
        error: event instanceof ErrorEvent ? event.message : "WebSocket error",
      });
    },
  };
});
