// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import type { ClientEvent, ClientSink, Session } from "./session.ts";

/** Protocol-level session config returned to the client on connect. */
export type ReadyConfig = {
  protocol_version: number;
  audio_format: string;
  sample_rate: number;
  tts_sample_rate: number;
  mode?: string;
};

/** Options for wiring a WebSocket to a session. */
export type WsSessionOptions = {
  /** Map of active sessions (session is added on open, removed on close). */
  sessions: Map<string, Session>;
  /** Factory function to create a session for a given ID and client sink. */
  createSession: (sessionId: string, client: ClientSink) => Session;
  /** Protocol config the client can pull via getConfig() — avoids server push. */
  readyConfig: ReadyConfig;
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
 * Uses a single discriminated-union `event()` method instead of one
 * method per event type. Audio is streamed via `playAudioStream()`.
 */
export interface ClientRpcApi {
  event(e: ClientEvent): void;
  playAudioStream(stream: ReadableStream<Uint8Array>): void;
}

/**
 * Cap'n Web RPC target for the session API surface.
 *
 * Returned by {@linkcode SessionGate.authenticate} — the client can
 * only interact with the session after a successful authenticate call.
 */
class SessionTarget extends RpcTarget {
  #session: Session;
  #readyConfig: ReadyConfig;

  constructor(session: Session, readyConfig: ReadyConfig) {
    super();
    this.#session = session;
    this.#readyConfig = readyConfig;
  }

  /** Returns protocol config — client pipelines this with authenticate(). */
  getConfig(): ReadyConfig {
    return this.#readyConfig;
  }

  audioReady(): void {
    this.#session.onAudioReady();
  }

  cancel(): void {
    this.#session.onCancel();
  }

  resetSession(): void {
    this.#session.onReset();
  }

  sendHistory(
    messages: readonly { role: "user" | "assistant"; text: string }[],
  ): void {
    this.#session.onHistory(messages);
  }

  sendAudioStream(stream: ReadableStream<Uint8Array>): void {
    void (async () => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.#session.onAudio(value);
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }
}

/**
 * Cap'n Web RPC gate target — the initial capability exposed to clients.
 *
 * Clients must call {@linkcode authenticate} to obtain a
 * {@linkcode SessionTarget} capability. Until then, no session
 * interaction is possible (capability-based security).
 */
class SessionGate extends RpcTarget {
  #sessionId: string;
  #ws: WebSocket;
  #clientStub: import("capnweb").RpcStub<ClientRpcApi> | null = null;
  #createSession: (sessionId: string, client: ClientSink) => Session;
  #sessions: Map<string, Session>;
  #onSession: (session: Session) => void;
  #readyConfig: ReadyConfig;
  #authenticated = false;

  constructor(opts: {
    sessionId: string;
    ws: WebSocket;
    createSession: (sessionId: string, client: ClientSink) => Session;
    sessions: Map<string, Session>;
    onSession: (session: Session) => void;
    readyConfig: ReadyConfig;
  }) {
    super();
    this.#sessionId = opts.sessionId;
    this.#ws = opts.ws;
    this.#createSession = opts.createSession;
    this.#sessions = opts.sessions;
    this.#onSession = opts.onSession;
    this.#readyConfig = opts.readyConfig;
  }

  /** Set the client stub after the RPC session is established. */
  setClientStub(stub: import("capnweb").RpcStub<ClientRpcApi>): void {
    this.#clientStub = stub;
  }

  /**
   * Authenticate and obtain the session capability.
   *
   * Returns a {@linkcode SessionTarget} that the client can use to
   * send audio, cancel turns, reset, etc. The client can pipeline
   * calls on the returned target without awaiting.
   */
  authenticate(): SessionTarget {
    if (this.#authenticated) {
      throw new Error("Already authenticated");
    }
    if (!this.#clientStub) {
      throw new Error("RPC session not ready");
    }
    this.#authenticated = true;

    const client = createClientSink(this.#clientStub, this.#ws);
    const session = this.#createSession(this.#sessionId, client);
    this.#sessions.set(this.#sessionId, session);
    this.#onSession(session);

    void session.start();
    return new SessionTarget(session, this.#readyConfig);
  }
}

/**
 * Wraps a capnweb client stub as a {@linkcode ClientSink}.
 *
 * Adds the `open` check and fire-and-forget error handling so the
 * session layer doesn't need to worry about RPC promise management.
 */
function createClientSink(
  stub: import("capnweb").RpcStub<ClientRpcApi>,
  ws: WebSocket,
): ClientSink {
  function fire(fn: () => unknown): void {
    void (fn() as Promise<void>).catch(() => {});
  }

  return {
    get open() {
      return ws.readyState === WebSocket.OPEN;
    },
    event(e) {
      fire(() => stub.event(e));
    },
    playAudioStream(stream) {
      fire(() => stub.playAudioStream(stream));
    },
  };
}

/**
 * Attaches session lifecycle handlers to a native WebSocket using
 * Cap'n Web RPC for bidirectional communication.
 *
 * Exposes a {@linkcode SessionGate} as the initial capability — the
 * client must call `authenticate()` to obtain a {@linkcode SessionTarget}
 * for session interaction. This uses capnweb's capability-based security
 * to ensure no session access without explicit authentication.
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

    const gate = new SessionGate({
      sessionId,
      ws,
      createSession: opts.createSession,
      sessions,
      readyConfig: opts.readyConfig,
      onSession: (s) => {
        session = s;
      },
    });

    // Single RPC session: expose gate to client, get client stub back.
    // The client calls gate.authenticate() to get the SessionTarget.
    const clientStub = newWebSocketRpcSession<ClientRpcApi>(ws, gate);
    gate.setClientStub(clientStub);

    log.info("Session gate ready", { ...ctx, sid });
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
