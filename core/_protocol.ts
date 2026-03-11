// WebSocket wire-format types shared by server/ and ui/.
// Types are defined first; Zod schemas are annotated with z.ZodType<T> to
// satisfy JSR's no-slow-types rule for published packages.

import { z } from "zod";
import {
  type AgentConfig,
  AgentConfigSchema,
  type ToolSchema,
  ToolSchemaSchema,
  type Transport,
  TransportSchema,
} from "@aai/sdk/schema";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;
export type AudioFormat = "pcm16";
export const AUDIO_FORMAT: AudioFormat = "pcm16";

export type DevRegister = {
  type: "dev_register";
  token: string;
  config: AgentConfig;
  toolSchemas: ToolSchema[];
  env: Record<string, string>;
  transport: Transport[];
  client?: string;
};

export const DevRegisterSchema: z.ZodType<DevRegister> = z.object({
  type: z.literal("dev_register"),
  token: z.string().min(1),
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema),
  env: z.record(z.string(), z.string()),
  transport: z.array(TransportSchema),
  client: z.string().optional(),
});

export type DevRegistered = {
  type: "dev_registered";
  slug: string;
};

export const DevRegisteredSchema: z.ZodType<DevRegistered> = z.object({
  type: z.literal("dev_registered"),
  slug: z.string(),
});

export type ServerMessage =
  | {
    type: "ready";
    protocol_version: number;
    audio_format: AudioFormat;
    sample_rate: number;
    tts_sample_rate: number;
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
      protocol_version: z.number(),
      audio_format: z.literal("pcm16"),
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

export type AudioFrame = ArrayBuffer;

/**
 * Binary audio frame specification. All audio exchanged over the WebSocket as
 * binary frames MUST conform to this spec. Any change here is a breaking
 * protocol change.
 */
export const AudioFrameSpec = {
  /** Audio codec identifier sent in the `ready` message. */
  format: "pcm16" as const,
  /** Signed 16-bit integer samples. */
  bitsPerSample: 16,
  /** Little-endian byte order. */
  endianness: "little" as const,
  /** Mono audio. */
  channels: 1,
  /** Bytes per sample (bitsPerSample / 8 * channels). */
  bytesPerSample: 2,
} as const;

// ---------------------------------------------------------------------------
// Protocol state machine
// ---------------------------------------------------------------------------

/** Every valid server→client message type (text JSON or binary audio). */
export type ServerEvent = ServerMessage["type"] | "audio";

/** Every valid client→server message type (text JSON or binary audio). */
export type ClientEvent = ClientMessage["type"] | "audio";

/**
 * Defines the legal message sequences for one side of the protocol.
 *
 * `"*"` means "allowed in any state". A state that maps to `null` is terminal
 * (no further transitions). States not listed are implicitly terminal.
 */
export type StateMachine<E extends string> = {
  initial: string;
  transitions: Record<string, E[] | "*" | null>;
};

/**
 * Valid server→client state transitions.
 *
 * State names describe the phase the *server* is in. After sending a message
 * of a given type the server moves to the corresponding state.
 */
export const ServerStateMachine: StateMachine<ServerEvent> = {
  initial: "connected",
  transitions: {
    // Server has accepted the WebSocket, nothing sent yet.
    connected: ["ready"],
    // Server sent `ready`, waiting for client to set up audio.
    ready: ["partial_transcript", "final_transcript", "error", "pong"],
    // Streaming partial transcripts while user speaks.
    partial_transcript: [
      "partial_transcript",
      "final_transcript",
      "cancelled",
      "error",
      "pong",
    ],
    // User utterance finalized; server will either start a turn or continue.
    final_transcript: [
      "partial_transcript",
      "final_transcript",
      "turn",
      "cancelled",
      "error",
      "pong",
    ],
    // Turn sent; server is now thinking (running LLM + tools).
    turn: ["chat", "error", "pong"],
    // LLM response text sent; server is now streaming TTS audio.
    chat: ["audio", "tts_done", "cancelled", "error", "pong"],
    // Binary audio frame (TTS playback).
    audio: ["audio", "tts_done", "cancelled", "error", "pong"],
    // TTS finished; back to listening.
    tts_done: [
      "partial_transcript",
      "final_transcript",
      "chat",
      "error",
      "pong",
    ],
    // Turn was interrupted; back to listening.
    cancelled: [
      "partial_transcript",
      "final_transcript",
      "error",
      "pong",
    ],
    // State was reset (messages cleared); back to listening. May start greeting.
    reset: [
      "partial_transcript",
      "final_transcript",
      "chat",
      "error",
      "pong",
    ],
    // pong is a response to ping; doesn't change the underlying state.
    pong: "*",
    // error is terminal for fatal errors, but non-fatal errors can continue.
    error: [
      "partial_transcript",
      "final_transcript",
      "error",
      "pong",
    ],
  },
};

/**
 * Valid client→server state transitions.
 */
export const ClientStateMachine: StateMachine<ClientEvent> = {
  initial: "connected",
  transitions: {
    // WebSocket opened, waiting for `ready` from server.
    connected: ["audio_ready", "history", "ping"],
    // Client can optionally send history before audio_ready.
    history: ["audio_ready", "history", "ping"],
    // Client has set up audio and signaled readiness.
    audio_ready: ["audio", "cancel", "reset", "ping"],
    // Client is streaming mic audio.
    audio: ["audio", "cancel", "reset", "ping"],
    // Client requested cancellation.
    cancel: ["audio", "cancel", "reset", "ping"],
    // Client requested state reset.
    reset: ["audio_ready", "audio", "cancel", "reset", "ping"],
    // ping doesn't change the underlying state.
    ping: "*",
  },
};

/**
 * Runtime protocol validator. Tracks the current state and throws on illegal
 * transitions. Use in dev/test mode to catch ordering bugs.
 */
export class ProtocolValidator<E extends string> {
  #machine: StateMachine<E>;
  #state: string;
  #prevState: string;

  constructor(machine: StateMachine<E>) {
    this.#machine = machine;
    this.#state = machine.initial;
    this.#prevState = machine.initial;
  }

  get state(): string {
    return this.#state;
  }

  /**
   * Record a message event. Throws if the transition is illegal.
   * For events that don't change state (like `pong`/`ping` with `"*"`),
   * the state remains unchanged.
   */
  send(event: E): void {
    const allowed = this.#machine.transitions[this.#state];

    if (allowed === "*") {
      // Wildcard state (e.g. pong) — stay in current state.
      return;
    }

    if (allowed === null || allowed === undefined) {
      throw new Error(
        `Protocol violation: no transitions from terminal state "${this.#state}"`,
      );
    }

    if (!allowed.includes(event)) {
      throw new Error(
        `Protocol violation: "${event}" not allowed in state "${this.#state}" ` +
          `(allowed: ${JSON.stringify(allowed)})`,
      );
    }

    // If the event's own transition rule is "*", it means "don't change state".
    const nextAllowed = this.#machine.transitions[event];
    if (nextAllowed === "*") {
      // Stateless event (like pong/ping); preserve current state.
      return;
    }

    this.#prevState = this.#state;
    this.#state = event;
  }

  reset(): void {
    this.#state = this.#machine.initial;
    this.#prevState = this.#machine.initial;
  }
}

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
