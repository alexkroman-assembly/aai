import { z } from "zod";
import type {
  AgentDef,
  HookContext,
  ToolContext,
  ToolDef,
} from "@aai/sdk/types";
import { createKv, type Kv } from "@aai/sdk/kv";
import {
  createRpcCaller,
  createRpcEndpoint,
  type MessageTarget,
  type RpcCall,
  type RpcHandlers,
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
  state?: unknown,
  kv?: Kv,
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
    const envCopy = { ...env };
    const ctx: ToolContext = {
      sessionId: sessionId ?? "",
      env: envCopy,
      signal,
      state: (state ?? {}) as Record<string, unknown>,
      kv: kv ?? createKv({ env: envCopy }),
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
    env?: Record<string, string>,
  ): Promise<string>;
  invokeHook(
    hook: string,
    sessionId: string,
    extra?: { text?: string; error?: string },
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<void>;
};

export function createWorkerApi(
  port: MessageTarget,
  hostHandlers?: RpcHandlers,
): WorkerApi {
  const call = hostHandlers
    ? createRpcEndpoint(port, hostHandlers)
    : createRpcCaller(port);
  return {
    async executeTool(name, args, sessionId, timeoutMs, env) {
      const raw = await call(
        "executeTool",
        { name, args, sessionId, env },
        timeoutMs,
      );
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async invokeHook(hook, sessionId, extra, timeoutMs, env) {
      await call("invokeHook", { hook, sessionId, ...extra, env }, timeoutMs);
    },
  };
}

export function startWorker(
  agent: AgentDef,
  env: Record<string, string>,
  endpoint?: MessageTarget,
): void {
  const toolHandlers = new Map(Object.entries(agent.tools));
  const sessions = new Map<string, unknown>();
  let mergedEnv = { ...env };
  let sharedKv: Kv = createKv({ env: mergedEnv });

  function applyEnv(extra?: Record<string, string>): void {
    if (!extra) return;
    const updated = { ...mergedEnv, ...extra };
    if (JSON.stringify(updated) !== JSON.stringify(mergedEnv)) {
      mergedEnv = updated;
      sharedKv = createKv({ env: mergedEnv });
    }
  }

  function getState(sessionId: string): unknown {
    if (!sessions.has(sessionId) && agent.state) {
      sessions.set(sessionId, agent.state());
    }
    return sessions.get(sessionId) ?? {};
  }

  const port: MessageTarget = endpoint ?? self as unknown as MessageTarget;

  const handlers: RpcHandlers = {
    executeTool(req) {
      applyEnv(req.env);
      const tool = toolHandlers.get(req.name);
      if (!tool) return `Error: Unknown tool "${req.name}"`;
      return executeToolCall(
        req.name,
        req.args,
        tool,
        mergedEnv,
        req.sessionId,
        getState(req.sessionId ?? ""),
        sharedKv,
      );
    },

    async invokeHook(req) {
      applyEnv(req.env);
      const state = getState(req.sessionId);
      const ctx: HookContext = {
        sessionId: req.sessionId,
        env: { ...mergedEnv },
        state: state as Record<string, unknown>,
        kv: sharedKv,
      };
      if (req.hook === "onConnect") {
        await agent.onConnect?.(ctx);
      } else if (req.hook === "onDisconnect") {
        await agent.onDisconnect?.(ctx);
        sessions.delete(req.sessionId);
      } else if (req.hook === "onTurn" && req.text !== undefined) {
        await agent.onTurn?.(req.text, ctx);
      } else if (req.hook === "onError" && req.error !== undefined) {
        agent.onError?.(new Error(req.error), ctx);
      }
    },
  };

  const call = createRpcEndpoint(port, handlers);
  installFetchProxy(call);
}

const FETCH_TIMEOUT_MS = 30_000;

/** Replace globalThis.fetch with an RPC-backed proxy to the host process. */
function installFetchProxy(call: RpcCall): void {
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
      headers = Object.fromEntries(
        new Headers(init?.headers ?? input.headers).entries(),
      );
      body = init?.body != null
        ? String(init.body)
        : input.body != null
        ? await input.text()
        : null;
    } else {
      url = String(input);
      method = init?.method ?? "GET";
      headers = Object.fromEntries(
        new Headers(init?.headers).entries(),
      );
      body = init?.body != null ? String(init.body) : null;
    }

    const result = (await call(
      "fetch",
      { url, method, headers, body },
      FETCH_TIMEOUT_MS,
    )) as { status: number; statusText: string; headers: Record<string, string>; body: string };

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };
}
