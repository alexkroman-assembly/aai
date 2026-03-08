import { z } from "zod";
import type {
  AgentDef,
  HookContext,
  ToolContext,
  ToolDef,
} from "../sdk/types.ts";
import {
  createRpcCaller,
  type MessageTarget,
  type RpcHandlers,
  serveRpc,
} from "./_rpc.ts";

export const TOOL_HANDLER_TIMEOUT = 30_000;

export type ExecuteTool = (
  name: string,
  args: Record<string, unknown>,
  sessionId?: string,
) => Promise<string>;

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  tool: ToolDef,
  env: Record<string, string>,
  sessionId?: string,
): Promise<string> {
  const schema = tool.parameters ?? z.object({});
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issues = (parsed.error?.issues ?? [])
      .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join(", ");
    return `Error: Invalid arguments for tool "${name}": ${issues}`;
  }

  try {
    const signal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const ctx: ToolContext = {
      sessionId: sessionId ?? "",
      env: { ...env },
      signal,
    };
    const result = await Promise.resolve(
      tool.execute(parsed.data, ctx),
    );
    if (result == null) return "null";
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      console.warn(`[tool-executor] Tool execution timed out: ${name}`);
      return `Error: Tool "${name}" timed out after ${TOOL_HANDLER_TIMEOUT}ms`;
    }
    console.warn(`[tool-executor] Tool execution failed: ${name}`, err);
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export type WorkerApi = {
  executeTool(
    name: string,
    args: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<string>;
  invokeHook(
    hook: string,
    sessionId: string,
    extra?: { text?: string; error?: string },
    timeoutMs?: number,
  ): Promise<void>;
};

export function createWorkerApi(port: MessageTarget): WorkerApi {
  const call = createRpcCaller(port);
  return {
    async executeTool(name, args, sessionId, timeoutMs) {
      const raw = await call(
        "executeTool",
        { name, args, sessionId },
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async invokeHook(hook, sessionId, extra, timeoutMs) {
      await call("invokeHook", { hook, sessionId, ...extra }, timeoutMs);
    },
  };
}

export function startWorker(
  agent: AgentDef,
  env: Record<string, string>,
  endpoint?: MessageTarget,
): void {
  const toolHandlers = new Map(Object.entries(agent.tools));

  const port: MessageTarget = endpoint ?? self as unknown as MessageTarget;

  const handlers: RpcHandlers = {
    executeTool(req) {
      const tool = toolHandlers.get(req.name);
      if (!tool) return `Error: Unknown tool "${req.name}"`;
      return executeToolCall(
        req.name,
        req.args,
        tool,
        env,
        undefined,
      );
    },

    async invokeHook(req) {
      const ctx: HookContext = {
        sessionId: req.sessionId,
        env: { ...env },
      };
      if (req.hook === "onConnect") {
        await agent.onConnect?.(ctx);
      } else if (req.hook === "onDisconnect") {
        await agent.onDisconnect?.(ctx);
      } else if (req.hook === "onTurn" && req.text !== undefined) {
        await agent.onTurn?.(req.text, ctx);
      } else if (req.hook === "onError" && req.error !== undefined) {
        agent.onError?.(new Error(req.error), ctx);
      }
    },
  };

  serveRpc(port, handlers);
}
