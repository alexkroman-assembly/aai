// --- Agent types (stable SDK surface baked into deployed bundles) ---

export interface ToolContext {
  secrets: Record<string, string>;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}

/** JSON Schema property definition. */
export interface JSONSchemaProperty {
  type?: string;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

/** JSON Schema object describing tool parameters. Must have type "object". */
export interface ToolParameters {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Shorthand parameter definition.
 * - Bare string → `{ type: "string", description: string }`
 * - Object with `optional: true` → not included in `required`
 */
export type ParamShorthand =
  | string
  | (JSONSchemaProperty & { optional?: boolean });

/**
 * Shorthand tool parameters: a flat record of param names to definitions.
 * `type: "object"` and `required` are auto-generated.
 * All params are required by default; mark with `optional: true` to opt out.
 */
export type SimpleToolParameters = Record<string, ParamShorthand>;

/** Normalize shorthand parameters into full JSON Schema ToolParameters. */
export function normalizeParameters(
  params: ToolParameters | SimpleToolParameters,
): ToolParameters {
  if (
    params && typeof params === "object" && "type" in params &&
    params.type === "object" && "properties" in params &&
    typeof params.properties === "object"
  ) {
    return params as ToolParameters;
  }
  const properties: Record<string, JSONSchemaProperty> = {};
  const required: string[] = [];
  for (const [name, def] of Object.entries(params)) {
    if (typeof def === "string") {
      properties[name] = { type: "string", description: def };
      required.push(name);
    } else {
      const { optional, ...schema } = def as JSONSchemaProperty & {
        optional?: boolean;
      };
      properties[name] = schema;
      if (!optional) required.push(name);
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}

export interface ToolDef {
  description: string;
  parameters: ToolParameters | SimpleToolParameters;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

/** Built-in tools provided by the framework. */
export type BuiltinTool =
  | "web_search"
  | "visit_webpage"
  | "fetch_json"
  | "run_code"
  | "user_input"
  | "final_answer";

/**
 * Rime TTS voice ID. Popular voices listed for autocomplete;
 * any valid Rime speaker ID is accepted.
 * Full catalog: https://docs.rime.ai/api-reference/voices
 */
export type Voice =
  | "luna"
  | "andromeda"
  | "celeste"
  | "orion"
  | "sirius"
  | "lyra"
  | "estelle"
  | "esther"
  | "kima"
  | "bond"
  | "thalassa"
  | "vespera"
  | "moss"
  | "fern"
  | "astra"
  | "tauro"
  | "walnut"
  | "arcana"
  // deno-lint-ignore ban-types
  | (string & {});

export interface AgentOptions {
  name: string;
  instructions?: string;
  greeting?: string;
  voice?: Voice;
  prompt?: string;
  builtinTools?: BuiltinTool[];
  tools?: Record<string, ToolDef>;
  onConnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  onDisconnect?: (ctx: { sessionId: string }) => void | Promise<void>;
  onError?: (error: Error, ctx?: { sessionId: string }) => void;
  onTurn?: (text: string, ctx: { sessionId: string }) => void | Promise<void>;
}

export const DEFAULT_INSTRUCTIONS: string = `\
You are a helpful voice assistant. Your goal is to provide accurate, \
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer. \
Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text." \
Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one." \
If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. Keep answers to 1-3 sentences. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing.
- Never use exclamation points. Keep your tone calm and conversational.`;

export const DEFAULT_GREETING: string =
  "Hey there. I'm a voice assistant. What can I help you with?";

export interface ToolSchema {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: normalizeParameters(def.parameters),
  }));
}

/** Agent config passed from worker to server via RPC. */
export interface AgentConfig {
  readonly name?: string;
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly prompt?: string;
  readonly builtinTools?: readonly BuiltinTool[];
}

/** Frozen agent definition returned by defineAgent(). */
export interface AgentDef {
  readonly name: string;
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly prompt?: string;
  readonly builtinTools?: readonly BuiltinTool[];
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly onConnect?: AgentOptions["onConnect"];
  readonly onDisconnect?: AgentOptions["onDisconnect"];
  readonly onError?: AgentOptions["onError"];
  readonly onTurn?: AgentOptions["onTurn"];
}
