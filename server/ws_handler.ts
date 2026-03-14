// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import type { Session, SessionTransport } from "./session.ts";

/** Options for wiring a WebSocket to a session. */
export type WsSessionOptions = {
  /** Map of active sessions (session is added on open, removed on close). */
  sessions: Map<string, Session>;
  /** Factory function to create a session for a given ID and transport. */
  createSession: (sessionId: string, transport: SessionTransport) => Session;
  /** Additional key-value pairs included in log messages. */
  logContext?: Record<string, string>;
  /** Callback invoked when the WebSocket connection opens. */
  onOpen?: () => void;
  /** Callback invoked when the WebSocket connection closes. */
  onClose?: () => void;
};

/**
 * Interface for server→client RPC calls.
 *
 * The server calls these methods on the client stub to push messages
 * and audio to the browser.
 */
export interface ClientRpcApi {
  ready(config: {
    protocol_version: number;
    audio_format: string;
    sample_rate: number;
    tts_sample_rate: number;
    mode?: string;
  }): void;
  partialTranscript(text: string): void;
  finalTranscript(text: string, turnOrder?: number): void;
  turn(text: string, turnOrder?: number): void;
  chat(text: string): void;
  ttsDone(): void;
  cancelled(): void;
  resetNotify(): void;
  error(message: string, details?: readonly string[]): void;
  pong(): void;
  playAudio(data: Uint8Array): void;
}

/**
 * Cap'n Web RPC target for the server-side session.
 *
 * Handles client→server requests: audio data, control messages (cancel,
 * reset, history), and keepalive pings.
 */
class SessionServerTarget extends RpcTarget {
  #session: Session | null = null;
  #pendingMessages: Array<{ method: string; args: unknown[] }> = [];
  #ready = false;
  #clientStub: import("capnweb").RpcStub<ClientRpcApi> | null = null;

  setSession(session: Session): void {
    this.#session = session;
  }

  setReady(): void {
    this.#ready = true;
    // Process any messages queued before the session was ready
    for (const { method, args } of this.#pendingMessages) {
      this.#dispatch(method, args);
    }
    this.#pendingMessages.length = 0;
  }

  setClientStub(
    stub: import("capnweb").RpcStub<ClientRpcApi>,
  ): void {
    this.#clientStub = stub;
  }

  audioReady(): void {
    this.#enqueue("audioReady", []);
  }

  cancel(): void {
    this.#enqueue("cancel", []);
  }

  resetSession(): void {
    this.#enqueue("reset", []);
  }

  sendHistory(
    messages: readonly { role: "user" | "assistant"; text: string }[],
  ): void {
    this.#enqueue("history", [messages]);
  }

  sendAudio(data: Uint8Array): void {
    if (this.#ready && this.#session) {
      this.#session.onAudio(data);
    }
  }

  ping(): void {
    // Respond with pong via the client stub
    if (this.#clientStub) {
      void Promise.resolve(this.#clientStub.pong()).catch(() => {});
    }
  }

  #enqueue(method: string, args: unknown[]): void {
    if (!this.#ready) {
      if (method === "ping" && this.#clientStub) {
        void Promise.resolve(this.#clientStub.pong()).catch(() => {});
        return;
      }
      this.#pendingMessages.push({ method, args });
      return;
    }
    this.#dispatch(method, args);
  }

  #dispatch(method: string, args: unknown[]): void {
    if (!this.#session) return;
    switch (method) {
      case "audioReady":
        this.#session.onAudioReady();
        break;
      case "cancel":
        this.#session.onCancel();
        break;
      case "reset":
        this.#session.onReset();
        break;
      case "history":
        this.#session.onHistory(
          args[0] as readonly { role: "user" | "assistant"; text: string }[],
        );
        break;
    }
  }
}

/**
 * Creates a {@linkcode SessionTransport} adapter that routes messages
 * through a capnweb client stub.
 *
 * JSON messages are parsed and dispatched to typed client RPC methods.
 * Binary audio data is sent via `playAudio()`.
 */
function createCapnwebTransport(
  clientStub: import("capnweb").RpcStub<ClientRpcApi>,
  ws: WebSocket,
): SessionTransport {
  return {
    get readyState() {
      return ws.readyState as 0 | 1 | 2 | 3;
    },
    send(data: string | ArrayBuffer | Uint8Array) {
      if (ws.readyState !== WebSocket.OPEN) return;

      if (typeof data === "string") {
        // Parse the JSON server message and dispatch to typed client methods
        try {
          const msg = JSON.parse(data) as Record<string, unknown>;
          const type = msg.type as string;

          switch (type) {
            case "ready":
              void Promise.resolve(
                clientStub.ready(
                  msg as unknown as Parameters<ClientRpcApi["ready"]>[0],
                ),
              ).catch(() => {});
              break;
            case "partial_transcript":
              void Promise.resolve(
                clientStub.partialTranscript(msg.text as string),
              ).catch(() => {});
              break;
            case "final_transcript":
              void Promise.resolve(
                clientStub.finalTranscript(
                  msg.text as string,
                  msg.turn_order as number | undefined,
                ),
              ).catch(() => {});
              break;
            case "turn":
              void Promise.resolve(
                clientStub.turn(
                  msg.text as string,
                  msg.turn_order as number | undefined,
                ),
              ).catch(() => {});
              break;
            case "chat":
              void Promise.resolve(clientStub.chat(msg.text as string))
                .catch(() => {});
              break;
            case "tts_done":
              void Promise.resolve(clientStub.ttsDone()).catch(() => {});
              break;
            case "cancelled":
              void Promise.resolve(clientStub.cancelled()).catch(() => {});
              break;
            case "reset":
              void Promise.resolve(clientStub.resetNotify()).catch(() => {});
              break;
            case "error":
              void Promise.resolve(
                clientStub.error(
                  msg.message as string,
                  msg.details as readonly string[] | undefined,
                ),
              ).catch(() => {});
              break;
            case "pong":
              void Promise.resolve(clientStub.pong()).catch(() => {});
              break;
          }
        } catch { /* ignore parse failures */ }
        return;
      }

      // Binary audio data
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      void Promise.resolve(clientStub.playAudio(bytes)).catch(() => {});
    },
  };
}

/**
 * Attaches session lifecycle handlers to a native WebSocket using
 * Cap'n Web RPC for bidirectional communication.
 *
 * Creates a capnweb session over the WebSocket, exposing a
 * {@linkcode SessionServerTarget} for client→server calls and
 * obtaining a client stub for server→client messages.
 */
export function wireSessionSocket(
  ws: WebSocket,
  opts: WsSessionOptions,
): void {
  const { sessions } = opts;
  const sessionId = crypto.randomUUID();
  const sid = sessionId.slice(0, 8);
  const ctx = opts.logContext ?? {};

  let session: Session | null = null;

  ws.addEventListener("open", () => {
    opts.onOpen?.();
    log.info("Session connected", { ...ctx, sid });

    // Create the server-side RPC target
    const serverTarget = new SessionServerTarget();

    // Initialize capnweb RPC session over this WebSocket
    const clientStub = newWebSocketRpcSession<ClientRpcApi>(
      ws,
      serverTarget,
    );

    serverTarget.setClientStub(clientStub);

    // Create a transport adapter that routes through capnweb
    const transport = createCapnwebTransport(clientStub, ws);

    // Create and start the session
    session = opts.createSession(sessionId, transport);
    serverTarget.setSession(session);
    sessions.set(sessionId, session);

    log.info("Session configured", { ...ctx, sid });
    void session.start();

    // Mark the server target as ready to process queued messages
    serverTarget.setReady();
  });

  ws.addEventListener("close", () => {
    log.info("Session disconnected", { ...ctx, sid });
    if (session) {
      void session.stop().then(() => {
        sessions.delete(sessionId);
      });
    }
    opts.onClose?.();
  });

  ws.addEventListener("error", (event) => {
    const msg = event instanceof ErrorEvent ? event.message : "WebSocket error";
    log.error("WebSocket error", { ...ctx, sid, error: msg });
  });
}
