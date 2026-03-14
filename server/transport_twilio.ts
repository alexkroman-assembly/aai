// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { escape } from "@std/html";
import { STATUS_CODE } from "@std/http/status";
import { HttpError, type RouteContext } from "./context.ts";
import { concat } from "@std/bytes/concat";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { type AgentSlot, prepareSession } from "./worker_pool.ts";
import { type ClientSink, createSession } from "./session.ts";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
} from "@aai/sdk/protocol";
import { mulawToPcm16, pcm16ToMulaw, resample } from "./mulaw.ts";

const MULAW_RATE = 8000;
const TWIML_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>`;
const TWIML_SUFFIX = `</Response>`;

/** Minimal WebSocket-like interface for the Twilio transport adapter. */
export type WsSink = {
  send(data: string): void;
  readonly readyState: number;
};

/**
 * Creates a {@linkcode ClientSink} that bridges between the session layer
 * and Twilio's mu-law encoded media stream protocol.
 *
 * Text events (chat, error) are logged. Audio is converted from PCM16
 * to mu-law and sent as Twilio media frames.
 */
export function createTwilioClientSink(ws: WsSink): ClientSink & {
  streamSid: string | null;
} {
  let streamSid: string | null = null;

  return {
    get open() {
      return ws.readyState === WebSocket.OPEN;
    },
    get streamSid() {
      return streamSid;
    },
    set streamSid(sid: string | null) {
      streamSid = sid;
    },

    // Text events — log only, Twilio doesn't display text
    partialTranscript() {},
    finalTranscript() {},
    turn() {},
    ttsDone() {},
    cancelled() {},
    resetNotify() {},
    chat(text) {
      log.info("Agent response", { text: text.slice(0, 100) });
    },
    error(message) {
      log.error("Session error", { message });
    },

    // Audio — consume ReadableStream, convert PCM16 to mu-law Twilio frames
    playAudioStream(stream) {
      void (async () => {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (ws.readyState !== WebSocket.OPEN) break;
            if (!streamSid || value.length < 2) continue;

            const pcm16 = new Int16Array(
              value.buffer,
              value.byteOffset,
              value.byteLength >> 1,
            );
            const mulaw = pcm16ToMulaw(
              resample(pcm16, {
                fromRate: DEFAULT_TTS_SAMPLE_RATE,
                toRate: MULAW_RATE,
              }),
            );
            ws.send(JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: encodeBase64(mulaw) },
            }));
          }
        } finally {
          reader.releaseLock();
        }
      })();
    },
  };
}

const MIN_AUDIO_BYTES = 3200;

/**
 * Creates a buffer that accumulates small audio chunks and flushes them
 * in larger batches to reduce per-frame overhead.
 */
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

/**
 * Decodes a base64-encoded Twilio media frame (mu-law at 8kHz) into
 * PCM16 audio at the STT sample rate.
 */
export function decodeTwilioFrame(payload: string): Uint8Array {
  const pcm16 = mulawToPcm16(decodeBase64(payload));
  const resampled = resample(pcm16, {
    fromRate: MULAW_RATE,
    toRate: DEFAULT_STT_SAMPLE_RATE,
  });
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

/**
 * Handler for Twilio voice webhook (`POST /:slug/twilio/voice`).
 *
 * Returns TwiML that connects the call to a media stream WebSocket.
 */
export function handleTwilioVoice(
  ctx: RouteContext,
  slug: string,
): Response {
  const slot = getTwilioSlot(slug, ctx.state.slots);
  if (!slot) {
    return new Response(
      `${TWIML_PREFIX}<Say>Agent not found. Goodbye.</Say>${TWIML_SUFFIX}`,
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  const host = ctx.req.headers.get("host") ?? "localhost";
  const streamUrl = escape(`wss://${host}/${slug}/twilio/stream`);
  log.info("Incoming call, connecting media stream", { slug, streamUrl });
  return new Response(
    `${TWIML_PREFIX}<Connect><Stream url="${streamUrl}" /></Connect>${TWIML_SUFFIX}`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

import { TwilioMessageSchema } from "@aai/sdk/protocol";

/**
 * Handler that upgrades to a WebSocket for Twilio media streams.
 *
 * Creates a session with a Twilio client sink, handles mu-law audio
 * conversion, and manages the Twilio stream lifecycle events (start, media, stop).
 */
export async function handleTwilioStream(
  ctx: RouteContext,
  slug: string,
): Promise<Response> {
  const slot = getTwilioSlot(slug, ctx.state.slots);
  if (!slot) throw new HttpError(STATUS_CODE.NotFound, "Not found");

  const setup = await prepareSession(slot, {
    slug,
    store: ctx.state.store,
    kvStore: ctx.state.kvStore,
  });

  const { socket, response } = Deno.upgradeWebSocket(ctx.req);

  type TwilioSink = ClientSink & { streamSid: string | null };
  let client: TwilioSink;
  let session: ReturnType<typeof createSession>;
  let audioBuf: ReturnType<typeof createAudioBuffer>;

  socket.addEventListener("open", () => {
    client = createTwilioClientSink(socket);
    session = createSession({
      id: `twilio-${crypto.randomUUID().slice(0, 8)}`,
      agent: slug,
      client,
      ...setup,
    });
    audioBuf = createAudioBuffer((chunk) => session.onAudio(chunk));
    log.info("Twilio media stream connected", { slug });
    void session.start();
  });

  socket.addEventListener("message", (event: Event) => {
    if (!session || !client) return;
    const msgEvent = event as MessageEvent;
    if (typeof msgEvent.data !== "string") return;
    if ((msgEvent.data as string).length > 1_000_000) return;
    let json: unknown;
    try {
      json = JSON.parse(msgEvent.data as string);
    } catch {
      return;
    }
    const parsed = TwilioMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const msg = parsed.data;

    switch (msg.event) {
      case "start":
        client.streamSid = msg.start.streamSid;
        log.info("Twilio stream started", {
          slug,
          streamSid: client.streamSid,
        });
        session.onAudioReady();
        break;
      case "media":
        audioBuf.push(decodeTwilioFrame(msg.media.payload));
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
    if (session) void session.stop();
  });

  socket.addEventListener("error", (event) => {
    log.error("Twilio media stream error", {
      slug,
      error: event instanceof ErrorEvent ? event.message : "WebSocket error",
    });
  });

  return response;
}
