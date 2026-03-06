import { z } from "zod";

import agentJsonSchema from "./agent-json.schema.json" with { type: "json" };
import deployBodySchema from "./deploy-body.schema.json" with { type: "json" };
import envSchema from "./env.schema.json" with { type: "json" };

type JSONSchemaParam = Parameters<typeof z.fromJSONSchema>[0];

// ── TypeScript interfaces (mirror the JSON Schema files) ─────────

export type Transport = "websocket" | "twilio";

export interface AgentJson {
  slug: string;
  env: string[];
  transport?: Transport | Transport[];
  npm?: Record<string, string>;
}

export interface DeployBody {
  slug: string;
  env: Record<string, string>;
  worker: string;
  client: string;
  transport?: Transport | Transport[];
}

export interface AgentEnv {
  ASSEMBLYAI_API_KEY: string;
  LLM_MODEL?: string;
  [key: string]: string | undefined;
}

// ── Zod validators derived from JSON Schema ──────────────────────

const _AgentJsonSchema = z.fromJSONSchema(agentJsonSchema as JSONSchemaParam);
const _DeployBodySchema = z.fromJSONSchema(deployBodySchema as JSONSchemaParam);
const _EnvSchema = z.fromJSONSchema(envSchema as JSONSchemaParam);

// deno-lint-ignore no-explicit-any
type ZodSafeParse = ReturnType<(typeof _AgentJsonSchema)["safeParse"]> & { data: any; error: any };

interface SafeParseSuccess<T> {
  success: true;
  data: T;
  error: undefined;
}

interface SafeParseFailure {
  success: false;
  data: undefined;
  error: { message: string; issues: { path: (string | number)[]; message: string }[] };
}

type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

/** Parse and validate agent.json content. */
export const AgentJsonSchema = {
  safeParse(data: unknown): SafeParseResult<AgentJson> {
    return _AgentJsonSchema.safeParse(data) as SafeParseResult<AgentJson>;
  },
};

/** Parse and validate a deploy request body. */
export const DeployBodySchema = {
  safeParse(data: unknown): SafeParseResult<DeployBody> {
    return _DeployBodySchema.safeParse(data) as SafeParseResult<DeployBody>;
  },
};

/** Parse and validate agent environment variables. Throws on failure. */
export const EnvSchema = {
  parse(data: unknown): AgentEnv {
    return _EnvSchema.parse(data) as AgentEnv;
  },
  safeParse(data: unknown): SafeParseResult<AgentEnv> {
    return _EnvSchema.safeParse(data) as SafeParseResult<AgentEnv>;
  },
};

/** Normalize a transport field value into an array. */
export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

// Re-export the raw JSON schemas for direct use in docs/tools
export { agentJsonSchema, deployBodySchema, envSchema };
