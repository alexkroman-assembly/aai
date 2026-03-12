// WebSocket wire-format types shared by server/ and ui/.

import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;
export const AUDIO_FORMAT = "pcm16" as const;

// ── Server → Client messages ──────────────────────────────────────────

export type ServerMessage =
  | {
    type: "ready";
    protocol_version: number;
    audio_format: "pcm16";
    sample_rate: number;
    tts_sample_rate: number;
    mode?: "full" | "stt-only";
  }
  | { type: "partial_transcript"; text: string }
  | { type: "final_transcript"; text: string; turn_order?: number }
  | { type: "turn"; text: string; turn_order?: number }
  | { type: "chat"; text: string }
  | { type: "tts_done" }
  | { type: "cancelled" }
  | { type: "reset" }
  | { type: "error"; message: string; details?: string[] }
  | { type: "pong" };

export const ServerMessageSchema: z.ZodType<ServerMessage> = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("ready"),
      protocol_version: z.number().int().positive(),
      audio_format: z.literal("pcm16"),
      sample_rate: z.number().int().positive(),
      tts_sample_rate: z.number().int().positive(),
      mode: z.enum(["full", "stt-only"]).optional(),
    }),
    z.object({ type: z.literal("partial_transcript"), text: z.string() }),
    z.object({
      type: z.literal("final_transcript"),
      text: z.string(),
      turn_order: z.number().int().nonnegative().optional(),
    }),
    z.object({
      type: z.literal("turn"),
      text: z.string(),
      turn_order: z.number().int().nonnegative().optional(),
    }),
    z.object({ type: z.literal("chat"), text: z.string() }),
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

// ── Client → Server messages ──────────────────────────────────────────

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
        text: z.string().min(1),
      })).min(1),
    }),
  ]);

// ── Binary audio frame spec ───────────────────────────────────────────

/**
 * Binary audio frame specification. All audio exchanged over the WebSocket as
 * binary frames MUST conform to this spec. Any change here is a breaking
 * protocol change.
 */
const _bitsPerSample = 16 as const;
const _channels = 1 as const;

export const AudioFrameSpec = {
  /** Audio codec identifier sent in the `ready` message. */
  format: AUDIO_FORMAT,
  /** Signed 16-bit integer samples. */
  bitsPerSample: _bitsPerSample,
  /** Little-endian byte order. */
  endianness: "little" as const,
  /** Mono audio. */
  channels: _channels,
  /** Bytes per sample — derived from bitsPerSample and channels. */
  bytesPerSample: (_bitsPerSample / 8) * _channels,
} as const;

// ── KV operations (shared by worker RPC and server HTTP endpoint) ─────

export type KvRequest =
  | { op: "get"; key: string }
  | { op: "set"; key: string; value: string; ttl?: number }
  | { op: "del"; key: string }
  | { op: "list"; prefix: string; limit?: number; reverse?: boolean };

export const KvRequestBaseSchema: z.ZodType<KvRequest> = z
  .discriminatedUnion("op", [
    z.object({ op: z.literal("get"), key: z.string().min(1) }),
    z.object({
      op: z.literal("set"),
      key: z.string().min(1),
      value: z.string(),
      ttl: z.number().int().positive().optional(),
    }),
    z.object({ op: z.literal("del"), key: z.string().min(1) }),
    z.object({
      op: z.literal("list"),
      prefix: z.string(),
      limit: z.number().int().positive().optional(),
      reverse: z.boolean().optional(),
    }),
  ]);

// ── Twilio Media Stream messages ──────────────────────────────────────

export type TwilioMessage =
  | { event: "start"; start: { streamSid: string } }
  | { event: "media"; media: { payload: string } }
  | { event: "stop" }
  | { event: "connected" }
  | { event: "mark"; mark?: { name: string } };

export const TwilioMessageSchema: z.ZodType<TwilioMessage> = z
  .discriminatedUnion("event", [
    z.object({
      event: z.literal("start"),
      start: z.object({ streamSid: z.string() }),
    }),
    z.object({
      event: z.literal("media"),
      media: z.object({ payload: z.string() }),
    }),
    z.object({ event: z.literal("stop") }),
    z.object({ event: z.literal("connected") }),
    z.object({
      event: z.literal("mark"),
      mark: z.object({ name: z.string() }).optional(),
    }),
  ]);
