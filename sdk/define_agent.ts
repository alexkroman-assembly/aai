import { normalizeTransport } from "./_schema.ts";
import {
  type AgentDef,
  type AgentOptions,
  DEFAULT_GREETING,
  DEFAULT_INSTRUCTIONS,
} from "./types.ts";

export function defineAgent(options: AgentOptions): AgentDef {
  const isSttOnly = options.mode === "stt-only";
  return Object.freeze({
    name: options.name,
    mode: options.mode ?? "full",
    env: Object.freeze(options.env ?? ["ASSEMBLYAI_API_KEY"]),
    transport: Object.freeze(normalizeTransport(options.transport)),
    instructions: isSttOnly
      ? (options.instructions ?? "")
      : (options.instructions ?? DEFAULT_INSTRUCTIONS),
    greeting: isSttOnly
      ? (options.greeting ?? "")
      : (options.greeting ?? DEFAULT_GREETING),
    voice: isSttOnly ? (options.voice ?? "") : (options.voice ?? "luna"),
    sttPrompt: options.sttPrompt,
    maxSteps: options.maxSteps ?? 5,
    toolChoice: options.toolChoice,
    builtinTools: options.builtinTools,
    tools: options.tools ?? {},
    state: options.state,
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
    onError: options.onError,
    onTurn: options.onTurn,
    onStep: options.onStep,
    onBeforeStep: options.onBeforeStep,
  });
}
