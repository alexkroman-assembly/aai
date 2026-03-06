import { z } from "zod";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "./types.ts";

// ── BuiltinTool enum (single source of truth for validation) ────

const BuiltinToolSchema = z.enum([
  "web_search",
  "visit_webpage",
  "fetch_json",
  "run_code",
  "user_input",
  "final_answer",
]);

// ── Agent config returned by getConfig RPC ──────────────────────

const AgentConfigSchema = z.object({
  name: z.string().optional(),
  instructions: z.string().default(DEFAULT_INSTRUCTIONS),
  greeting: z.string().default(DEFAULT_GREETING),
  voice: z.string().default("luna"),
  prompt: z.string().optional(),
  builtinTools: z.array(BuiltinToolSchema).optional(),
});

const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

export const GetConfigResponseSchema = z.object({
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema).default([]),
});

export const AgentMetadataSchema = z.object({
  slug: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  transport: z.array(z.enum(["websocket", "twilio"])).default(["websocket"]),
  owner_hash: z.string().optional(),
});

// ── RPC wire-format types (worker ↔ host postMessage) ───────────

export const RpcRequestSchema = z.discriminatedUnion("type", [
  z.object({ id: z.number(), type: z.literal("getConfig") }),
  z.object({
    id: z.number(),
    type: z.literal("executeTool"),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({
    id: z.number(),
    type: z.literal("invokeHook"),
    hook: z.enum(["onConnect", "onDisconnect", "onError", "onTurn"]),
    sessionId: z.string(),
    text: z.string().optional(),
    error: z.string().optional(),
  }),
]);

export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcResponseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type RpcResponse = z.infer<typeof RpcResponseSchema>;
