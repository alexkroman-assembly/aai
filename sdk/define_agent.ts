import {
  type AgentDef,
  type AgentOptions,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
} from "./types.ts";

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
    voice: options.voice ?? "luna",
    prompt: options.prompt,
    builtinTools: options.builtinTools,
    tools: options.tools ?? {},
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    onError: options.onError,
    onTurn: options.onTurn,
  });
}
