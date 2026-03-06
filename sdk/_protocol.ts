// WebSocket wire-format types shared by server/ and ui/.
// Zod schemas are the source of truth; TypeScript types are derived via z.infer.

import { z } from "zod";

export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;

// ---------------------------------------------------------------------------
// Server → Client types
// ---------------------------------------------------------------------------

export type ReadyMessage = {
  type: "ready";
  sample_rate: number;
  tts_sample_rate: number;
};

export type PartialTranscriptMessage = {
  type: "partial_transcript";
  text: string;
};

export type FinalTranscriptMessage = {
  type: "final_transcript";
  text: string;
  turn_order?: number;
};

export type TurnMessage = {
  type: "turn";
  text: string;
  turn_order?: number;
};

export type ChatResponseMessage = { type: "chat"; text: string };
export type ChatDeltaMessage = { type: "chat_delta"; text: string };
export type ChatDoneMessage = { type: "chat_done"; text: string };
export type TtsDoneMessage = { type: "tts_done" };
export type CancelledMessage = { type: "cancelled" };
export type ResetMessage = { type: "reset" };

export type ErrorMessage = {
  type: "error";
  message: string;
  details?: string[];
};

export type PongMessage = { type: "pong" };

/** PCM16 LE audio. Client sends at `sample_rate`, server sends at `tts_sample_rate`. */
export type AudioFrame = ArrayBuffer;

export type ServerMessage =
  | ReadyMessage
  | PartialTranscriptMessage
  | FinalTranscriptMessage
  | TurnMessage
  | ChatResponseMessage
  | ChatDeltaMessage
  | ChatDoneMessage
  | TtsDoneMessage
  | CancelledMessage
  | ResetMessage
  | ErrorMessage
  | PongMessage;

// ---------------------------------------------------------------------------
// Server → Client Zod schema
// ---------------------------------------------------------------------------

export const ServerMessageSchema: z.ZodType<ServerMessage> = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("ready"),
      sample_rate: z.number(),
      tts_sample_rate: z.number(),
    }),
    z.object({ type: z.literal("partial_transcript"), text: z.string() }),
    z.object({
      type: z.literal("final_transcript"),
      text: z.string(),
      turn_order: z.number().optional(),
    }),
    z.object({
      type: z.literal("turn"),
      text: z.string(),
      turn_order: z.number().optional(),
    }),
    z.object({ type: z.literal("chat"), text: z.string() }),
    z.object({ type: z.literal("chat_delta"), text: z.string() }),
    z.object({ type: z.literal("chat_done"), text: z.string() }),
    z.object({ type: z.literal("tts_done") }),
    z.object({ type: z.literal("cancelled") }),
    z.object({ type: z.literal("reset") }),
    z.object({
      type: z.literal("error"),
      message: z.string(),
      details: z.array(z.string()).optional(),
    }),
    z.object({ type: z.literal("pong") }),
  ]);

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "audio_ready" }
  | { type: "cancel" }
  | { type: "reset" }
  | { type: "ping" }
  | {
    type: "history";
    messages: { role: "user" | "assistant"; text: string }[];
  };

export const ClientMessageSchema: z.ZodType<ClientMessage> = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("audio_ready") }),
    z.object({ type: z.literal("cancel") }),
    z.object({ type: z.literal("reset") }),
    z.object({ type: z.literal("ping") }),
    z.object({
      type: z.literal("history"),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
      })),
    }),
  ]);
