// WebSocket wire-format types shared by server/ and ui/.

import { z } from "zod";

export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;

// Server → Client

export interface ReadyMessage {
  type: "ready";
  sample_rate: number;
  tts_sample_rate: number;
}

export interface PartialTranscriptMessage {
  type: "partial_transcript";
  text: string;
}

export interface FinalTranscriptMessage {
  type: "final_transcript";
  text: string;
  turn_order?: number;
}

export interface TurnMessage {
  type: "turn";
  text: string;
  turn_order?: number;
}

export interface ChatResponseMessage {
  type: "chat";
  text: string;
}

export interface TtsDoneMessage {
  type: "tts_done";
}

export interface CancelledMessage {
  type: "cancelled";
}

export interface ResetMessage {
  type: "reset";
}

export interface ErrorMessage {
  type: "error";
  message: string;
  details?: string[];
}

export interface PongMessage {
  type: "pong";
}

/** PCM16 LE audio. Client sends at `sample_rate`, server sends at `tts_sample_rate`. */
export type AudioFrame = ArrayBuffer;

export type ServerMessage =
  | ReadyMessage
  | PartialTranscriptMessage
  | FinalTranscriptMessage
  | TurnMessage
  | ChatResponseMessage
  | TtsDoneMessage
  | CancelledMessage
  | ResetMessage
  | ErrorMessage
  | PongMessage;

// Client → Server

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
