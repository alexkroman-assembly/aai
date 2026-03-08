// WebSocket wire-format types shared by server/ and ui/.
// Zod schemas are the source of truth; TypeScript types are derived via z.infer.

import { z } from "zod";
import {
  AgentConfigSchema,
  ToolSchemaSchema,
  TransportSchema,
} from "../sdk/_schema.ts";

export const DEFAULT_STT_SAMPLE_RATE = 16_000;
export const DEFAULT_TTS_SAMPLE_RATE = 24_000;

export const DevRegisterSchema = z.object({
  type: z.literal("dev_register"),
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema),
  env: z.record(z.string(), z.string()),
  transport: z.array(TransportSchema),
  client: z.string(),
});
export type DevRegister = z.infer<typeof DevRegisterSchema>;

export const DevRegisteredSchema = z.object({
  type: z.literal("dev_registered"),
  slug: z.string(),
});
export type DevRegistered = z.infer<typeof DevRegisteredSchema>;

export const ServerMessageSchema = z
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

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type AudioFrame = ArrayBuffer;

export const ClientMessageSchema = z
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

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
