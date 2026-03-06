import { getLogger } from "./logger.ts";
import { ClientMessageSchema } from "../sdk/_protocol.ts";
import type { Session } from "./session.ts";

function safeParseJSON(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

const log = getLogger("ws");

export interface WsSessionOptions {
  createSession: (sessionId: string, ws: WebSocket) => Session;
  logContext?: Record<string, string>;
  onOpen?: () => void;
  onClose?: () => void;
}

export function handleSessionWebSocket(
  ws: WebSocket,
  sessions: Map<string, Session>,
  opts: WsSessionOptions,
): void {
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);
  const ctx = opts.logContext ?? {};

  let session: Session | null = null;
  let ready = false;
  const pendingMessages: string[] = [];
  let processingChain: Promise<void> = Promise.resolve();

  function processControlMessage(raw: string): void {
    const json = safeParseJSON(raw);
    if (json === null) return;
    const parsed = ClientMessageSchema.safeParse(json);
    if (!parsed.success) return;

    if (parsed.data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    } else if (parsed.data.type === "audio_ready") {
      session?.onAudioReady();
    } else if (parsed.data.type === "cancel") {
      session?.onCancel();
    } else if (parsed.data.type === "reset") {
      session?.onReset();
    } else if (parsed.data.type === "history") {
      session?.onHistory(parsed.data.messages);
    }
  }

  function enqueueControl(raw: string): void {
    processingChain = processingChain
      .then(() => processControlMessage(raw))
      .catch((err) => {
        log.error("Control message processing error", {
          ...ctx,
          sid,
          error: err,
        });
      });
  }

  ws.addEventListener("open", () => {
    opts.onOpen?.();
    log.info("Session connected", { ...ctx, sid });

    session = opts.createSession(sessionId, ws);
    sessions.set(sessionId, session);

    log.info("Session configured", { ...ctx, sid });
    void session.start();

    for (const msg of pendingMessages) {
      enqueueControl(msg);
    }
    pendingMessages.length = 0;
    processingChain = processingChain.then(() => {
      ready = true;
    });
  });

  ws.addEventListener("message", (event) => {
    const isBinary = event.data instanceof ArrayBuffer;

    if (!ready) {
      if (!isBinary) {
        const json = safeParseJSON(event.data as string);
        if (
          json !== null && typeof json === "object" &&
          (json as Record<string, unknown>).type === "ping"
        ) {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        pendingMessages.push(event.data as string);
      }
      return;
    }

    if (isBinary) {
      session?.onAudio(new Uint8Array(event.data));
      return;
    }

    enqueueControl(event.data as string);
  });

  ws.addEventListener("close", async () => {
    log.info("Session disconnected", { ...ctx, sid });
    if (session) {
      await session.stop();
      sessions.delete(sessionId);
    }
    opts.onClose?.();
  });

  ws.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    log.error("WebSocket error", { ...ctx, sid, error: msg });
  });
}
