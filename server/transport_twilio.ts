import { concat } from "@std/bytes/concat";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import {
  type AgentSlot,
  createToolExecutor,
  trackSessionClose,
  trackSessionOpen,
} from "./worker_pool.ts";
import { loadPlatformConfig } from "./config.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import { createSession, type SessionTransport } from "./session.ts";
import type { ServerContext } from "./types.ts";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
} from "../core/_protocol.ts";
import { mulawToPcm16, pcm16ToMulaw, resample } from "./mulaw.ts";
import { z } from "zod";

const TwilioMessageSchema = z.object({
  event: z.string(),
  start: z.object({ streamSid: z.string() }).optional(),
  media: z.object({ payload: z.string() }).optional(),
});

const MULAW_RATE = 8000;
const TWIML_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>`;
const TWIML_SUFFIX = `</Response>`;

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
            console.info("Agent response", {
              text: (msg.text as string)?.slice(0, 100),
            });
          } else if (msg.type === "error") {
            console.error("Session error", { message: msg.message });
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
  ctx: ServerContext,
): AgentSlot | null {
  const slot = ctx.slots.get(slug);
  return slot?.transport.includes("twilio") ? slot : null;
}

export function handleTwilioVoice(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Response {
  const slot = getTwilioSlot(slug, ctx);
  if (!slot) {
    return new Response(
      `${TWIML_PREFIX}<Say>Agent not found. Goodbye.</Say>${TWIML_SUFFIX}`,
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  const host = req.headers.get("host") ?? "localhost";
  const streamUrl = `wss://${host}/${slug}/twilio/stream`;
  console.info("Incoming call, connecting media stream", { slug, streamUrl });
  return new Response(
    `${TWIML_PREFIX}<Connect><Stream url="${streamUrl}" /></Connect>${TWIML_SUFFIX}`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

export function handleTwilioStream(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Response {
  const slot = getTwilioSlot(slug, ctx);
  if (!slot) return Response.json({ error: "Not found" }, { status: 404 });

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "Expected WebSocket upgrade" }, {
      status: 400,
    });
  }

  const config = slot.config!;
  const builtinTools = getBuiltinToolSchemas(config.builtinTools ?? []);
  const toolSchemas = [...(slot.toolSchemas ?? []), ...builtinTools];
  const { executeTool, getWorkerApi } = createToolExecutor(slot, ctx.store);

  const { socket, response } = Deno.upgradeWebSocket(req);
  const transport = createTwilioTransport(socket);

  const session = createSession({
    id: `twilio-${crypto.randomUUID().slice(0, 8)}`,
    transport,
    agentConfig: config,
    toolSchemas,
    platformConfig: loadPlatformConfig(slot.env),
    executeTool,
    getWorkerApi,
    env: slot.env,
  });

  trackSessionOpen(slot);

  const audioBuf = createAudioBuffer((chunk) => session.onAudio(chunk));

  socket.addEventListener("open", () => {
    console.info("Twilio media stream connected", { slug });
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
        console.info("Twilio stream started", {
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
        console.info("Twilio stream stopped", { slug });
        void session.stop();
        break;
    }
  });

  socket.addEventListener("close", () => {
    console.info("Twilio media stream disconnected", { slug });
    void session.stop();
    trackSessionClose(slot);
  });

  socket.addEventListener("error", (event) => {
    console.error("Twilio media stream error", {
      slug,
      error: event instanceof ErrorEvent ? event.message : "WebSocket error",
    });
  });

  return response;
}
