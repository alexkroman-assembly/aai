import { z } from "zod";

// ── Transport ───────────────────────────────────────────────────

export type Transport = "websocket" | "twilio";

/** Normalize a transport field value into an array. */
export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

const TransportSchema = z.enum(["websocket", "twilio"]);

const TransportFieldSchema = z.union([
  TransportSchema,
  z.array(TransportSchema),
]).optional();

// ── agent.json ──────────────────────────────────────────────────

export type AgentJson = {
  slug: string;
  env: string[];
  transport?: Transport | Transport[];
  npm?: Record<string, string>;
};

export const AgentJsonSchema: z.ZodType<AgentJson> = z.object({
  slug: z.string().min(1),
  env: z.array(z.string()),
  transport: TransportFieldSchema,
  npm: z.record(z.string(), z.string()).optional(),
});

// ── Deploy request body ─────────────────────────────────────────

export type DeployBody = {
  slug: string;
  env: Record<string, string>;
  worker: string;
  client: string;
  transport?: Transport | Transport[];
};

export const DeployBodySchema: z.ZodType<DeployBody> = z.object({
  slug: z.string().min(1),
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1),
  client: z.string().min(1),
  transport: TransportFieldSchema,
});

// ── Agent environment variables ─────────────────────────────────

export type AgentEnv = {
  ASSEMBLYAI_API_KEY: string;
  LLM_MODEL?: string;
  [key: string]: unknown;
};

export const EnvSchema: z.ZodType<AgentEnv> = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().optional(),
}).passthrough();
