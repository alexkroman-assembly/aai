// Copyright 2025 the AAI authors. MIT license.
/**
 * Worker-side agent wiring over postMessage RPC.
 *
 * Called inside a bundled Deno Worker to wire up the agent's tools, hooks,
 * and configuration.
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
import {
  createRpcClient,
  createRpcServer,
  isRpcMessage,
  type RpcClient,
  type RpcHandlers,
} from "./_rpc.ts";
import { withTimeout } from "./_timeout.ts";

const FETCH_TIMEOUT_MS = 30_000;
const KV_TIMEOUT_MS = 10_000;
const EMPTY_PARAMS = z.object({});

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

function createProxyKv(rpcClient: RpcClient): Kv {
  async function kvCall(req: KvRequest): Promise<unknown> {
    const resp = await withTimeout(
      rpcClient.call("kv", req) as Promise<{ result: unknown }>,
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

function installFetchProxy(rpcClient: RpcClient): void {
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
      rpcClient.call("fetch", { url, method, headers, body }) as Promise<{
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
      }>,
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
 * Initialize the worker-side RPC endpoint for an agent.
 *
 * Sets up bidirectional postMessage RPC: the host can call agent methods
 * (getConfig, executeTool, hooks), and the worker can call host methods
 * (fetch, kv).
 *
 * @param agent - The agent definition returned by `defineAgent()`.
 */
export function initWorker(agent: AgentDef): void {
  const toolHandlers = new Map(Object.entries(agent.tools));
  const sessions = new Map<string, unknown>();
  let mergedEnv: Record<string, string> = {};

  // Set up RPC client for calling host (fetch, kv).
  // Capture postMessage at init time so it works in tests where self is swapped.
  const selfRef = self;
  const post = (msg: unknown) => selfRef.postMessage(msg);
  const rpcClient = createRpcClient(post);

  // Install fetch proxy and KV proxy via the RPC client
  const proxyKv = createProxyKv(rpcClient);
  installFetchProxy(rpcClient);

  function getState(sessionId: string): unknown {
    if (!sessions.has(sessionId) && agent.state) {
      sessions.set(sessionId, agent.state());
    }
    return sessions.get(sessionId) ?? {};
  }

  function makeCtx(sessionId: string): HookContext {
    return {
      sessionId,
      env: { ...mergedEnv },
      state: getState(sessionId) as Record<string, unknown>,
      get kv() {
        if (!proxyKv) throw new Error("KV not available");
        return proxyKv;
      },
    };
  }

  // RPC server handlers for host → worker calls
  const handlers: RpcHandlers = {
    setEnv(env: unknown): void {
      mergedEnv = { ...mergedEnv, ...(env as Record<string, string>) };
    },

    getConfig(): WorkerConfig {
      const toolSchemas: ToolSchema[] = Object.entries(agent.tools).map(
        ([name, def]) => ({
          name,
          description: def.description,
          parameters: z.toJSONSchema(
            def.parameters ?? EMPTY_PARAMS,
          ) as ToolSchema["parameters"],
        }),
      );
      const config: AgentConfig = {
        name: agent.name,
        mode: agent.mode,
        instructions: agent.instructions,
        greeting: agent.greeting,
        voice: agent.voice,
      };
      if (agent.sttPrompt !== undefined) config.sttPrompt = agent.sttPrompt;
      if (typeof agent.maxSteps !== "function") {
        config.maxSteps = agent.maxSteps;
      }
      if (agent.toolChoice !== undefined) config.toolChoice = agent.toolChoice;
      if (agent.builtinTools) config.builtinTools = [...agent.builtinTools];
      return { config, toolSchemas };
    },

    async executeTool(
      name: unknown,
      args: unknown,
      sessionId: unknown,
      messages: unknown,
    ): Promise<string> {
      const n = name as string;
      const a = args as Readonly<Record<string, unknown>>;
      const sid = sessionId as string | undefined;
      const tool = toolHandlers.get(n);
      if (!tool) return `Error: Unknown tool "${n}"`;
      return await executeToolCall(n, a, {
        tool,
        env: mergedEnv,
        sessionId: sid,
        state: getState(sid ?? ""),
        kv: proxyKv,
        messages: messages as readonly Message[] | undefined,
      });
    },

    async onConnect(sessionId: unknown): Promise<void> {
      await agent.onConnect?.(makeCtx(sessionId as string));
    },

    async onDisconnect(sessionId: unknown): Promise<void> {
      const sid = sessionId as string;
      await agent.onDisconnect?.(makeCtx(sid));
      sessions.delete(sid);
    },

    async onTurn(sessionId: unknown, text: unknown): Promise<void> {
      await agent.onTurn?.(text as string, makeCtx(sessionId as string));
    },

    onError(sessionId: unknown, error: unknown): void {
      agent.onError?.(
        new Error(error as string),
        makeCtx(sessionId as string),
      );
    },

    async onStep(sessionId: unknown, step: unknown): Promise<void> {
      await agent.onStep?.(
        step as Parameters<NonNullable<AgentDef["onStep"]>>[0],
        makeCtx(sessionId as string),
      );
    },

    async resolveMaxSteps(sessionId: unknown): Promise<number | null> {
      if (typeof agent.maxSteps !== "function") return null;
      return agent.maxSteps(makeCtx(sessionId as string));
    },

    async resolveBeforeStep(
      sessionId: unknown,
      stepNumber: unknown,
    ): Promise<{ activeTools?: string[] } | null> {
      if (!agent.onBeforeStep) return null;
      const result = await agent.onBeforeStep(
        stepNumber as number,
        makeCtx(sessionId as string),
      );
      return result ?? null;
    },
  };

  const rpcServer = createRpcServer(handlers, post);

  // Route all messages to the appropriate handler
  selfRef.onmessage = (e: MessageEvent) => {
    const data = e.data;
    if (!isRpcMessage(data)) return;
    if (data.type === "rpc-request") {
      rpcServer.handleRequest(data);
    } else {
      rpcClient.handleResponse(data);
    }
  };
}
