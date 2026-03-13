// Copyright 2025 the AAI authors. MIT license.
/**
 * WebSocket wire-format types shared by server and client.
 *
 * @module
 */

import { z } from "zod";

/**
 * Current protocol version for client-server compatibility checks.
 *
 * Increment this when making breaking changes to the wire protocol.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Default sample rate for speech-to-text audio in Hz.
 *
 * This is the sample rate expected by the STT provider (AssemblyAI).
 */
export const DEFAULT_STT_SAMPLE_RATE = 16_000;

/**
 * Default sample rate for text-to-speech audio in Hz.
 *
 * This is the sample rate produced by the TTS provider (Rime).
 */
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;

/**
 * Audio codec identifier used in the wire protocol.
 *
 * All audio frames are 16-bit signed PCM, little-endian, mono.
 */
export const AUDIO_FORMAT = "pcm16" as const;

/**
 * Message sent from the server to the client over WebSocket.
 *
 * This is a discriminated union on the `type` field. The server sends these
 * messages to communicate session state, transcripts, agent responses, and
 * audio lifecycle events to the client.
 *
 * Message types:
 * - `ready` — Session initialized, includes audio format and sample rates
 * - `partial_transcript` — Interim STT result (may change)
 * - `final_transcript` — Finalized STT result
 * - `turn` — Agent response text for a completed turn
 * - `chat` — Streamed chat text (e.g. for text-only mode)
 * - `tts_done` — All TTS audio for the current turn has been sent
 * - `cancelled` — The current turn was cancelled (e.g. by user interruption)
 * - `reset` — Session state has been reset
 * - `error` — An error occurred
 * - `pong` — Response to a client `ping`
 */
export type ServerMessage =
  | {
    type: "ready";
    protocol_version: number;
    audio_format: "pcm16";
    sample_rate: number;
    tts_sample_rate: number;
    mode?: "full" | "stt-only" | undefined;
  }
  | { type: "partial_transcript"; text: string }
  | { type: "final_transcript"; text: string; turn_order?: number | undefined }
  | { type: "turn"; text: string; turn_order?: number | undefined }
  | { type: "chat"; text: string }
  | { type: "tts_done" }
  | { type: "cancelled" }
  | { type: "reset" }
  | { type: "error"; message: string; details?: readonly string[] | undefined }
  | { type: "pong" };

/** Zod schema for {@linkcode ServerMessage}. */
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

/**
 * Message sent from the client to the server over WebSocket.
 *
 * This is a discriminated union on the `type` field. The client sends these
 * messages to control the session and provide context.
 *
 * Message types:
 * - `audio_ready` — Client is ready to send/receive audio
 * - `cancel` — Cancel the current in-flight turn
 * - `reset` — Reset the session state
 * - `ping` — Keepalive ping (server responds with `pong`)
 * - `history` — Restore conversation history from a previous session
 */
export type ClientMessage =
  | { type: "audio_ready" }
  | { type: "cancel" }
  | { type: "reset" }
  | { type: "ping" }
  | {
    type: "history";
    messages: readonly { role: "user" | "assistant"; text: string }[];
  };

/** Zod schema for {@linkcode ClientMessage}. */
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

/**
 * Binary audio frame specification. All audio exchanged over the WebSocket as
 * binary frames MUST conform to this spec. Any change here is a breaking
 * protocol change.
 */
const _bitsPerSample = 16 as const;
const _channels = 1 as const;

/** Specification for binary audio frames exchanged over WebSocket. */
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

/**
 * KV operation request sent from the worker to the host via postMessage RPC.
 *
 * This is a discriminated union on the `op` field, representing the four
 * key-value store operations available to sandboxed agent workers.
 *
 * Operations:
 * - `get` — Retrieve a value by key
 * - `set` — Store a value with an optional TTL (in seconds)
 * - `del` — Delete a key
 * - `list` — List entries matching a key prefix, with optional limit and ordering
 */
export type KvRequest =
  | { op: "get"; key: string }
  | { op: "set"; key: string; value: string; ttl?: number | undefined }
  | { op: "del"; key: string }
  | {
    op: "list";
    prefix: string;
    limit?: number | undefined;
    reverse?: boolean | undefined;
  };

/** Zod schema for {@linkcode KvRequest}. */
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

/**
 * Message received from Twilio Media Streams over WebSocket.
 *
 * This is a discriminated union on the `event` field, representing the
 * Twilio Media Streams protocol messages.
 *
 * Event types:
 * - `start` — Stream started, includes the stream SID
 * - `media` — Audio payload (base64-encoded mulaw)
 * - `stop` — Stream ended
 * - `connected` — WebSocket connection established
 * - `mark` — A previously sent mark was reached during playback
 */
export type TwilioMessage =
  | { event: "start"; start: { streamSid: string } }
  | { event: "media"; media: { payload: string } }
  | { event: "stop" }
  | { event: "connected" }
  | { event: "mark"; mark?: { name: string } | undefined };

/** Zod schema for {@linkcode TwilioMessage}. */
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
