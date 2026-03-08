// Shared postMessage RPC helpers used by both worker and host sides.

import { deadline } from "@std/async/deadline";
import {
  type RpcRequest,
  RpcRequestSchema,
  RpcResponseSchema,
} from "./_rpc_schema.ts";

export type MessageTarget = {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};

export type RpcHandlers = {
  [K in RpcRequest["type"]]?: (
    params: Extract<RpcRequest, { type: K }>,
  ) => Promise<unknown> | unknown;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export function serveRpc(
  port: MessageTarget,
  methods: RpcHandlers,
): void {
  port.onmessage = async (e: MessageEvent) => {
    const parsed = RpcRequestSchema.safeParse(e.data);
    if (!parsed.success) {
      const id = (e.data as { id?: number }).id;
      if (typeof id === "number") {
        port.postMessage({ id, error: `Invalid RPC request` });
      }
      return;
    }
    const req = parsed.data;
    const fn = methods[req.type] as
      | ((params: RpcRequest) => Promise<unknown> | unknown)
      | undefined;
    if (!fn) {
      port.postMessage({
        id: req.id,
        error: `Unknown RPC method "${req.type}"`,
      });
      return;
    }
    try {
      const result = await fn(req);
      port.postMessage({ id: req.id, result });
    } catch (err: unknown) {
      port.postMessage({
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export function createWebSocketTarget(ws: WebSocket): MessageTarget {
  const target: MessageTarget = {
    onmessage: null,
    postMessage(message: unknown) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
  };

  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const data = JSON.parse(event.data);
      // Only forward RPC messages (have numeric id field)
      if (typeof data.id === "number") {
        target.onmessage?.({ data } as MessageEvent);
      }
    } catch { /* ignore non-JSON */ }
  });

  return target;
}

export type RpcCall = (
  type: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

export function createRpcCaller(port: MessageTarget): RpcCall {
  let nextId = 0;
  const pending = new Map<number, PendingCall>();

  function settle(id: number, fn: (p: PendingCall) => void) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
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
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    if (!timeoutMs) return promise;
    return deadline(promise, timeoutMs)
      .catch((err) => {
        throw err.name === "TimeoutError"
          ? new Error(`RPC "${type}" timed out after ${timeoutMs}ms`)
          : err;
      })
      .finally(() => pending.delete(id));
  };
}
