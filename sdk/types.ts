import { z } from "zod";
import type { BuiltinTool, ToolSchema, Transport } from "./_schema.ts";
export type { AgentConfig, BuiltinTool, ToolSchema } from "./_schema.ts";

export type ToolContext = {
  sessionId: string;
  env: Record<string, string>;
  signal?: AbortSignal;
};

export type HookContext = {
  sessionId: string;
  env: Record<string, string>;
};

export type ToolDef = {
  description: string;
  parameters?: z.ZodObject<z.ZodRawShape>;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
};

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
  | (string & Record<never, never>);

export type AgentOptions = {
  name: string;
  env?: string[];
  transport?: Transport | Transport[];
  instructions?: string;
  greeting?: string;
  voice?: Voice;
  prompt?: string;
  builtinTools?: BuiltinTool[];
  tools?: Record<string, ToolDef>;
  onConnect?: (ctx: HookContext) => void | Promise<void>;
  onDisconnect?: (ctx: HookContext) => void | Promise<void>;
  onError?: (error: Error, ctx?: HookContext) => void;
  onTurn?: (text: string, ctx: HookContext) => void | Promise<void>;
};

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

const EMPTY_PARAMS = z.object({});

export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: z.toJSONSchema(def.parameters ?? EMPTY_PARAMS),
  }));
}

export type AgentDef = {
  readonly name: string;
  readonly env: readonly string[];
  readonly transport: readonly Transport[];
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
};
