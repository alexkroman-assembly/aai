import * as Comlink from "comlink";
import { z } from "zod";
import type {
  AgentDef,
  HookContext,
  Message,
  ToolContext,
  ToolDef,
} from "@aai/sdk/types";
import type { ToolSchema, WorkerConfig } from "@aai/sdk/schema";
import type { Kv, KvEntry } from "@aai/sdk/kv";
import { deadline } from "@std/async/deadline";

export const TOOL_HANDLER_TIMEOUT = 30_000;

export type ExecuteTool = (
  name: string,
  args: Record<string, unknown>,
  sessionId?: string,
  messages?: Message[],
) => Promise<string>;

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  tool: ToolDef,
  env: Record<string, string>,
  sessionId?: string,
  state?: unknown,
  kv?: Kv,
  messages?: readonly Message[],
): Promise<string> {
  const schema = tool.parameters ?? z.object({});
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issues = (parsed.error?.issues ?? [])
      .map((i: z.ZodIssue) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join(", ");
    return `Error: Invalid arguments for tool "${name}": ${issues}`;
  }

  try {
    const abortSignal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const envCopy = { ...env };
    const ctx: ToolContext = {
      sessionId: sessionId ?? "",
      env: envCopy,
      abortSignal,
      state: (state ?? {}) as Record<string, unknown>,
      get kv(): Kv {
        if (!kv) throw new Error("KV not available");
        return kv;
      },
      messages: messages ?? [],
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

export type { WorkerConfig } from "@aai/sdk/schema";

export type StepInfoRpc = {
  stepNumber: number;
  toolCalls: { toolName: string; args: Record<string, unknown> }[];
  text: string;
};

export type WorkerApi = {
  getConfig(): Promise<WorkerConfig>;
  executeTool(
    name: string,
    args: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
    env?: Record<string, string>,
    messages?: Message[],
  ): Promise<string>;
  invokeHook(
    hook: string,
    sessionId: string,
    extra?: { text?: string; error?: string; step?: StepInfoRpc },
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
  /** Release the underlying Comlink proxy and its MessagePort resources. */
  dispose?: () => Promise<void>;
};

import type { KvRequest } from "./_protocol.ts";
export type { KvRequest };

/** API shape the host exposes to the worker via Comlink.proxy. */
export type HostApi = {
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
};

/** API shape exposed by the worker via Comlink. */
export type ExposedWorkerApi = {
  /** Receive a MessagePort for calling back to the host (fetch/kv). */
  init(hostPort: MessagePort): void;
  /** Release the host callback port (for clean test teardown). */
  dispose(): void;
  /** Return agent config and tool schemas extracted from the agent definition. */
  getConfig(): WorkerConfig;
  executeTool(
    name: string,
    args: Record<string, unknown>,
    sessionId?: string,
    env?: Record<string, string>,
    messages?: Message[],
  ): Promise<string>;
  invokeHook(
    hook: string,
    sessionId: string,
    text?: string,
    error?: string,
    env?: Record<string, string>,
    stepJson?: string,
  ): Promise<void>;
  resolveMaxSteps(
    sessionId: string,
    env?: Record<string, string>,
  ): Promise<number | null>;
  resolveBeforeStep(
    sessionId: string,
    stepNumber: number,
    env?: Record<string, string>,
  ): Promise<{ activeTools?: string[] } | null>;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;
  return deadline(promise, timeoutMs).catch((err) => {
    throw err.name === "TimeoutError"
      ? new Error(`RPC timed out after ${timeoutMs}ms`)
      : err;
  });
}

/**
 * Create a WorkerApi backed by Comlink. Use for Worker/MessagePort endpoints.
 * Pass hostApi to enable fetch/kv proxy from worker to host.
 */
export function createWorkerApi(
  endpoint: Comlink.Endpoint,
  hostApi?: HostApi,
): WorkerApi {
  const remote = Comlink.wrap<ExposedWorkerApi>(endpoint);
  let hostPort: MessagePort | undefined;
  let ready: Promise<void>;

  if (hostApi) {
    const ch = new MessageChannel();
    hostPort = ch.port1;
    Comlink.expose(hostApi, ch.port1);
    ready = remote.init(Comlink.transfer(ch.port2, [ch.port2]));
  } else {
    ready = Promise.resolve();
  }

  return {
    async getConfig() {
      await ready;
      return await withTimeout(remote.getConfig(), 5_000);
    },
    async executeTool(name, args, sessionId, timeoutMs, env, messages) {
      await ready;
      const raw = await withTimeout(
        remote.executeTool(name, args, sessionId, env, messages),
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async invokeHook(hook, sessionId, extra, timeoutMs, env) {
      await ready;
      const stepJson = extra?.step ? JSON.stringify(extra.step) : undefined;
      await withTimeout(
        remote.invokeHook(
          hook,
          sessionId,
          extra?.text,
          extra?.error,
          env,
          stepJson,
        ),
        timeoutMs,
      );
    },
    async resolveMaxSteps(sessionId, timeoutMs, env) {
      await ready;
      return await withTimeout(
        remote.resolveMaxSteps(sessionId, env),
        timeoutMs ?? 5_000,
      );
    },
    async resolveBeforeStep(sessionId, stepNumber, timeoutMs, env) {
      await ready;
      return await withTimeout(
        remote.resolveBeforeStep(sessionId, stepNumber, env),
        timeoutMs ?? 5_000,
      );
    },
    async dispose() {
      await remote.dispose();
      remote[Comlink.releaseProxy]();
      hostPort?.close();
    },
  };
}

export function startWorker(
  agent: AgentDef,
  env: Record<string, string>,
  endpoint?: Comlink.Endpoint,
): void {
  const toolHandlers = new Map(Object.entries(agent.tools));
  const sessions = new Map<string, unknown>();
  let mergedEnv = { ...env };
  let proxyKv: Kv | undefined;
  let hostPort: MessagePort | undefined;

  function applyEnv(extra?: Record<string, string>): void {
    if (extra) mergedEnv = { ...mergedEnv, ...extra };
  }

  function getState(sessionId: string): unknown {
    if (!sessions.has(sessionId) && agent.state) {
      sessions.set(sessionId, agent.state());
    }
    return sessions.get(sessionId) ?? {};
  }

  const EMPTY_PARAMS = z.object({});

  const api: ExposedWorkerApi = {
    init(port: MessagePort) {
      hostPort = port;
      const remote = Comlink.wrap<HostApi>(port);
      proxyKv = createProxyKv(remote);
      installFetchProxy(remote);
    },

    dispose() {
      hostPort?.close();
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
      return {
        config: {
          name: agent.name,
          mode: agent.mode,
          instructions: agent.instructions,
          greeting: agent.greeting,
          voice: agent.voice,
          sttPrompt: agent.sttPrompt,
          maxSteps: typeof agent.maxSteps === "function"
            ? undefined
            : agent.maxSteps,
          toolChoice: agent.toolChoice,
          builtinTools: agent.builtinTools
            ? [...agent.builtinTools]
            : undefined,
        },
        toolSchemas,
      };
    },

    async executeTool(name, args, sessionId, env, messages) {
      applyEnv(env);
      const tool = toolHandlers.get(name);
      if (!tool) return `Error: Unknown tool "${name}"`;
      return await executeToolCall(
        name,
        args,
        tool,
        mergedEnv,
        sessionId,
        getState(sessionId ?? ""),
        proxyKv,
        messages,
      );
    },

    async invokeHook(hook, sessionId, text, error, env, stepJson) {
      applyEnv(env);
      const state = getState(sessionId);
      const ctx: HookContext = {
        sessionId,
        env: { ...mergedEnv },
        state: state as Record<string, unknown>,
        get kv() {
          if (!proxyKv) throw new Error("KV not available");
          return proxyKv;
        },
      };
      if (hook === "onConnect") {
        await agent.onConnect?.(ctx);
      } else if (hook === "onDisconnect") {
        await agent.onDisconnect?.(ctx);
        sessions.delete(sessionId);
      } else if (hook === "onTurn" && text !== undefined) {
        await agent.onTurn?.(text, ctx);
      } else if (hook === "onError" && error !== undefined) {
        agent.onError?.(new Error(error), ctx);
      } else if (hook === "onStep" && stepJson !== undefined) {
        const step = JSON.parse(stepJson);
        await agent.onStep?.(step, ctx);
      }
    },

    // deno-lint-ignore require-await
    async resolveMaxSteps(sessionId, env) {
      applyEnv(env);
      if (typeof agent.maxSteps !== "function") return null;
      const state = getState(sessionId);
      const ctx: HookContext = {
        sessionId,
        env: { ...mergedEnv },
        state: state as Record<string, unknown>,
        get kv() {
          if (!proxyKv) throw new Error("KV not available");
          return proxyKv;
        },
      };
      return agent.maxSteps(ctx);
    },

    async resolveBeforeStep(sessionId, stepNumber, env) {
      applyEnv(env);
      if (!agent.onBeforeStep) return null;
      const state = getState(sessionId);
      const ctx: HookContext = {
        sessionId,
        env: { ...mergedEnv },
        state: state as Record<string, unknown>,
        get kv() {
          if (!proxyKv) throw new Error("KV not available");
          return proxyKv;
        },
      };
      const result = await agent.onBeforeStep(stepNumber, ctx);
      return result ?? null;
    },
  };

  const port = endpoint ?? (self as unknown as Comlink.Endpoint);
  Comlink.expose(api, port);
}

const KV_TIMEOUT_MS = 10_000;

function createProxyKv(hostApi: Comlink.Remote<HostApi>): Kv {
  async function kvCall(req: KvRequest): Promise<unknown> {
    const resp = await withTimeout(hostApi.kv(req), KV_TIMEOUT_MS);
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
      const result = await kvCall({
        op: "list",
        prefix,
        limit: options?.limit,
        reverse: options?.reverse,
      });
      return result as KvEntry<T>[];
    },
  };
}

const FETCH_TIMEOUT_MS = 30_000;

/** Serialize a BodyInit value to a string suitable for RPC transport. */
async function serializeBody(body: BodyInit | null): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof Blob) {
    return await body.text();
  }
  if (body instanceof ReadableStream) {
    return await new Response(body).text();
  }
  if (body instanceof FormData) {
    // FormData can't be cleanly serialized to a string; convert to URL-encoded
    return new URLSearchParams(body as unknown as Record<string, string>)
      .toString();
  }
  return String(body);
}

function headersToRecord(h?: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(h).entries());
}

/** Replace globalThis.fetch with a proxy to the host process via Comlink. */
function installFetchProxy(hostApi: Comlink.Remote<HostApi>): void {
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
      hostApi.fetch({ url, method, headers, body }),
      FETCH_TIMEOUT_MS,
    );

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };
}
