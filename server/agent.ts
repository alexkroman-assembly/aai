import {
  type AgentOptions,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
  type ToolDef,
} from "./agent_types.ts";

export interface AgentDef {
  readonly name: string;
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly prompt?: string;
  readonly builtinTools?: readonly string[];
  readonly muteOnReply?: boolean;
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly onConnect?: AgentOptions["onConnect"];
  readonly onDisconnect?: AgentOptions["onDisconnect"];
  readonly onError?: AgentOptions["onError"];
  readonly onTurn?: AgentOptions["onTurn"];
}

/**
 * Create a voice agent definition with sensible defaults.
 *
 * @example
 * ```ts
 * export default defineAgent({
 *   name: "Scout",
 *   voice: "tara",
 *   instructions: "...",
 * });
 * ```
 */
export function defineAgent(options: AgentOptions): AgentDef {
  return Object.freeze({
    name: options.name,
    instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
    greeting: options.greeting ?? DEFAULT_GREETING,
    voice: options.voice ?? "jess",
    prompt: options.prompt,
    builtinTools: options.builtinTools,
    muteOnReply: options.muteOnReply,
    tools: options.tools ?? {},
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    onError: options.onError,
    onTurn: options.onTurn,
  });
}
