// Copyright 2025 the AAI authors. MIT license.
/**
 * Host-side worker API — communicates with sandboxed agent workers via
 * Cap'n Web RPC over postMessage.
 *
 * @module
 */

import type { Message } from "@aai/sdk/types";
import type { KvRequest } from "@aai/sdk/protocol";
import { withTimeout } from "@aai/sdk/timeout";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";
import { asMessagePort } from "@aai/sdk/capnweb-transport";

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
 * Cap'n Web RPC target that exposes host-side APIs (fetch, kv) to the worker.
 *
 * An instance of this class is passed as the second argument to
 * `newMessagePortRpcSession`, making it available to the worker at session creation.
 */
class HostApiTarget extends RpcTarget {
  #api: HostApi;

  constructor(api: HostApi) {
    super();
    this.#api = api;
  }

  fetch(req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  }): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }> {
    return this.#api.fetch(req);
  }

  kv(req: KvRequest): Promise<{ result: unknown }> {
    return this.#api.kv(req);
  }
}

/**
 * High-level API for communicating with a sandboxed agent worker.
 *
 * This is the host-side interface returned by {@linkcode createWorkerApi}.
 * All methods support optional RPC timeouts. Environment variables are
 * set once at creation via the `withEnv` capability — no per-call env.
 */
export type WorkerApi = {
  getConfig(): Promise<import("@aai/sdk/types").WorkerConfig>;
  executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    sessionId?: string,
    timeoutMs?: number,
    messages?: readonly Message[],
  ): Promise<string>;
  onConnect(sessionId: string, timeoutMs?: number): Promise<void>;
  onDisconnect(sessionId: string, timeoutMs?: number): Promise<void>;
  onTurn(
    sessionId: string,
    text: string,
    timeoutMs?: number,
  ): Promise<void>;
  onError(
    sessionId: string,
    error: string,
    timeoutMs?: number,
  ): Promise<void>;
  onStep(
    sessionId: string,
    step: StepInfoRpc,
    timeoutMs?: number,
  ): Promise<void>;
  resolveTurnConfig(
    sessionId: string,
    timeoutMs?: number,
  ): Promise<TurnConfig | null>;
  dispose?: () => void;
};

/** Combined turn configuration resolved from the worker before a turn starts. */
export type TurnConfig = {
  maxSteps?: number;
  activeTools?: string[];
};

/**
 * Type representing the worker-side RPC target interface.
 * This matches the methods exposed by AgentWorkerTarget in the worker.
 */
interface WorkerRpcApi {
  withEnv(env: Record<string, string>): WorkerRpcApi;
  getConfig(): Promise<import("@aai/sdk/types").WorkerConfig>;
  executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    sessionId: string | undefined,
    messages: readonly Message[] | undefined,
  ): Promise<string>;
  onConnect(sessionId: string): Promise<void>;
  onDisconnect(sessionId: string): Promise<void>;
  onTurn(sessionId: string, text: string): Promise<void>;
  onError(sessionId: string, error: string): void;
  onStep(sessionId: string, step: StepInfoRpc): Promise<void>;
  resolveTurnConfig(sessionId: string): Promise<TurnConfig | null>;
}

/**
 * Create a {@linkcode WorkerApi} backed by Cap'n Web RPC over a Worker.
 *
 * Both sides exchange targets at session creation: the host passes its
 * {@linkcode HostApiTarget} and receives a stub for the worker's
 * {@linkcode AgentWorkerTarget}. No separate init handshake is needed.
 *
 * If `env` is provided, the host calls `withEnv(env)` once to obtain
 * a scoped capability with env baked in. All subsequent calls are
 * pipelined through this scoped stub — no per-call env parameter.
 *
 * @param worker - The Worker (or any object with `postMessage` and event listeners).
 * @param hostApi - Optional host-side API to expose to the worker for fetch/kv proxy.
 * @param env - Optional environment variables to set once on the worker.
 * @returns A {@linkcode WorkerApi} instance with timeout-wrapped RPC methods.
 */
export function createWorkerApi(
  worker: {
    postMessage(msg: unknown): void;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  },
  hostApi?: HostApi,
  env?: Record<string, string>,
): WorkerApi {
  const port = asMessagePort(worker);
  const hostTarget = hostApi ? new HostApiTarget(hostApi) : undefined;
  const stub = newMessagePortRpcSession<WorkerRpcApi>(port, hostTarget);

  // Set env once via capability pattern — returns a scoped stub.
  // Both withEnv and getConfig are issued in the same microtask,
  // so capnweb batches them in a single postMessage round trip.
  const scoped = env
    ? stub.withEnv(env) as unknown as import("capnweb").RpcStub<WorkerRpcApi>
    : stub;

  // Eagerly start getConfig — pipelined with withEnv in the same batch.
  const configPromise = withTimeout(
    stub.getConfig() as Promise<import("@aai/sdk/types").WorkerConfig>,
    5_000,
  );

  return {
    async getConfig() {
      return await configPromise;
    },
    async executeTool(name, args, sessionId, timeoutMs, messages) {
      const raw = await withTimeout(
        scoped.executeTool(name, args, sessionId, messages) as Promise<string>,
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async onConnect(sessionId, timeoutMs) {
      await withTimeout(
        scoped.onConnect(sessionId) as Promise<void>,
        timeoutMs,
      );
    },
    async onDisconnect(sessionId, timeoutMs) {
      await withTimeout(
        scoped.onDisconnect(sessionId) as Promise<void>,
        timeoutMs,
      );
    },
    async onTurn(sessionId, text, timeoutMs) {
      await withTimeout(
        scoped.onTurn(sessionId, text) as Promise<void>,
        timeoutMs,
      );
    },
    async onError(sessionId, error, timeoutMs) {
      await withTimeout(
        scoped.onError(sessionId, error) as Promise<void>,
        timeoutMs,
      );
    },
    async onStep(sessionId, step, timeoutMs) {
      await withTimeout(
        scoped.onStep(sessionId, step) as Promise<void>,
        timeoutMs,
      );
    },
    async resolveTurnConfig(sessionId, timeoutMs) {
      return await withTimeout(
        scoped.resolveTurnConfig(sessionId) as Promise<TurnConfig | null>,
        timeoutMs ?? 5_000,
      );
    },
    dispose() {
      stub[Symbol.dispose]();
    },
  };
}
