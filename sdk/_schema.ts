import { z } from "zod";

export type Transport = "websocket" | "twilio";

export const TransportSchema: z.ZodType<Transport> = z.enum([
  "websocket",
  "twilio",
]);

export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

export type BuiltinTool =
  | "web_search"
  | "visit_webpage"
  | "fetch_json"
  | "run_code"
  | "user_input"
  | "final_answer";

const BuiltinToolSchema: z.ZodType<BuiltinTool> = z.enum([
  "web_search",
  "visit_webpage",
  "fetch_json",
  "run_code",
  "user_input",
  "final_answer",
]);

export type AgentConfig = {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: BuiltinTool[];
};

export const AgentConfigSchema: z.ZodType<AgentConfig> = z.object({
  name: z.string().optional(),
  instructions: z.string(),
  greeting: z.string(),
  voice: z.string(),
  prompt: z.string().optional(),
  builtinTools: z.array(BuiltinToolSchema).optional(),
});

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const ToolSchemaSchema: z.ZodType<ToolSchema> = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

export type DeployBody = {
  env: Record<string, string>;
  worker: string;
  client: string;
  transport?: Transport | Transport[];
  config: AgentConfig;
  toolSchemas?: ToolSchema[];
};

export const DeployBodySchema: z.ZodType<DeployBody> = z.object({
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1).max(10_000_000),
  client: z.string().min(1).max(10_000_000),
  transport: z.union([
    TransportSchema,
    z.array(TransportSchema),
  ]).optional(),
  config: AgentConfigSchema,
  toolSchemas: z.array(ToolSchemaSchema).optional(),
});

export type AgentEnv = {
  ASSEMBLYAI_API_KEY: string;
  LLM_MODEL?: string;
  [key: string]: unknown;
};

export const EnvSchema: z.ZodType<AgentEnv> = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().optional(),
}).passthrough();
