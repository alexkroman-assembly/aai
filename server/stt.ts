import { StreamingTranscriber } from "assemblyai";
import type { TurnEvent } from "assemblyai";
import type { STTConfig } from "./types.ts";
import * as metrics from "./metrics.ts";

// ── Event detail types ──────────────────────────────────────────────

export type SttTranscriptDetail = {
  text: string;
  isFinal: boolean;
  turnOrder?: number;
};
export type SttTurnDetail = { text: string; turnOrder?: number };
// ── Public type ─────────────────────────────────────────────────────

export type SttConnection = {
  readonly connected: boolean;
  readonly closed: boolean;
  connect(): Promise<void>;
  send(audio: Uint8Array): void;
  clear(): void;
  close(): void | Promise<void>;
  onTranscript: ((detail: SttTranscriptDetail) => void) | null;
  onTurn: ((detail: SttTurnDetail) => void) | null;
  onError: ((error: Error) => void) | null;
  onClose: (() => void) | null;
};

// ── Factory ─────────────────────────────────────────────────────────

export function createSttConnection(
  apiKey: string,
  config: STTConfig,
): SttConnection {
  let state: "Idle" | "Connecting" | "Open" | "Closed" = "Idle";
  let transcriber: StreamingTranscriber | null = null;
  let msgCount = 0;

  const conn: SttConnection = {
    onTranscript: null,
    onTurn: null,
    onError: null,
    onClose: null,

    get connected(): boolean {
      return state === "Open";
    },

    get closed(): boolean {
      return state === "Closed";
    },

    async connect(): Promise<void> {
      if (state !== "Idle") {
        throw new Error(`Cannot connect: state is ${state}`);
      }

      state = "Connecting";
      const t0 = performance.now();

      console.info("Connecting to STT", {
        url: config.wssBase,
        speechModel: config.speechModel,
        sampleRate: config.sampleRate,
      });

      const t = new StreamingTranscriber({
        apiKey,
        websocketBaseUrl: config.wssBase,
        sampleRate: config.sampleRate,
        speechModel: config.speechModel as
          | "u3-rt-pro"
          | "whisper-rt"
          | "u3-pro"
          | "universal-streaming-english"
          | "universal-streaming-multilingual",
        formatTurns: config.formatTurns,
        minTurnSilence: config.minTurnSilence,
        maxTurnSilence: config.maxTurnSilence,
        vadThreshold: config.vadThreshold,
        ...(config.sttPrompt ? { prompt: config.sttPrompt } : {}),
      });

      wireTranscriber(t);

      try {
        await t.connect();
      } catch (err: unknown) {
        metrics.sttConnectDuration.observe((performance.now() - t0) / 1000);
        metrics.errorsTotal.inc({ component: "stt" });
        state = "Closed";
        const msg = apiKey
          ? err instanceof Error ? err.message : String(err)
          : "STT connection failed — ASSEMBLYAI_API_KEY is not set";
        throw new Error(msg);
      }

      metrics.sttConnectDuration.observe((performance.now() - t0) / 1000);
      console.info("STT WebSocket connected");

      transcriber = t;
      state = "Open";
    },

    send(audio: Uint8Array): void {
      if (state !== "Open") return;
      try {
        transcriber!.sendAudio(audio.buffer);
      } catch {
        console.warn("STT send skipped, ws not open");
      }
    },

    clear(): void {
      if (state !== "Open") return;
      try {
        transcriber!.forceEndpoint();
      } catch (e) {
        console.warn("STT forceEndpoint failed (socket may be closed)", e);
      }
    },

    async close(): Promise<void> {
      if (state === "Closed") return;
      state = "Closed";
      try {
        await transcriber?.close(false);
      } catch (e) {
        console.warn("STT close failed", e);
      }
      transcriber = null;
    },
  };

  function wireTranscriber(t: StreamingTranscriber): void {
    t.on("turn", (turn: TurnEvent) => {
      msgCount++;
      const text = (turn.transcript ?? "").trim();
      console.info("STT message", {
        msgCount,
        type: "Turn",
        transcript: text.slice(0, 100),
        turnOrder: turn.turn_order,
        endOfTurn: turn.end_of_turn,
        turnIsFormatted: turn.turn_is_formatted,
      });

      if (!text) return;

      if (turn.end_of_turn) {
        conn.onTurn?.({ text, turnOrder: turn.turn_order });
      } else {
        conn.onTranscript?.({
          text,
          isFinal: false,
          turnOrder: turn.turn_order,
        });
      }
    });

    t.on("error", (err: Error) => {
      metrics.errorsTotal.inc({ component: "stt" });
      conn.onError?.(err);
    });

    t.on("close", (code: number, reason: string) => {
      console.info("STT WebSocket closed", { code, reason, msgCount });
      if (code !== 1000 && code !== 1005) {
        console.error("WebSocket closed unexpectedly", { code, reason });
        conn.onError?.(
          new Error(`STT WebSocket closed unexpectedly (code ${code})`),
        );
      }
      state = "Closed";
      transcriber = null;
      conn.onClose?.();
    });
  }

  return conn;
}
