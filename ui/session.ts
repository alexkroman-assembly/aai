// Copyright 2025 the AAI authors. MIT license.
import { batch, type Signal, signal } from "@preact/signals";
import { PROTOCOL_VERSION } from "@aai/sdk/protocol";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { WebSocket as PartySocket } from "partysocket";

const SUPPORTED_PROTOCOL_VERSION = PROTOCOL_VERSION;
const SUPPORTED_AUDIO_FORMATS = new Set(["pcm16"]);

import {
  type AgentState,
  type Message,
  type SessionError,
  type SessionOptions,
} from "./types.ts";

import type { VoiceIO } from "./audio.ts";

/**
 * Gate interface — the initial capability exposed by the server.
 * The client must call `authenticate()` to obtain a session capability.
 */
interface GateRpcApi {
  authenticate(): SessionRpcApi;
}

/**
 * Session interface — returned by `authenticate()`.
 * Provides the actual session control methods (audio, cancel, reset, etc.).
 */
interface SessionRpcApi {
  audioReady(): void;
  cancel(): void;
  resetSession(): void;
  sendHistory(
    messages: readonly { role: "user" | "assistant"; text: string }[],
  ): void;
  sendAudioStream(stream: ReadableStream<Uint8Array>): void;
}

/**
 * A reactive voice session that manages WebSocket communication,
 * audio capture/playback, and agent state transitions.
 *
 * Uses Cap'n Web RPC for typed bidirectional communication and
 * PartySocket for automatic WebSocket reconnection.
 *
 * Implements {@linkcode Disposable} for resource cleanup via `using`.
 */
export type VoiceSession = {
  /** Current agent state (connecting, listening, thinking, etc.). */
  readonly state: Signal<AgentState>;
  /** Chat message history for the session. */
  readonly messages: Signal<Message[]>;
  /** Live partial transcript from the STT engine. */
  readonly transcript: Signal<string>;
  /** Current session error, or `null` if no error. */
  readonly error: Signal<SessionError | null>;
  /** Disconnection info, or `null` if connected. */
  readonly disconnected: Signal<{ intentional: boolean } | null>;
  /**
   * Open a WebSocket connection to the server and begin audio capture.
   *
   * @param options - Optional connection options.
   * @param options.signal - An AbortSignal that, when aborted, disconnects the session.
   */
  connect(options?: { signal?: AbortSignal }): void;
  /** Cancel the current agent turn and discard in-flight TTS audio. */
  cancel(): void;
  /** Clear messages, transcript, and error state without disconnecting. */
  resetState(): void;
  /** Reset the session: clear state and reconnect. */
  reset(): void;
  /** Close the WebSocket and release all audio resources. */
  disconnect(): void;
  /** Alias for {@linkcode disconnect} for use with `using`. */
  [Symbol.dispose](): void;
};

/**
 * Cap'n Web RPC target for the browser client.
 *
 * Receives server→client RPC calls and updates reactive Preact signals
 * accordingly (state transitions, transcripts, messages, audio playback).
 */
class ClientRpcTarget extends RpcTarget {
  #state: Signal<AgentState>;
  #messages: Signal<Message[]>;
  #transcript: Signal<string>;
  #error: Signal<SessionError | null>;
  #voiceIO: () => VoiceIO | null;
  #onReady: (
    msg: {
      protocol_version: number;
      audio_format: string;
      sample_rate: number;
      tts_sample_rate: number;
      mode?: string;
    },
  ) => Promise<void>;
  constructor(opts: {
    state: Signal<AgentState>;
    messages: Signal<Message[]>;
    transcript: Signal<string>;
    error: Signal<SessionError | null>;
    voiceIO: () => VoiceIO | null;
    onReady: (msg: {
      protocol_version: number;
      audio_format: string;
      sample_rate: number;
      tts_sample_rate: number;
      mode?: string;
    }) => Promise<void>;
  }) {
    super();
    this.#state = opts.state;
    this.#messages = opts.messages;
    this.#transcript = opts.transcript;
    this.#error = opts.error;
    this.#voiceIO = opts.voiceIO;
    this.#onReady = opts.onReady;
  }

  ready(config: {
    protocol_version: number;
    audio_format: string;
    sample_rate: number;
    tts_sample_rate: number;
    mode?: string;
  }): void {
    void this.#onReady(config);
  }

  partialTranscript(text: string): void {
    this.#transcript.value = text;
  }

  finalTranscript(text: string, _turnOrder?: number): void {
    this.#transcript.value = text;
  }

  turn(text: string, _turnOrder?: number): void {
    batch(() => {
      this.#transcript.value = "";
      this.#messages.value = [
        ...this.#messages.value,
        { role: "user", text },
      ];
      this.#state.value = "thinking";
    });
  }

  chat(text: string): void {
    batch(() => {
      this.#messages.value = [
        ...this.#messages.value,
        { role: "assistant", text },
      ];
      this.#state.value = "speaking";
    });
  }

  ttsDone(): void {
    this.#voiceIO()?.done();
    this.#state.value = "listening";
  }

  cancelled(): void {
    this.#voiceIO()?.flush();
    this.#state.value = "listening";
  }

  resetNotify(): void {
    const io = this.#voiceIO();
    io?.flush();
    batch(() => {
      this.#messages.value = [];
      this.#transcript.value = "";
      this.#error.value = null;
    });
  }

  error(message: string): void {
    console.error("Agent error:", message);
    batch(() => {
      this.#error.value = { code: "protocol", message };
      this.#state.value = "error";
    });
  }

  playAudioStream(stream: ReadableStream<Uint8Array>): void {
    const state = this.#state;
    const voiceIO = this.#voiceIO;
    void (async () => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (state.value === "speaking") {
            voiceIO()?.enqueue(value.buffer as ArrayBuffer);
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }
}

/**
 * Create a voice session that connects to an AAI server via WebSocket.
 *
 * Uses Cap'n Web RPC for typed bidirectional communication and
 * PartySocket for automatic reconnection with exponential backoff.
 *
 * @param options - Session configuration including the platform server URL.
 * @returns A {@linkcode VoiceSession} handle for controlling the session.
 */
export function createVoiceSession(options: SessionOptions): VoiceSession {
  const state = signal<AgentState>("connecting");
  const messages = signal<Message[]>([]);
  const transcript = signal<string>("");
  const error = signal<SessionError | null>(null);
  const disconnected = signal<{ intentional: boolean } | null>(null);

  let ws: PartySocket | null = null;
  let voiceIO: VoiceIO | null = null;
  /** Session stub obtained via gate.authenticate() — supports pipelining. */
  let sessionStub: import("capnweb").RpcStub<SessionRpcApi> | null = null;
  let connectionController: AbortController | null = null;
  let hasConnected = false;
  let audioSetupInFlight = false;
  /** Controller for the mic audio ReadableStream sent to the server. */
  let micStreamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;

  function cleanupAudio(): void {
    audioSetupInFlight = false;
    try {
      micStreamController?.close();
    } catch { /* already closed */ }
    micStreamController = null;
    void voiceIO?.close();
    voiceIO = null;
  }

  function resetState(): void {
    batch(() => {
      messages.value = [];
      transcript.value = "";
      error.value = null;
    });
  }


  async function handleReady(msg: {
    protocol_version: number;
    audio_format: string;
    sample_rate: number;
    tts_sample_rate: number;
    mode?: string;
  }): Promise<void> {
    if (audioSetupInFlight) return;

    // Protocol version check
    const serverVersion = msg.protocol_version;
    if (
      serverVersion !== undefined &&
      serverVersion !== SUPPORTED_PROTOCOL_VERSION
    ) {
      batch(() => {
        error.value = {
          code: "protocol",
          message:
            `Server protocol v${serverVersion} is not compatible with client v${SUPPORTED_PROTOCOL_VERSION}. Please redeploy your agent.`,
        };
        state.value = "error";
      });
      return;
    }

    // Audio format check
    const audioFormat = msg.audio_format ?? "pcm16";
    if (!SUPPORTED_AUDIO_FORMATS.has(audioFormat)) {
      batch(() => {
        error.value = {
          code: "protocol",
          message:
            `Unsupported audio format "${audioFormat}". Please redeploy your agent.`,
        };
        state.value = "error";
      });
      return;
    }

    audioSetupInFlight = true;
    try {
      const [
        { createVoiceIO },
        captureWorklet,
        playbackWorklet,
      ] = await Promise.all([
        import("./audio.ts"),
        import("./worklets/capture-processor.js").then((m) =>
          m.default as unknown as string
        ),
        import("./worklets/playback-processor.js").then((m) =>
          m.default as unknown as string
        ),
      ]);
      const io = await createVoiceIO({
        sttSampleRate: msg.sample_rate,
        ttsSampleRate: msg.tts_sample_rate,
        captureWorkletSrc: captureWorklet,
        playbackWorkletSrc: playbackWorklet,
        onMicData: (pcm16: ArrayBuffer) => {
          try {
            micStreamController?.enqueue(new Uint8Array(pcm16));
          } catch { /* stream may be closed */ }
        },
      });
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        io.close();
        return;
      }
      voiceIO = io;
      // Create mic audio stream and send it to the server
      if (sessionStub) {
        const micStream = new ReadableStream<Uint8Array>({
          start(c) {
            micStreamController = c;
          },
        });
        void (sessionStub.sendAudioStream(micStream) as
          Promise<void>).catch(() => {});
        void (sessionStub.audioReady() as Promise<void>).catch(() => {});
      }
      state.value = "listening";
    } catch (err: unknown) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      batch(() => {
        error.value = {
          code: "audio",
          message: `Microphone access failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
        state.value = "error";
      });
    } finally {
      audioSetupInFlight = false;
    }
  }

  function connect(opts?: { signal?: AbortSignal }): void {
    disconnected.value = null;
    connectionController?.abort();
    const controller = new AbortController();
    connectionController = controller;
    const { signal: sig } = controller;

    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => disconnect(), {
        signal: sig,
      });
    }

    const base = options.platformUrl;
    const wsUrl = new URL("websocket", base.endsWith("/") ? base : base + "/");
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    if (hasConnected) wsUrl.searchParams.set("resume", "1");

    // Use PartySocket for automatic reconnection
    const socket = new PartySocket(wsUrl.toString());
    ws = socket;

    socket.addEventListener("open", () => {
      // Create the client RPC target
      const clientTarget = new ClientRpcTarget({
        state,
        messages,
        transcript,
        error,
        voiceIO: () => voiceIO,
        onReady: async (msg) => {
          hasConnected = true;
          await handleReady(msg);
        },
      });

      // Initialize capnweb RPC session — server exposes a gate
      const gate = newWebSocketRpcSession<GateRpcApi>(
        socket as unknown as WebSocket,
        clientTarget,
      );

      // Authenticate to get the session capability.
      // This is pipelined — subsequent calls on sessionStub
      // are batched with the authenticate call in one round trip.
      sessionStub = gate.authenticate() as unknown as
        import("capnweb").RpcStub<SessionRpcApi>;

      // Send history if reconnecting (pipelined with authenticate)
      if (hasConnected && messages.value.length > 0) {
        void (sessionStub.sendHistory(
          messages.value.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        ) as Promise<void>).catch(() => {});
      }

      state.value = "ready";
    }, { signal: sig });

    socket.addEventListener("close", () => {
      if (sig.aborted) {
        state.value = "connecting";
        return;
      }
      controller.abort();
      disconnected.value = { intentional: false };
      cleanupAudio();
      sessionStub = null;
      // PartySocket handles reconnection automatically
      state.value = "connecting";
    }, { signal: sig });
  }

  function cancel(): void {
    voiceIO?.flush();
    state.value = "listening";
    if (sessionStub) {
      void (sessionStub.cancel() as Promise<void>).catch(() => {});
    }
  }

  function reset(): void {
    voiceIO?.flush();
    if (sessionStub) {
      void (sessionStub.resetSession() as Promise<void>).catch(() => {});
      return;
    }
    resetState();
    disconnect();
    connect();
  }

  function disconnect(): void {
    connectionController?.abort();
    connectionController = null;
    cleanupAudio();
    sessionStub = null;
    ws?.close();
    ws = null;
    state.value = "connecting";
    disconnected.value = { intentional: true };
  }

  return {
    state,
    messages,
    transcript,
    error,
    disconnected,
    connect,
    cancel,
    resetState,
    reset,
    disconnect,
    [Symbol.dispose]() {
      disconnect();
    },
  };
}
