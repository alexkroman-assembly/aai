import { z } from "zod";

export interface ToolContext {
  secrets: Record<string, string>;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export interface ToolDef {
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  // deno-lint-ignore no-explicit-any
  execute: (args: any, ctx: ToolContext) => Promise<unknown> | unknown;
}

export interface AgentOptions {
  name: string;
  instructions?: string;
  greeting?: string;
  voice?: string;
  prompt?: string;
  builtinTools?: string[];
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
  parameters: Record<string, unknown>;
}

export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: z.toJSONSchema(def.parameters) as Record<string, unknown>,
  }));
}
