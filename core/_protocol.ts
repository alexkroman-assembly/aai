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

export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;

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
  | { type: "ready"; sample_rate: number; tts_sample_rate: number }
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
