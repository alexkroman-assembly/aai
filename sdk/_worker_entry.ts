import {
  type AgentConfig,
  type AgentOptions,
  agentToolsToSchemas,
  type BuiltinTool,
  type HookContext,
  type ToolDef,
  type ToolSchema,
} from "./types.ts";
import { executeToolCall } from "./_tool_executor.ts";
import { type RpcRequest, RpcRequestSchema } from "./_rpc_schema.ts";

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
  readonly builtinTools?: readonly BuiltinTool[];
  readonly tools: Readonly<Record<string, ToolDef>>;
  readonly onConnect?: AgentOptions["onConnect"];
  readonly onDisconnect?: AgentOptions["onDisconnect"];
  readonly onError?: AgentOptions["onError"];
  readonly onTurn?: AgentOptions["onTurn"];
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
  invokeHook(
    hook: string,
    sessionId: string,
    extra?: { text?: string; error?: string },
    timeoutMs?: number,
  ): Promise<void>;
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

    async invokeHook(
      hook: string,
      sessionId: string,
      extra?: { text?: string; error?: string },
    ): Promise<void> {
      const ctx: HookContext = { sessionId, secrets: { ...secrets } };
      if (hook === "onConnect") {
        await agent.onConnect?.(ctx);
      } else if (hook === "onDisconnect") {
        await agent.onDisconnect?.(ctx);
      } else if (hook === "onTurn" && extra?.text !== undefined) {
        await agent.onTurn?.(extra.text, ctx);
      } else if (hook === "onError" && extra?.error !== undefined) {
        agent.onError?.(new Error(extra.error), ctx);
      }
    },
  };

  const port: MessageTarget = endpoint ?? self as unknown as MessageTarget;

  port.onmessage = async (e: MessageEvent) => {
    const parsed = RpcRequestSchema.safeParse(e.data);
    if (!parsed.success) {
      console.warn("[worker] Invalid RPC message:", parsed.error.message);
      return;
    }
    const msg: RpcRequest = parsed.data;
    try {
      let result: unknown;
      if (msg.type === "getConfig") {
        result = await api.getConfig();
      } else if (msg.type === "executeTool") {
        result = await api.executeTool(msg.name, msg.args);
      } else if (msg.type === "invokeHook") {
        await api.invokeHook(msg.hook, msg.sessionId, {
          text: msg.text,
          error: msg.error,
        });
        result = undefined;
      } else {
        const _exhaustive: never = msg;
        throw new Error(
          `Unknown message type: ${(_exhaustive as RpcRequest).type}`,
        );
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
