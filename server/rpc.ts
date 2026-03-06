import type { AgentConfig, ToolSchema } from "./types.ts";
import type { WorkerApi } from "../sdk/_worker_entry.ts";
import { GetConfigResponseSchema } from "../sdk/_rpc_schema.ts";
import { createRpcCaller } from "../sdk/_rpc.ts";

export { createRpcCaller as createRpcCall };

export function createWorkerRpc(port: Worker | MessagePort): WorkerApi {
  const call = createRpcCaller(port);
  return {
    getConfig: async (
      timeoutMs?: number,
    ): Promise<{ config: AgentConfig; toolSchemas: ToolSchema[] }> => {
      const raw = await call("getConfig", undefined, timeoutMs);
      return GetConfigResponseSchema.parse(raw) as {
        config: AgentConfig;
        toolSchemas: ToolSchema[];
      };
    },
    executeTool: async (
      name: string,
      args: Record<string, unknown>,
      timeoutMs?: number,
    ): Promise<string> => {
      const raw = await call("executeTool", { name, args }, timeoutMs);
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    invokeHook: async (
      hook: string,
      sessionId: string,
      extra?: { text?: string; error?: string },
      timeoutMs?: number,
    ): Promise<void> => {
      await call("invokeHook", { hook, sessionId, ...extra }, timeoutMs);
    },
  };
}

export interface SandboxApi {
  execute(
    code: string,
    timeoutMs?: number,
  ): Promise<{ output: string; error?: string }>;
}

export function createSandboxRpc(port: Worker | MessagePort): SandboxApi {
  const call = createRpcCaller(port);
  return {
    execute: (code, timeoutMs?) =>
      call("execute", { code }, timeoutMs) as Promise<
        { output: string; error?: string }
      >,
  };
}
