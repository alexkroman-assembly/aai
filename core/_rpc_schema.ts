import { z } from "zod";
import {
  AgentConfigSchema,
  ToolSchemaSchema,
  TransportSchema,
} from "../sdk/_schema.ts";

export const AgentMetadataSchema = z.object({
  slug: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  transport: z.array(TransportSchema).default(["websocket"]),
  owner_hash: z.string().optional(),
  config: AgentConfigSchema.optional(),
  toolSchemas: z.array(ToolSchemaSchema).optional(),
});

export type AgentMetadata = z.infer<typeof AgentMetadataSchema>;

export const RpcRequestSchema = z.discriminatedUnion("type", [
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
  z.object({
    id: z.number(),
    type: z.literal("execute"),
    code: z.string(),
  }),
]);

export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcResponseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type RpcResponse = z.infer<typeof RpcResponseSchema>;
