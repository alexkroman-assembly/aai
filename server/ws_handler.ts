// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import type { ClientSink, Session } from "./session.ts";

/** Options for wiring a WebSocket to a session. */
export type WsSessionOptions = {
  /** Map of active sessions (session is added on open, removed on close). */
  sessions: Map<string, Session>;
  /** Factory function to create a session for a given ID and client sink. */
  createSession: (sessionId: string, client: ClientSink) => Session;
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
 * and audio to the browser. This matches the {@linkcode ClientSink}
 * interface used by the session layer.
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
  error(message: string): void;
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

  setSession(session: Session): void {
    this.#session = session;
  }

  setReady(): void {
    this.#ready = true;
    for (const { method, args } of this.#pendingMessages) {
      this.#dispatch(method, args);
    }
    this.#pendingMessages.length = 0;
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

  #enqueue(method: string, args: unknown[]): void {
    if (!this.#ready) {
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
 * Wraps a capnweb client stub as a {@linkcode ClientSink}.
 *
 * The stub methods already match the ClientSink interface — this just
 * adds the `open` check and fire-and-forget error handling.
 */
function createClientSink(
  stub: import("capnweb").RpcStub<ClientRpcApi>,
  ws: WebSocket,
): ClientSink {
  function fire(fn: () => unknown): void {
    void Promise.resolve(fn()).catch(() => {});
  }

  return {
    get open() {
      return ws.readyState === WebSocket.OPEN;
    },
    ready(config) {
      fire(() => stub.ready(config));
    },
    partialTranscript(text) {
      fire(() => stub.partialTranscript(text));
    },
    finalTranscript(text, turnOrder) {
      fire(() => stub.finalTranscript(text, turnOrder));
    },
    turn(text, turnOrder) {
      fire(() => stub.turn(text, turnOrder));
    },
    chat(text) {
      fire(() => stub.chat(text));
    },
    ttsDone() {
      fire(() => stub.ttsDone());
    },
    cancelled() {
      fire(() => stub.cancelled());
    },
    resetNotify() {
      fire(() => stub.resetNotify());
    },
    error(message) {
      fire(() => stub.error(message));
    },
    playAudio(data) {
      fire(() => stub.playAudio(data));
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

    const serverTarget = new SessionServerTarget();

    const clientStub = newWebSocketRpcSession<ClientRpcApi>(
      ws,
      serverTarget,
    );

    const client = createClientSink(clientStub, ws);

    session = opts.createSession(sessionId, client);
    serverTarget.setSession(session);
    sessions.set(sessionId, session);

    log.info("Session configured", { ...ctx, sid });
    void session.start();

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
