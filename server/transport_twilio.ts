import { concat } from "@std/bytes/concat";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
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
} from "../sdk/_protocol.ts";
import { mulawToPcm16, pcm16ToMulaw, resample } from "./mulaw.ts";
import { z } from "zod";

const log = getLogger("twilio");

const TwilioMessageSchema = z.object({
  event: z.string(),
  start: z.object({ streamSid: z.string() }).optional(),
  media: z.object({ payload: z.string() }).optional(),
});

const MULAW_RATE = 8000;

// TwiML helper

export function twiml(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

// Twilio ↔ SessionTransport adapter

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

// Audio buffer

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

// Route handlers

export interface TwilioContext {
  slots: Map<string, AgentSlot>;
  store: BundleStore;
}

function getTwilioSlot(
  slug: string,
  ctx: TwilioContext,
): AgentSlot | null {
  const slot = ctx.slots.get(slug);
  return slot?.transport.includes("twilio") ? slot : null;
}

export async function handleTwilioVoice(
  req: Request,
  slug: string,
  ctx: TwilioContext,
): Promise<Response> {
  const slot = getTwilioSlot(slug, ctx);
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

  const host = req.headers.get("host") ?? "localhost";
  const streamUrl = `wss://${host}/${slug}/twilio/stream`;
  log.info("Incoming call, connecting media stream", { slug, streamUrl });
  return twiml(`<Connect><Stream url="${streamUrl}" /></Connect>`);
}

export async function handleTwilioStream(
  req: Request,
  slug: string,
  ctx: TwilioContext,
): Promise<Response> {
  const slot = getTwilioSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json(
      { error: "Expected WebSocket upgrade" },
      { status: 400 },
    );
  }

  let info;
  try {
    info = await ensureAgent(slot, (s) => ctx.store.getFile(s, "worker"));
  } catch (err: unknown) {
    log.error("Failed to initialize agent for media stream", { slug, err });
    return Response.json(
      { error: "Agent failed to initialize" },
      { status: 500 },
    );
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const transport = createTwilioTransport(socket);

  const session = createSession({
    id: `twilio-${crypto.randomUUID().slice(0, 8)}`,
    transport,
    agentConfig: info.config,
    toolSchemas: info.toolSchemas,
    platformConfig: loadPlatformConfig(slot.env),
    executeTool: createRpcToolExecutor(info.workerApi),
    workerApi: info.workerApi,
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
    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      return;
    }
    const parsed = TwilioMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const msg = parsed.data;

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
}
