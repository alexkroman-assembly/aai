import { batch, type Signal, signal } from "@preact/signals";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  type ErrorMessage,
  type ServerMessage,
} from "@aai/sdk/protocol";

import {
  type AgentState,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RECONNECT_ATTEMPTS,
  type Message,
  PING_INTERVAL_MS,
  type SessionError,
  type SessionOptions,
} from "./types.ts";

import type { VoiceIO } from "./audio.ts";

export interface Reconnect {
  readonly canRetry: boolean;
  schedule(cb: () => void): boolean;
  cancel(): void;
  reset(): void;
}

export function createReconnect(
  maxAttempts = MAX_RECONNECT_ATTEMPTS,
  maxBackoff = MAX_BACKOFF_MS,
  initialBackoff = INITIAL_BACKOFF_MS,
): Reconnect {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    get canRetry() {
      return attempts < maxAttempts;
    },
    schedule(cb) {
      if (attempts >= maxAttempts) return false;
      const delay = Math.min(initialBackoff * 2 ** attempts, maxBackoff);
      attempts++;
      timer = setTimeout(() => {
        timer = null;
        cb();
      }, delay);
      return true;
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    reset() {
      attempts = 0;
    },
  };
}

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data);
    if (
      typeof msg !== "object" || msg === null || typeof msg.type !== "string"
    ) return null;
    return msg as ServerMessage;
  } catch {
    return null;
  }
}

export interface VoiceSession {
  readonly state: Signal<AgentState>;
  readonly messages: Signal<Message[]>;
  readonly transcript: Signal<string>;
  readonly error: Signal<SessionError | null>;
  readonly disconnected: Signal<{ intentional: boolean } | null>;
  connect(options?: { signal?: AbortSignal }): void;
  cancel(): void;
  resetState(): void;
  reset(): void;
  disconnect(): void;
  [Symbol.dispose](): void;
}

export function createVoiceSession(options: SessionOptions): VoiceSession {
  const state = signal<AgentState>("connecting");
  const messages = signal<Message[]>([]);
  const transcript = signal<string>("");
  const error = signal<SessionError | null>(null);
  const disconnected = signal<{ intentional: boolean } | null>(null);

  let ws: WebSocket | null = null;
  let voiceIO: VoiceIO | null = null;
  let streamingMessage = false;
  const reconnector = createReconnect();
  let connectionController: AbortController | null = null;
  let hasConnected = false;
  let audioSetupInFlight = false;
  let pongReceived = true;

  function trySend(msg: Record<string, unknown>): boolean {
    try {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return true;
      }
    } catch { /* ws may have closed between check and send */ }
    return false;
  }

  function cleanupAudio(): void {
    audioSetupInFlight = false;
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

  function startPing(sig: AbortSignal): void {
    pongReceived = true;
    const id = setInterval(() => {
      if (!pongReceived) {
        ws?.close();
        return;
      }
      pongReceived = false;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
    sig.addEventListener("abort", () => clearInterval(id));
  }

  function scheduleReconnect(): void {
    const scheduled = reconnector.schedule(() => {
      connect();
    });
    if (!scheduled) {
      batch(() => {
        error.value = {
          code: "connection",
          message: "Connection lost. Please refresh.",
        };
        state.value = "error";
      });
      return;
    }
    state.value = "connecting";
  }

  async function handleReady(
    msg: Extract<ServerMessage, { type: "ready" }>,
  ): Promise<void> {
    if (audioSetupInFlight) return;
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
      const currentWs = ws!;
      const io = await createVoiceIO({
        sttSampleRate: msg.sample_rate ?? DEFAULT_STT_SAMPLE_RATE,
        ttsSampleRate: msg.tts_sample_rate ?? DEFAULT_TTS_SAMPLE_RATE,
        captureWorkletSrc: captureWorklet,
        playbackWorkletSrc: playbackWorklet,
        onMicData: (pcm16: ArrayBuffer) => {
          if (currentWs.readyState === WebSocket.OPEN) currentWs.send(pcm16);
        },
      });
      if (ws?.readyState !== WebSocket.OPEN) {
        io.close();
        return;
      }
      voiceIO = io;
      ws.send(JSON.stringify({ type: "audio_ready" }));
      state.value = "listening";
    } catch (err: unknown) {
      if (ws?.readyState !== WebSocket.OPEN) return;
      batch(() => {
        error.value = {
          code: "audio",
          message: `Microphone access failed: ${(err as Error).message}`,
        };
        state.value = "error";
      });
    } finally {
      audioSetupInFlight = false;
    }
  }

  function handleServerMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      if (state.value === "speaking") {
        voiceIO?.enqueue(event.data);
      }
      return;
    }

    const msg = parseServerMessage(event.data as string);
    if (!msg) return;

    batch(() => {
      switch (msg.type) {
        case "ready":
          hasConnected = true;
          reconnector.reset();
          void handleReady(msg);
          break;
        case "partial_transcript":
          transcript.value = msg.text;
          break;
        case "final_transcript":
          transcript.value = msg.text;
          break;
        case "turn":
          transcript.value = "";
          messages.value = [
            ...messages.value,
            { role: "user", text: msg.text },
          ];
          state.value = "thinking";
          break;
        case "chat":
          messages.value = [
            ...messages.value,
            { role: "assistant", text: msg.text },
          ];
          state.value = "speaking";
          break;
        case "chat_delta": {
          const msgs = messages.value;
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant" && streamingMessage) {
            messages.value = [
              ...msgs.slice(0, -1),
              { role: "assistant", text: last.text + msg.text },
            ];
          } else {
            streamingMessage = true;
            messages.value = [
              ...msgs,
              { role: "assistant", text: msg.text },
            ];
          }
          state.value = "speaking";
          break;
        }
        case "chat_done":
          streamingMessage = false;
          if (msg.text) {
            const msgs = messages.value;
            const last = msgs[msgs.length - 1];
            if (last && last.role === "assistant") {
              messages.value = [
                ...msgs.slice(0, -1),
                { role: "assistant", text: msg.text },
              ];
            }
          }
          break;
        case "tts_done":
          streamingMessage = false;
          voiceIO?.done();
          state.value = "listening";
          break;
        case "cancelled":
          voiceIO?.flush();
          state.value = "listening";
          break;
        case "reset":
          voiceIO?.flush();
          resetState();
          break;
        case "pong":
          pongReceived = true;
          break;
        case "error": {
          const details = (msg as ErrorMessage).details;
          const fullMessage = details?.length
            ? `${msg.message}: ${details.join(", ")}`
            : msg.message;
          console.error("Agent error:", fullMessage);
          error.value = { code: "protocol", message: fullMessage };
          state.value = "error";
          break;
        }
      }
    });
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
    const socket = new WebSocket(wsUrl);
    ws = socket;
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      if (hasConnected && messages.value.length > 0) {
        socket.send(JSON.stringify({
          type: "history",
          messages: messages.value.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }));
      }
      state.value = "ready";
      startPing(sig);
    }, { signal: sig });

    socket.addEventListener("message", (event) => {
      handleServerMessage(event);
    }, { signal: sig });

    socket.addEventListener("close", () => {
      if (sig.aborted) {
        state.value = "connecting";
        return;
      }
      controller.abort();
      disconnected.value = { intentional: false };
      cleanupAudio();
      scheduleReconnect();
    }, { signal: sig });
  }

  function cancel(): void {
    voiceIO?.flush();
    state.value = "listening";
    trySend({ type: "cancel" });
  }

  function reset(): void {
    voiceIO?.flush();
    if (trySend({ type: "reset" })) return;
    resetState();
    disconnect();
    connect();
  }

  function disconnect(): void {
    connectionController?.abort();
    connectionController = null;
    reconnector.cancel();
    cleanupAudio();
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
