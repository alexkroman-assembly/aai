// Copyright 2025 the AAI authors. MIT license.
/**
 * Core type definitions for the AAI agent SDK.
 *
 * @module
 */

import { z } from "zod";
import type { JSONSchema7 } from "json-schema";
import type { Kv } from "./kv.ts";

/** Result of the {@linkcode AgentOptions.onBeforeStep} hook. */
export type BeforeStepResult = { activeTools?: string[] } | void;

/**
 * Transport protocol for client-server communication.
 *
 * - `"websocket"` — Browser-based WebSocket connection (default).
 * - `"twilio"` — Twilio Media Streams for phone calls.
 */
export type Transport = "websocket" | "twilio";

/**
 * Normalize a transport value to an array of transports.
 *
 * Converts a single transport string, an array, or `undefined` into a
 * consistent `Transport[]` format.
 *
 * @param value A single transport, array of transports, or `undefined`.
 * @returns An array of transports. Defaults to `["websocket"]` when
 *   `undefined` is provided.
 *
 * @example
 * ```ts
 * import { normalizeTransport } from "@aai/sdk/types";
 *
 * normalizeTransport(undefined);      // ["websocket"]
 * normalizeTransport("twilio");       // ["twilio"]
 * normalizeTransport(["websocket", "twilio"]); // ["websocket", "twilio"]
 * ```
 */
export function normalizeTransport(
  value: Transport | readonly Transport[] | undefined,
): readonly Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

/**
 * Identifier for a built-in server-side tool.
 *
 * Built-in tools run on the host process (not inside the sandboxed worker)
 * and provide capabilities like web search, code execution, and user input.
 *
 * - `"web_search"` — Search the web for information.
 * - `"visit_webpage"` — Fetch and extract text from a URL.
 * - `"fetch_json"` — Fetch JSON from an API endpoint.
 * - `"run_code"` — Execute code in a sandboxed environment.
 * - `"user_input"` — Request additional input from the user.
 * - `"final_answer"` — Signal that the agent has finished its turn.
 */
export type BuiltinTool =
  | "web_search"
  | "visit_webpage"
  | "fetch_json"
  | "run_code"
  | "user_input"
  | "final_answer";

/**
 * How the LLM should select tools during a turn.
 *
 * - `"auto"` — The model decides whether to call a tool.
 * - `"required"` — The model must call at least one tool.
 * - `"none"` — Tool calling is disabled.
 * - `{ type: "tool"; toolName: string }` — Force a specific tool.
 */
export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "tool"; toolName: string };

/**
 * Agent operating mode.
 *
 * - `"full"` — Full pipeline: STT, LLM, and TTS (default).
 * - `"stt-only"` — Speech-to-text only; no LLM or TTS processing.
 */
export type AgentMode = "full" | "stt-only";

/**
 * Serializable agent configuration sent over the wire.
 *
 * This is the JSON-safe subset of {@linkcode AgentDef} that can be
 * transmitted between the worker and the host process via structured clone.
 */
export type AgentConfig = {
  name: string;
  mode?: AgentMode | undefined;
  instructions: string;
  greeting: string;
  voice: string;
  sttPrompt?: string | undefined;
  maxSteps?: number | undefined;
  toolChoice?: ToolChoice | undefined;
  transport?: readonly Transport[] | undefined;
  builtinTools?: readonly BuiltinTool[] | undefined;
};

/**
 * Serialized tool schema sent over the wire.
 * `parameters` must be a valid JSON Schema object (with `type`, `properties`,
 * etc.) — the Vercel AI SDK wraps it via `jsonSchema()`.
 */
export type ToolSchema = {
  name: string;
  description: string;
  parameters: JSONSchema7;
};

/**
 * Request body for the deploy endpoint.
 *
 * Sent by the CLI to the server when deploying a bundled agent.
 */
export type DeployBody = {
  /** Env vars are optional at deploy time — set separately via `aai env add`. */
  env?: Readonly<Record<string, string>> | undefined;
  worker: string;
  html: string;
  transport?: readonly Transport[] | undefined;
};

/** Environment variables required by the agent runtime. */
export type AgentEnv = {
  ASSEMBLYAI_API_KEY: string;
  LLM_MODEL?: string | undefined;
  [key: string]: string | undefined;
};

/** Config returned by the worker via RPC. */
export type WorkerConfig = {
  config: AgentConfig;
  toolSchemas: ToolSchema[];
};

/**
 * A single message in the conversation history.
 *
 * Messages are passed to tool `execute` functions via
 * {@linkcode ToolContext.messages} to provide conversation context.
 */
export type Message = {
  /** The role of the message sender. */
  role: "user" | "assistant" | "tool";
  /** The text content of the message. */
  content: string;
};

/**
 * Context passed to tool `execute` functions.
 *
 * Provides access to the session environment, state, KV store, and
 * conversation history from within a tool's execute handler.
 *
 * @typeParam S The shape of per-session state created by the agent's
 *   `state` factory. Defaults to `Record<string, unknown>`.
 *
 * @example
 * ```ts
 * import { type ToolDef } from "@aai/sdk";
 * import { z } from "zod";
 *
 * const myTool: ToolDef = {
 *   description: "Look up a value from the KV store",
 *   parameters: z.object({ key: z.string() }),
 *   execute: async ({ key }, ctx) => {
 *     const value = await ctx.kv.get(key);
 *     return { key, value };
 *   },
 * };
 * ```
 */
export type ToolContext<S = Record<string, unknown>> = {
  /** Unique identifier for the current session. */
  sessionId: string;
  /** Environment variables declared in the agent config. */
  env: Readonly<Record<string, string>>;
  /** Signal that aborts when the tool execution times out. */
  abortSignal?: AbortSignal;
  /** Mutable per-session state created by the agent's `state` factory. */
  state: S;
  /** Key-value store scoped to this agent deployment. */
  kv: Kv;
  /** Read-only snapshot of conversation messages so far. */
  messages: readonly Message[];
};

/**
 * Context passed to lifecycle hooks (`onConnect`, `onTurn`, etc.).
 *
 * Similar to {@linkcode ToolContext} but without `messages` or `abortSignal`,
 * since hooks run outside the tool execution flow.
 *
 * @typeParam S The shape of per-session state created by the agent's
 *   `state` factory. Defaults to `Record<string, unknown>`.
 */
export type HookContext<S = Record<string, unknown>> = {
  /** Unique identifier for the current session. */
  sessionId: string;
  /** Environment variables declared in the agent config. */
  env: Readonly<Record<string, string>>;
  /** Mutable per-session state created by the agent's `state` factory. */
  state: S;
  /** Key-value store scoped to this agent deployment. */
  kv: Kv;
};

/**
 * Definition of a custom tool that the agent can invoke.
 *
 * Tools are the primary way to extend agent capabilities. Each tool has a
 * description (shown to the LLM), optional Zod parameters schema, and an
 * `execute` function that runs inside the sandboxed worker.
 *
 * @typeParam P A Zod object schema describing the tool's parameters.
 *   Defaults to `any` so tools without parameters don't need an explicit
 *   type argument.
 *
 * @example
 * ```ts
 * import { type ToolDef } from "@aai/sdk";
 * import { z } from "zod";
 *
 * const weatherTool: ToolDef<typeof params> = {
 *   description: "Get current weather for a city",
 *   parameters: z.object({
 *     city: z.string().describe("City name"),
 *   }),
 *   execute: async ({ city }) => {
 *     const res = await fetch(`https://wttr.in/${city}?format=j1`);
 *     return await res.json();
 *   },
 * };
 *
 * const params = z.object({ city: z.string() });
 * ```
 */
export type ToolDef<
  // deno-lint-ignore no-explicit-any
  P extends z.ZodObject<z.ZodRawShape> = any,
  S = Record<string, unknown>,
> = {
  /** Human-readable description shown to the LLM. */
  description: string;
  /** Zod schema for the tool's parameters. */
  parameters?: P | undefined;
  /** Function that executes the tool and returns a result. */
  execute(
    args: z.infer<P>,
    ctx: ToolContext<S>,
  ): Promise<unknown> | unknown;
};

/**
 * Available TTS voice identifiers.
 *
 * These voices are provided by the Rime TTS engine. The type also accepts
 * arbitrary strings to support new voices without SDK updates.
 *
 * @default {"luna"}
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
  | (string & Record<never, never>);

/**
 * Information about a completed agentic step, passed to the `onStep` hook.
 *
 * Each turn may consist of multiple steps (up to `maxSteps`). A step
 * represents one LLM invocation that may include tool calls and text output.
 */
export type StepInfo = {
  /** 1-based step index within the current turn. */
  stepNumber: number;
  /** Tool calls made during this step. */
  toolCalls: readonly { toolName: string; args: Record<string, unknown> }[];
  /** LLM text output for this step. */
  text: string;
};

/**
 * Options passed to {@linkcode defineAgent} to configure an agent.
 *
 * Only `name` is required; all other fields have sensible defaults.
 *
 * @typeParam S The shape of per-session state returned by the `state`
 *   factory. Defaults to `any`.
 *
 * @example
 * ```ts
 * import { defineAgent } from "@aai/sdk";
 * import { z } from "zod";
 *
 * export default defineAgent({
 *   name: "research-bot",
 *   instructions: "You help users research topics.",
 *   voice: "orion",
 *   builtinTools: ["web_search"],
 *   tools: {
 *     summarize: {
 *       description: "Summarize text",
 *       parameters: z.object({ text: z.string() }),
 *       execute: ({ text }) => text.slice(0, 200) + "...",
 *     },
 *   },
 * });
 * ```
 */
// deno-lint-ignore no-explicit-any
export type AgentOptions<S = any> = {
  /** Display name for the agent. */
  name: string;
  /**
   * Operating mode.
   *
   * @default {"full"}
   */
  mode?: AgentMode;
  /**
   * Environment variable names the agent requires at deploy time.
   *
   * @default {["ASSEMBLYAI_API_KEY"]}
   */
  env?: readonly string[];
  /**
   * Transport(s) the agent supports.
   *
   * @default {"websocket"}
   */
  transport?: Transport | readonly Transport[];
  /** System prompt for the LLM. Defaults to a built-in voice-optimized prompt. */
  instructions?: string;
  /** Initial spoken greeting when a session starts. */
  greeting?: string;
  /**
   * TTS voice to use.
   *
   * @default {"luna"}
   */
  voice?: Voice;
  /** Prompt hint for the STT model to improve transcription accuracy. */
  sttPrompt?: string;
  /**
   * Maximum agentic loop iterations per turn. Can be a static number or
   * a function that receives the hook context and returns a number.
   *
   * @default {5}
   */
  maxSteps?: number | ((ctx: HookContext<S>) => number);
  /** How the LLM should choose tools. */
  toolChoice?: ToolChoice;
  /** Built-in tools to enable (e.g. `"web_search"`, `"run_code"`). */
  builtinTools?: readonly BuiltinTool[];
  /** Custom tools the agent can invoke. */
  // deno-lint-ignore no-explicit-any
  tools?: Readonly<Record<string, ToolDef<any, NoInfer<S>>>>;
  /** Factory that creates fresh per-session state. Called once per connection. */
  state?: () => S;
  /** Called when a new session connects. */
  onConnect?: (ctx: HookContext<S>) => void | Promise<void>;
  /** Called when a session disconnects. */
  onDisconnect?: (ctx: HookContext<S>) => void | Promise<void>;
  /** Called when an unhandled error occurs. */
  onError?: (error: Error, ctx?: HookContext<S>) => void;
  /** Called after a complete turn (all steps finished). */
  onTurn?: (text: string, ctx: HookContext<S>) => void | Promise<void>;
  /** Called after each agentic step completes. */
  onStep?: (step: StepInfo, ctx: HookContext<S>) => void | Promise<void>;
  /**
   * Called before each step; can restrict which tools are active.
   *
   * Return `{ activeTools: [...] }` to limit available tools for the
   * upcoming step, or `void` to keep all tools active.
   */
  onBeforeStep?: (
    stepNumber: number,
    ctx: HookContext<S>,
  ) => BeforeStepResult | Promise<BeforeStepResult>;
};

/**
 * Default system prompt used when `instructions` is not provided.
 *
 * Optimized for voice-first interactions: short sentences, no visual
 * formatting, confident tone, and concise answers.
 */
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

/** Default greeting spoken when a session starts. */
export const DEFAULT_GREETING: string =
  "Hey there. I'm a voice assistant. What can I help you with?";

const EMPTY_PARAMS = z.object({});

/**
 * Convert agent tool definitions to JSON Schema format for wire transport.
 *
 * Transforms the Zod-based `parameters` of each tool into a plain JSON Schema
 * object suitable for structured clone / JSON serialization.
 *
 * @param tools A record of tool name to {@linkcode ToolDef} mappings.
 * @returns An array of {@linkcode ToolSchema} objects ready for wire transport.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { agentToolsToSchemas, type ToolDef } from "@aai/sdk/types";
 *
 * const tools: Record<string, ToolDef> = {
 *   greet: {
 *     description: "Greet someone",
 *     parameters: z.object({ name: z.string() }),
 *     execute: ({ name }) => `Hi ${name}`,
 *   },
 * };
 *
 * const schemas = agentToolsToSchemas(tools);
 * // [{ name: "greet", description: "Greet someone", parameters: { ... } }]
 * ```
 */
export function agentToolsToSchemas(
  tools: Readonly<Record<string, ToolDef>>,
): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: z.toJSONSchema(
      def.parameters ?? EMPTY_PARAMS,
    ) as JSONSchema7,
  }));
}

/**
 * Agent definition with all defaults applied, returned by
 * {@linkcode defineAgent}.
 *
 * Unlike {@linkcode AgentOptions}, every field here is resolved to its
 * final value — no optional fields with implicit defaults remain.
 */
export type AgentDef = {
  name: string;
  mode: AgentMode;
  env: readonly string[];
  transport: readonly Transport[];
  instructions: string;
  greeting: string;
  voice: string;
  sttPrompt?: string;
  maxSteps: number | ((ctx: HookContext) => number);
  toolChoice?: ToolChoice;
  builtinTools?: readonly BuiltinTool[];
  tools: Readonly<Record<string, ToolDef>>;
  state?: () => unknown;
  onConnect?: AgentOptions["onConnect"];
  onDisconnect?: AgentOptions["onDisconnect"];
  onError?: AgentOptions["onError"];
  onTurn?: AgentOptions["onTurn"];
  onStep?: AgentOptions["onStep"];
  onBeforeStep?: AgentOptions["onBeforeStep"];
};
