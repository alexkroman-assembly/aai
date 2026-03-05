import {
  agentToolsToSchemas,
  type ToolDef,
  type ToolSchema,
} from "./agent_types.ts";
import { executeToolCall } from "./tool_executor.ts";
import type { AgentConfig } from "./types.ts";

interface MessageTarget {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

interface AgentLike {
  readonly name: string;
  readonly instructions: string;
  readonly greeting: string;
  readonly voice: string;
  readonly prompt?: string;
  readonly builtinTools?: readonly string[];
  readonly muteOnReply?: boolean;
  readonly tools: Readonly<Record<string, ToolDef>>;
}

export interface WorkerApi {
  getConfig(
    timeoutMs?: number,
  ): Promise<{ config: AgentConfig; toolSchemas: ToolSchema[] }>;
  executeTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<string>;
}

export function startWorker(
  agent: AgentLike,
  secrets: Record<string, string>,
  precomputedSchemas?: ToolSchema[],
  endpoint?: MessageTarget,
): void {
  const toolHandlers = new Map(Object.entries(agent.tools));
  const toolSchemas = precomputedSchemas ?? agentToolsToSchemas(agent.tools);

  const config: AgentConfig = {
    name: agent.name,
    instructions: agent.instructions,
    greeting: agent.greeting,
    voice: agent.voice,
    prompt: agent.prompt,
    builtinTools: agent.builtinTools ? [...agent.builtinTools] : undefined,
    muteOnReply: agent.muteOnReply,
  };

  const api: WorkerApi = {
    getConfig() {
      return Promise.resolve({ config, toolSchemas });
    },

    executeTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<string> {
      const tool = toolHandlers.get(name);
      if (!tool) return Promise.resolve(`Error: Unknown tool "${name}"`);
      return executeToolCall(name, args, tool, secrets);
    },
  };

  const port: MessageTarget = endpoint ?? self as unknown as MessageTarget;

  port.onmessage = async (e: MessageEvent) => {
    const msg = e.data;
    try {
      let result: unknown;
      if (msg.type === "getConfig") {
        result = await api.getConfig();
      } else if (msg.type === "executeTool") {
        result = await api.executeTool(msg.name, msg.args);
      } else {
        throw new Error(`Unknown message type: ${msg.type}`);
      }
      port.postMessage({ id: msg.id, result });
    } catch (err: unknown) {
      port.postMessage({
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
