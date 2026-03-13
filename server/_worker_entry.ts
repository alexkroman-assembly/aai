// Copyright 2025 the AAI authors. MIT license.
/**
 * Host-side worker API — communicates with sandboxed agent workers via
 * postMessage RPC.
 *
 * @module
 */

import type { Message } from "@aai/sdk/types";
import type { KvRequest } from "@aai/sdk/protocol";
import { withTimeout } from "@aai/sdk/timeout";
import {
  createRpcClient,
  createRpcServer,
  isRpcMessage,
  type RpcHandlers,
} from "@aai/sdk/rpc";

export {
  type ExecuteTool,
  executeToolCall,
  TOOL_HANDLER_TIMEOUT,
} from "@aai/sdk/worker-entry";

/**
 * Step info payload for RPC transport between host and worker.
 *
 * Represents one iteration of the agentic loop, including which tools were
 * called and any text the LLM produced.
 */
export type StepInfoRpc = {
  /** The 1-based step number within the current turn. */
  stepNumber: number;
  /** Tools invoked during this step, with their arguments. */
  toolCalls: readonly {
    toolName: string;
    args: Readonly<Record<string, unknown>>;
  }[];
  /** The LLM's text output for this step. */
  text: string;
};

export type { KvRequest } from "@aai/sdk/protocol";

/**
 * API shape the host process exposes to the sandboxed worker.
 *
 * Since workers run with all permissions denied, they use this interface
 * to proxy network requests and KV operations back to the host.
 */
export type HostApi = {
  fetch(req: {
    url: string;
    method: string;
    headers: Readonly<Record<string, string>>;
    body: string | null;
  }): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }>;
  kv(req: KvRequest): Promise<{ result: unknown }>;
};

/**
 * High-level API for communicating with a sandboxed agent worker.
 *
 * This is the host-side interface returned by {@linkcode createWorkerApi}.
 * All methods support optional RPC timeouts.
 */
export type WorkerApi = {
  getConfig(): Promise<import("@aai/sdk/types").WorkerConfig>;
  executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    sessionId?: string,
    timeoutMs?: number,
    env?: Record<string, string>,
    messages?: readonly Message[],
  ): Promise<string>;
  onConnect(
    sessionId: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;
  onDisconnect(
    sessionId: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;
  onTurn(
    sessionId: string,
    text: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;
  onError(
    sessionId: string,
    error: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;
  onStep(
    sessionId: string,
    step: StepInfoRpc,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;
  resolveMaxSteps(
    sessionId: string,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<number | null>;
  resolveBeforeStep(
    sessionId: string,
    stepNumber: number,
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<{ activeTools?: string[] } | null>;
  dispose?: () => void;
};

/**
 * Create a {@linkcode WorkerApi} backed by postMessage RPC over a Worker.
 *
 * @param worker - The Worker (or any object with `postMessage` and `onmessage`).
 * @param hostApi - Optional host-side API to expose to the worker for fetch/kv proxy.
 * @returns A {@linkcode WorkerApi} instance with timeout-wrapped RPC methods.
 */
export function createWorkerApi(
  worker: {
    postMessage(msg: unknown): void;
    onmessage: ((e: MessageEvent) => void) | null;
  },
  hostApi?: HostApi,
): WorkerApi {
  const rpcClient = createRpcClient((msg) => worker.postMessage(msg));

  // Set up RPC server for worker → host calls (fetch, kv)
  const hostHandlers: RpcHandlers = {};
  if (hostApi) {
    hostHandlers.fetch = (req: unknown) =>
      hostApi.fetch(
        req as {
          url: string;
          method: string;
          headers: Readonly<Record<string, string>>;
          body: string | null;
        },
      );
    hostHandlers.kv = (req: unknown) => hostApi.kv(req as KvRequest);
  }
  const rpcServer = createRpcServer(
    hostHandlers,
    (msg) => worker.postMessage(msg),
  );

  // Route incoming messages
  worker.onmessage = (e: MessageEvent) => {
    const data = e.data;
    if (!isRpcMessage(data)) return;
    if (data.type === "rpc-response") {
      rpcClient.handleResponse(data);
    } else {
      rpcServer.handleRequest(data);
    }
  };

  function sendEnv(env?: Record<string, string>): void {
    if (env) {
      // Fire-and-forget — setEnv doesn't return a value
      rpcClient.call("setEnv", env);
    }
  }

  return {
    async getConfig() {
      return await withTimeout(
        rpcClient.call("getConfig") as Promise<
          import("@aai/sdk/types").WorkerConfig
        >,
        5_000,
      );
    },
    async executeTool(name, args, sessionId, timeoutMs, env, messages) {
      sendEnv(env);
      const raw = await withTimeout(
        rpcClient.call(
          "executeTool",
          name,
          args,
          sessionId,
          messages,
        ) as Promise<string>,
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async onConnect(sessionId, timeoutMs, env) {
      sendEnv(env);
      await withTimeout(
        rpcClient.call("onConnect", sessionId) as Promise<void>,
        timeoutMs,
      );
    },
    async onDisconnect(sessionId, timeoutMs, env) {
      sendEnv(env);
      await withTimeout(
        rpcClient.call("onDisconnect", sessionId) as Promise<void>,
        timeoutMs,
      );
    },
    async onTurn(sessionId, text, timeoutMs, env) {
      sendEnv(env);
      await withTimeout(
        rpcClient.call("onTurn", sessionId, text) as Promise<void>,
        timeoutMs,
      );
    },
    async onError(sessionId, error, timeoutMs, env) {
      sendEnv(env);
      await withTimeout(
        rpcClient.call("onError", sessionId, error) as Promise<void>,
        timeoutMs,
      );
    },
    async onStep(sessionId, step, timeoutMs, env) {
      sendEnv(env);
      await withTimeout(
        rpcClient.call("onStep", sessionId, step) as Promise<void>,
        timeoutMs,
      );
    },
    async resolveMaxSteps(sessionId, timeoutMs, env) {
      sendEnv(env);
      return await withTimeout(
        rpcClient.call("resolveMaxSteps", sessionId) as Promise<number | null>,
        timeoutMs ?? 5_000,
      );
    },
    async resolveBeforeStep(sessionId, stepNumber, timeoutMs, env) {
      sendEnv(env);
      return await withTimeout(
        rpcClient.call("resolveBeforeStep", sessionId, stepNumber) as Promise<
          { activeTools?: string[] } | null
        >,
        timeoutMs ?? 5_000,
      );
    },
    dispose() {
      worker.onmessage = null;
    },
  };
}
