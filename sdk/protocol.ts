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
