// Zod validation schemas for server-side use.
// Shared schemas (Transport, AgentConfig, etc.) live in @aai/sdk/schema.
// Protocol schemas (ServerMessage, ClientMessage, KV, Twilio) live in
// @aai/core/protocol as the single source of truth.

import { z } from "zod";
import type { Transport } from "@aai/sdk/schema";

// Re-export shared schemas so existing server/ imports keep working.
export {
  AgentConfigSchema,
  BuiltinToolSchema,
  DeployBodySchema,
  EnvSchema,
  ToolChoiceSchema,
  ToolSchemaSchema,
  TransportSchema,
} from "@aai/sdk/schema";
export {
  ClientMessageSchema,
  ServerMessageSchema,
  TwilioMessageSchema,
} from "@aai/core/protocol";
import type { KvRequest } from "@aai/core/protocol";
import { TransportSchema } from "@aai/sdk/schema";

export type AgentMetadata = {
  slug: string;
  env: Record<string, string>;
  transport: Transport[];
  account_id?: string;
};

export const AgentMetadataSchema: z.ZodType<AgentMetadata> = z.object({
  slug: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  transport: z.array(TransportSchema).default(["websocket"]),
  account_id: z.string().optional(),
});

// KV HTTP endpoint: base operations + server-only `keys` operation.
export type KvHttpRequest =
  | KvRequest
  | { op: "keys"; pattern?: string };

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
