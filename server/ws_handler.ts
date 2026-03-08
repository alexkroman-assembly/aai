import { ClientMessageSchema } from "@aai/core/protocol";
import type { Session } from "./session.ts";

export type WsSessionOptions = {
  createSession: (sessionId: string, ws: WebSocket) => Session;
  logContext?: Record<string, string>;
  onOpen?: () => void;
  onClose?: () => void;
};

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
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
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
        console.error("Control message processing error", {
          ...ctx,
          sid,
          error: err,
        });
      });
  }

  ws.addEventListener("open", () => {
    opts.onOpen?.();
    console.info("Session connected", { ...ctx, sid });

    session = opts.createSession(sessionId, ws);
    sessions.set(sessionId, session);

    console.info("Session configured", { ...ctx, sid });
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
        let json: unknown;
        try {
          json = JSON.parse(event.data as string);
        } catch { /* not JSON */ }
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
    console.info("Session disconnected", { ...ctx, sid });
    if (session) {
      await session.stop();
      sessions.delete(sessionId);
    }
    opts.onClose?.();
  });

  ws.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    console.error("WebSocket error", { ...ctx, sid, error: msg });
  });
}
