import { z } from "zod";

export const TransportSchema = z.enum(["websocket", "twilio"]);
export type Transport = z.infer<typeof TransportSchema>;

export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

const TransportFieldSchema = z.union([
  TransportSchema,
  z.array(TransportSchema),
]).optional();

const BuiltinToolSchema = z.enum([
  "web_search",
  "visit_webpage",
  "fetch_json",
  "run_code",
  "user_input",
  "final_answer",
]);

export const AgentConfigSchema = z.object({
  name: z.string().optional(),
  instructions: z.string(),
  greeting: z.string(),
  voice: z.string(),
  prompt: z.string().optional(),
  builtinTools: z.array(BuiltinToolSchema).optional(),
});

export type BuiltinTool = z.infer<typeof BuiltinToolSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

export type ToolSchema = z.infer<typeof ToolSchemaSchema>;

export const DeployBodySchema = z.object({
  env: z.record(z.string(), z.string()),
  worker: z.string().min(1),
  client: z.string().min(1),
  transport: TransportFieldSchema,
  config: AgentConfigSchema.optional(),
  toolSchemas: z.array(ToolSchemaSchema).optional(),
});

export type DeployBody = z.infer<typeof DeployBodySchema>;

export const EnvSchema = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().optional(),
}).passthrough();

export type AgentEnv = z.infer<typeof EnvSchema>;
