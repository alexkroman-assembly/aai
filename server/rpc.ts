import type { AgentConfig, ToolSchema } from "./types.ts";
import type { WorkerApi } from "../sdk/_worker_entry.ts";
import {
  GetConfigResponseSchema,
  RpcResponseSchema,
} from "../sdk/_rpc_schema.ts";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

type RpcCall = (
  type: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

export function createRpcCall(port: Worker | MessagePort): RpcCall {
  let nextId = 0;
  const pending = new Map<number, PendingCall>();

  function settle(id: number, fn: (p: PendingCall) => void) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    fn(p);
  }

  port.onmessage = (e: MessageEvent) => {
    const parsed = RpcResponseSchema.safeParse(e.data);
    if (!parsed.success) return;
    const msg = parsed.data;
    settle(msg.id, (p) => {
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    });
  };

  return (
    type: string,
    payload?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> => {
    const id = nextId++;
    port.postMessage({ id, type, ...payload });
    return new Promise((resolve, reject) => {
      const entry: PendingCall = { resolve, reject };
      pending.set(id, entry);
      if (timeoutMs) {
        entry.timer = setTimeout(
          () =>
            settle(id, (p) =>
              p.reject(
                new Error(`RPC "${type}" timed out after ${timeoutMs}ms`),
              )),
          timeoutMs,
        );
      }
    });
  };
}

export function createWorkerRpc(port: Worker | MessagePort): WorkerApi {
  const call = createRpcCall(port);
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
  };
}

export interface SandboxApi {
  execute(
    code: string,
    timeoutMs?: number,
  ): Promise<{ output: string; error?: string }>;
}

export function createSandboxRpc(port: Worker | MessagePort): SandboxApi {
  const call = createRpcCall(port);
  return {
    execute: (code, timeoutMs?) =>
      call("execute", { code }, timeoutMs) as Promise<
        { output: string; error?: string }
      >,
  };
}
