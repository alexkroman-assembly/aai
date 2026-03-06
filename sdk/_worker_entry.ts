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
import { type MessageTarget, serveRpc } from "./_rpc.ts";

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

  const port: MessageTarget = endpoint ?? self as unknown as MessageTarget;

  serveRpc(port, {
    getConfig: () => ({ config, toolSchemas }),

    executeTool: ({ name, args }: Record<string, unknown>) => {
      const tool = toolHandlers.get(name as string);
      if (!tool) return `Error: Unknown tool "${name}"`;
      return executeToolCall(
        name as string,
        args as Record<string, unknown>,
        tool,
        secrets,
      );
    },

    invokeHook: async ({
      hook,
      sessionId,
      text,
      error,
    }: Record<string, unknown>) => {
      const ctx: HookContext = {
        sessionId: sessionId as string,
        secrets: { ...secrets },
      };
      if (hook === "onConnect") {
        await agent.onConnect?.(ctx);
      } else if (hook === "onDisconnect") {
        await agent.onDisconnect?.(ctx);
      } else if (hook === "onTurn" && text !== undefined) {
        await agent.onTurn?.(text as string, ctx);
      } else if (hook === "onError" && error !== undefined) {
        agent.onError?.(new Error(error as string), ctx);
      }
    },
  });
}
