// Copyright 2025 the AAI authors. MIT license.
/**
 * Worker-side agent wiring over Cap'n Web RPC.
 *
 * Called inside a bundled Deno Worker to wire up the agent's tools, hooks,
 * and configuration using capnweb's object-capability RPC system.
 *
 * @module
 */

import { z } from "zod";
import type {
  AgentConfig,
  AgentDef,
  HookContext,
  Message,
  ToolSchema,
  WorkerConfig,
} from "./types.ts";
import type { Kv, KvEntry } from "./kv.ts";
import type { KvRequest } from "./protocol.ts";
import { executeToolCall } from "./worker_entry.ts";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";
import { asMessagePort } from "./_capnweb_transport.ts";
import { withTimeout } from "./_timeout.ts";

const FETCH_TIMEOUT_MS = 30_000;
const KV_TIMEOUT_MS = 10_000;
const EMPTY_PARAMS = z.object({});

/**
 * Type for the host API exposed to the worker via capnweb RPC.
 *
 * The host passes its {@linkcode RpcTarget} when creating the RPC session,
 * and the worker receives a stub for this interface as the return value.
 */
interface HostApiRpc {
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
  }>;
  kv(req: KvRequest): Promise<{ result: unknown }>;
}

function headersToRecord(h?: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(h).entries());
}

async function serializeBody(body: BodyInit | null): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (body instanceof Blob) return await body.text();
  if (body instanceof ReadableStream) return await new Response(body).text();
  if (body instanceof FormData) {
    return new URLSearchParams(body as unknown as Record<string, string>)
      .toString();
  }
  return String(body);
}

function createProxyKv(hostStub: HostApiRpc): Kv {
  async function kvCall(req: KvRequest): Promise<unknown> {
    const resp = await withTimeout(
      hostStub.kv(req),
      KV_TIMEOUT_MS,
    );
    return (resp as { result: unknown }).result;
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const result = await kvCall({ op: "get", key });
      if (result === null || result === undefined) return null;
      return (typeof result === "string" ? JSON.parse(result) : result) as T;
    },
    async set(
      key: string,
      value: unknown,
      options?: { expireIn?: number },
    ): Promise<void> {
      const raw = JSON.stringify(value);
      await kvCall({
        op: "set",
        key,
        value: raw,
        ...(options?.expireIn
          ? { ttl: Math.ceil(options.expireIn / 1000) }
          : {}),
      });
    },
    async delete(key: string): Promise<void> {
      await kvCall({ op: "del", key });
    },
    async list<T = unknown>(
      prefix: string,
      options?: { limit?: number; reverse?: boolean },
    ): Promise<KvEntry<T>[]> {
      const listReq: KvRequest = {
        op: "list" as const,
        prefix,
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.reverse !== undefined ? { reverse: options.reverse } : {}),
      };
      const result = await kvCall(listReq);
      return result as KvEntry<T>[];
    },
  };
}

function installFetchProxy(hostStub: HostApiRpc): void {
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    let url: string;
    let method: string;
    let headers: Record<string, string>;
    let body: string | null;

    if (input instanceof Request) {
      url = input.url;
      method = init?.method ?? input.method;
      headers = headersToRecord(init?.headers ?? input.headers);
      body = init?.body != null
        ? await serializeBody(init.body)
        : input.body != null
        ? await input.text()
        : null;
    } else {
      url = String(input);
      method = init?.method ?? "GET";
      headers = headersToRecord(init?.headers);
      body = init?.body != null ? await serializeBody(init.body) : null;
    }

    const result = await withTimeout(
      hostStub.fetch({ url, method, headers, body }),
      FETCH_TIMEOUT_MS,
    );

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };
}

/**
 * Cap'n Web RPC target exposed by the worker to the host.
 *
 * The host receives a stub for this class and can call its methods
 * to interact with the agent (get config, execute tools, trigger hooks).
 */
class AgentWorkerTarget extends RpcTarget {
  #agent: AgentDef;
  #toolHandlers: Map<string, AgentDef["tools"][string]>;
  #sessions = new Map<string, unknown>();
  #mergedEnv: Record<string, string> = {};
  #proxyKv: Kv | null = null;

  constructor(agent: AgentDef) {
    super();
    this.#agent = agent;
    this.#toolHandlers = new Map(Object.entries(agent.tools));
  }

  /** Install the fetch and KV proxies backed by the host stub. */
  setHostApi(hostStub: HostApiRpc): void {
    this.#proxyKv = createProxyKv(hostStub);
    installFetchProxy(hostStub);
  }

  setEnv(env: Record<string, string>): void {
    this.#mergedEnv = { ...this.#mergedEnv, ...env };
  }

  getConfig(): WorkerConfig {
    const toolSchemas: ToolSchema[] = Object.entries(this.#agent.tools).map(
      ([name, def]) => ({
        name,
        description: def.description,
        parameters: z.toJSONSchema(
          def.parameters ?? EMPTY_PARAMS,
        ) as ToolSchema["parameters"],
      }),
    );
    const config: AgentConfig = {
      name: this.#agent.name,
      mode: this.#agent.mode,
      instructions: this.#agent.instructions,
      greeting: this.#agent.greeting,
      voice: this.#agent.voice,
    };
    if (this.#agent.sttPrompt !== undefined) {
      config.sttPrompt = this.#agent.sttPrompt;
    }
    if (typeof this.#agent.maxSteps !== "function") {
      config.maxSteps = this.#agent.maxSteps;
    }
    if (this.#agent.toolChoice !== undefined) {
      config.toolChoice = this.#agent.toolChoice;
    }
    if (this.#agent.builtinTools) {
      config.builtinTools = [...this.#agent.builtinTools];
    }
    return { config, toolSchemas };
  }

  async executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    sessionId: string | undefined,
    messages: readonly Message[] | undefined,
  ): Promise<string> {
    const tool = this.#toolHandlers.get(name);
    if (!tool) return `Error: Unknown tool "${name}"`;
    return await executeToolCall(name, args, {
      tool,
      env: this.#mergedEnv,
      sessionId,
      state: this.#getState(sessionId ?? ""),
      kv: this.#proxyKv!,
      messages,
    });
  }

  async onConnect(sessionId: string): Promise<void> {
    await this.#agent.onConnect?.(this.#makeCtx(sessionId));
  }

  async onDisconnect(sessionId: string): Promise<void> {
    await this.#agent.onDisconnect?.(this.#makeCtx(sessionId));
    this.#sessions.delete(sessionId);
  }

  async onTurn(sessionId: string, text: string): Promise<void> {
    await this.#agent.onTurn?.(text, this.#makeCtx(sessionId));
  }

  onError(sessionId: string, error: string): void {
    this.#agent.onError?.(new Error(error), this.#makeCtx(sessionId));
  }

  async onStep(
    sessionId: string,
    step: Parameters<NonNullable<AgentDef["onStep"]>>[0],
  ): Promise<void> {
    await this.#agent.onStep?.(step, this.#makeCtx(sessionId));
  }

  async resolveMaxSteps(sessionId: string): Promise<number | null> {
    if (typeof this.#agent.maxSteps !== "function") return null;
    return this.#agent.maxSteps(this.#makeCtx(sessionId));
  }

  async resolveBeforeStep(
    sessionId: string,
    stepNumber: number,
  ): Promise<{ activeTools?: string[] } | null> {
    if (!this.#agent.onBeforeStep) return null;
    const result = await this.#agent.onBeforeStep(
      stepNumber,
      this.#makeCtx(sessionId),
    );
    return result ?? null;
  }

  #getState(sessionId: string): unknown {
    if (!this.#sessions.has(sessionId) && this.#agent.state) {
      this.#sessions.set(sessionId, this.#agent.state());
    }
    return this.#sessions.get(sessionId) ?? {};
  }

  #makeCtx(sessionId: string): HookContext {
    const proxyKv = this.#proxyKv;
    return {
      sessionId,
      env: { ...this.#mergedEnv },
      state: this.#getState(sessionId) as Record<string, unknown>,
      get kv() {
        if (!proxyKv) throw new Error("KV not available");
        return proxyKv;
      },
    };
  }
}

/**
 * Initialize the worker-side Cap'n Web RPC endpoint for an agent.
 *
 * Both sides exchange targets at session creation: the worker passes its
 * {@linkcode AgentWorkerTarget} and receives a stub for the host's API.
 * No separate init handshake is needed.
 *
 * @param agent - The agent definition returned by `defineAgent()`.
 */
export function initWorker(agent: AgentDef): void {
  const selfRef = self;
  const workerTarget = new AgentWorkerTarget(agent);

  // Both sides pass their target — worker gets host stub, host gets worker stub
  const hostStub = newMessagePortRpcSession<HostApiRpc>(
    asMessagePort(selfRef),
    workerTarget,
  );
  workerTarget.setHostApi(hostStub);
}
