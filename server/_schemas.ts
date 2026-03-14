// Copyright 2025 the AAI authors. MIT license.
// Zod validation schemas for server-side use.
// These validate untrusted input at HTTP/WebSocket boundaries.
// Protocol schemas (ClientMessage, Twilio) live in @aai/sdk/protocol.

import { z } from "zod";
import type {
  AgentConfig,
  AgentEnv,
  AgentMode,
  BuiltinTool,
  DeployBody,
  ToolChoice,
  Transport,
} from "@aai/sdk/types";

export { TwilioMessageSchema } from "@aai/sdk/protocol";
import type { KvRequest } from "@aai/sdk/protocol";

/** Zod schema for validating transport type values. */
export const TransportSchema: z.ZodType<Transport> = z.enum([
  "websocket",
  "twilio",
]);

/** Zod schema for validating builtin tool name values. */
export const BuiltinToolSchema: z.ZodType<BuiltinTool> = z.enum([
  "web_search",
  "visit_webpage",
  "fetch_json",
  "run_code",
  "user_input",
  "final_answer",
]);

/** Zod schema for validating tool choice configuration values. */
export const ToolChoiceSchema: z.ZodType<ToolChoice> = z.union([
  z.enum(["auto", "required", "none"]),
  z.object({ type: z.literal("tool"), toolName: z.string().min(1) }),
]);

/** Zod schema for validating agent mode values (`"full"` or `"stt-only"`). */
export const AgentModeSchema: z.ZodType<AgentMode> = z.enum([
  "full",
  "stt-only",
]);

/** Zod schema for validating the full agent configuration object. */
export const AgentConfigSchema: z.ZodType<AgentConfig> = z.object({
  name: z.string().min(1),
  mode: AgentModeSchema.optional(),
  instructions: z.string(),
  greeting: z.string(),
  voice: z.string(),
  sttPrompt: z.string().min(1).optional(),
  maxSteps: z.number().int().positive().optional(),
  toolChoice: ToolChoiceSchema.optional(),
  transport: z.array(TransportSchema).min(1).optional(),
  builtinTools: z.array(BuiltinToolSchema).optional(),
});

/** Zod schema for validating a tool's JSON schema definition. */
export const ToolSchemaSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }).catchall(z.unknown()),
});

/** Zod schema for validating the deploy request body. */
export const DeployBodySchema: z.ZodType<DeployBody> = z.object({
  env: z.record(z.string(), z.string()).optional(),
  worker: z.string().min(1).max(10_000_000),
  html: z.string().min(1).max(10_000_000),
  transport: z.array(TransportSchema).min(1).optional(),
});

/** Zod schema for validating agent environment variables (requires `ASSEMBLYAI_API_KEY`). */
export const EnvSchema: z.ZodType<AgentEnv> = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().optional(),
}).catchall(z.string());

/** Zod schema for validating the config payload returned by agent workers. */
export const WorkerConfigSchema = z.object({
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema),
});

/** Metadata stored alongside an agent bundle in the bundle store. */
export type AgentMetadata = {
  /** The agent's unique slug identifier. */
  slug: string;
  /** Environment variables provided at deploy time. */
  env: Record<string, string>;
  /** Supported transport types for this agent. */
  transport: readonly Transport[];
  /** SHA-256 hashes of API keys authorized to manage this agent. */
  "credential_hashes": string[];
};

/** Zod schema for validating agent metadata from the bundle store. */
export const AgentMetadataSchema: z.ZodType<AgentMetadata> = z.object({
  slug: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  transport: z.array(TransportSchema).default(["websocket"]),
  credential_hashes: z.array(z.string()).default([]),
});

/**
 * KV HTTP request type extending the core KV operations with the
 * server-only `keys` operation.
 */
export type KvHttpRequest =
  | KvRequest
  | { op: "keys"; pattern?: string | undefined };

/** Zod schema for validating KV HTTP request bodies (get, set, del, list, keys). */
export const KvHttpRequestSchema: z.ZodType<KvHttpRequest> = z
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
    z.object({ op: z.literal("keys"), pattern: z.string().optional() }),
  ]);
