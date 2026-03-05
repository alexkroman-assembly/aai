import { batch, type Signal, signal } from "@preact/signals";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  type ErrorMessage,
  type ServerMessage,
} from "@aai/server/protocol";

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

import type { AudioPlayer, MicCapture } from "./audio.ts";

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

export class VoiceSession {
  readonly state: Signal<AgentState> = signal<AgentState>("connecting");
  readonly messages: Signal<Message[]> = signal<Message[]>([]);
  readonly transcript: Signal<string> = signal<string>("");
  readonly error: Signal<SessionError | null> = signal<SessionError | null>(
    null,
  );
  readonly disconnected: Signal<{ intentional: boolean } | null> = signal<
    { intentional: boolean } | null
  >(null);

  private ws: WebSocket | null = null;
  private player: AudioPlayer | null = null;
  private mic: MicCapture | null = null;
  private reconnector = createReconnect();
  private connectionController: AbortController | null = null;
  private hasConnected = false;
  private audioSetupInFlight = false;
  private pongReceived = true;

  constructor(private options: SessionOptions) {}

  connect(options?: { signal?: AbortSignal }): void {
    this.disconnected.value = null;
    this.connectionController?.abort();
    const controller = new AbortController();
    this.connectionController = controller;
    const { signal } = controller;

    if (options?.signal) {
      options.signal.addEventListener("abort", () => this.disconnect(), {
        signal,
      });
    }

    const base = this.options.platformUrl;
    const wsUrl = new URL("websocket", base.endsWith("/") ? base : base + "/");
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    if (this.hasConnected) wsUrl.searchParams.set("resume", "1");
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      if (this.hasConnected && this.messages.value.length > 0) {
        ws.send(JSON.stringify({
          type: "history",
          messages: this.messages.value.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }));
      }
      this.state.value = "ready";
      this.startPing(signal);
    }, { signal });

    ws.addEventListener("message", (event) => {
      this.handleServerMessage(event);
    }, { signal });

    ws.addEventListener("close", () => {
      if (signal.aborted) {
        this.state.value = "connecting";
        return;
      }
      controller.abort();
      this.disconnected.value = { intentional: false };
      this.cleanupAudio();
      this.scheduleReconnect();
    }, { signal });
  }

  private handleServerMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      if (this.state.value === "speaking") {
        this.player?.enqueue(event.data);
      }
      return;
    }

    const msg = parseServerMessage(event.data as string);
    if (!msg) return;

    batch(() => {
      switch (msg.type) {
        case "ready":
          this.hasConnected = true;
          this.reconnector.reset();
          void this.handleReady(msg);
          break;
        case "partial_transcript":
          this.transcript.value = msg.text;
          break;
        case "final_transcript":
          this.transcript.value = msg.text;
          break;
        case "turn":
          this.transcript.value = "";
          this.messages.value = [
            ...this.messages.value,
            { role: "user", text: msg.text },
          ];
          this.state.value = "thinking";
          break;
        case "chat":
          this.messages.value = [
            ...this.messages.value,
            { role: "assistant", text: msg.text },
          ];
          this.state.value = "speaking";
          break;
        case "tts_done":
          this.state.value = "listening";
          break;
        case "cancelled":
          this.player?.flush();
          this.state.value = "listening";
          break;
        case "reset":
          this.player?.flush();
          this.resetState();
          break;
        case "pong":
          this.pongReceived = true;
          break;
        case "error": {
          const details = (msg as ErrorMessage).details;
          const fullMessage = details?.length
            ? `${msg.message}: ${details.join(", ")}`
            : msg.message;
          console.error("Agent error:", fullMessage);
          this.error.value = { code: "protocol", message: fullMessage };
          this.state.value = "error";
          break;
        }
      }
    });
  }

  private async handleReady(
    msg: Extract<ServerMessage, { type: "ready" }>,
  ): Promise<void> {
    if (this.audioSetupInFlight) return;
    this.audioSetupInFlight = true;
    try {
      // esbuild inlines these as strings; Deno sees JS modules, so we cast.
      const [
        { createAudioPlayer, startMicCapture },
        captureWorklet,
        playbackWorklet,
      ] = await Promise.all([
        import("./audio.ts"),
        import("./worklets/pcm16-capture.worklet.js").then((m) =>
          m.default as unknown as string
        ),
        import("./worklets/pcm16-playback.worklet.js").then((m) =>
          m.default as unknown as string
        ),
      ]);
      const [player, mic] = await Promise.all([
        createAudioPlayer(
          msg.tts_sample_rate ?? DEFAULT_TTS_SAMPLE_RATE,
          playbackWorklet,
        ),
        startMicCapture(
          this.ws!,
          msg.sample_rate ?? DEFAULT_STT_SAMPLE_RATE,
          captureWorklet,
        ),
      ]);
      if (this.ws?.readyState !== WebSocket.OPEN) {
        player.close();
        mic.close();
        return;
      }
      this.player = player;
      this.mic = mic;
      this.ws.send(JSON.stringify({ type: "audio_ready" }));
      this.state.value = "listening";
    } catch (err: unknown) {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      batch(() => {
        this.error.value = {
          code: "audio",
          message: `Microphone access failed: ${(err as Error).message}`,
        };
        this.state.value = "error";
      });
    } finally {
      this.audioSetupInFlight = false;
    }
  }

  private startPing(signal: AbortSignal): void {
    this.pongReceived = true;
    const id = setInterval(() => {
      if (!this.pongReceived) {
        this.ws?.close();
        return;
      }
      this.pongReceived = false;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
    signal.addEventListener("abort", () => clearInterval(id));
  }

  private scheduleReconnect(): void {
    const scheduled = this.reconnector.schedule(() => {
      this.connect();
    });
    if (!scheduled) {
      batch(() => {
        this.error.value = {
          code: "connection",
          message: "Connection lost. Please refresh.",
        };
        this.state.value = "error";
      });
      return;
    }
    this.state.value = "connecting";
  }

  private cleanupAudio(): void {
    this.audioSetupInFlight = false;
    this.mic?.close();
    this.mic = null;
    this.player?.close();
    this.player = null;
  }

  private trySend(msg: Record<string, unknown>): boolean {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
        return true;
      }
    } catch { /* ws may have closed between check and send */ }
    return false;
  }

  cancel(): void {
    this.player?.flush();
    this.state.value = "listening";
    this.trySend({ type: "cancel" });
  }

  resetState(): void {
    batch(() => {
      this.messages.value = [];
      this.transcript.value = "";
      this.error.value = null;
    });
  }

  reset(): void {
    this.player?.flush();
    if (this.trySend({ type: "reset" })) return;
    this.resetState();
    this.disconnect();
    this.connect();
  }

  disconnect(): void {
    this.connectionController?.abort();
    this.connectionController = null;
    this.reconnector.cancel();
    this.cleanupAudio();
    this.ws?.close();
    this.ws = null;
    this.state.value = "connecting";
    this.disconnected.value = { intentional: true };
  }

  [Symbol.dispose](): void {
    this.disconnect();
  }
}
