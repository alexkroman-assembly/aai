import { encodeBase64 } from "@std/encoding/base64";
import { loadPlatformConfig } from "./config.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { ToolSchema } from "@aai/sdk/schema";
import {
  createWorkerApi,
  type HostApi,
  type WorkerApi,
} from "@aai/core/worker-entry";
import type { ExecuteTool } from "@aai/core/worker-entry";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { AgentMetadata } from "./_schemas.ts";
import { createDenoWorker, LOCKED_PERMISSIONS } from "@aai/core/deno-worker";
import { assertPublicUrl, getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { KvStore } from "./kv.ts";
import type { AgentScope } from "./scope_token.ts";
export type { AgentMetadata } from "./_schemas.ts";

const IDLE_MS = 5 * 60 * 1000;

export type AgentSlot = {
  slug: string;
  env: Record<string, string>;
  transport: ("websocket" | "twilio")[];
  config?: AgentConfig;
  name?: string;
  toolSchemas?: ToolSchema[];
  accountId?: string;
  worker?: { handle: { terminate(): void }; api: WorkerApi };
  initializing?: Promise<void>;
  configLoaded?: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
};

async function spawnAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): Promise<void> {
  const { slug } = slot;

  console.info("Spawning agent worker", { slug });

  if (!getWorkerCode) {
    throw new Error(`No worker code source for ${slug}`);
  }
  const code = await getWorkerCode(slug);
  if (!code) throw new Error(`Worker code not found for ${slug}`);
  const workerUrl = `data:application/javascript;base64,${encodeBase64(code)}`;

  const worker = createDenoWorker(workerUrl, slug, LOCKED_PERMISSIONS);

  let lastCrash = 0;
  worker.addEventListener(
    "error",
    ((event: ErrorEvent) => {
      console.error("Worker died", { slug, error: event.message });
      if (slot.worker?.handle !== worker) return;
      slot.worker = undefined;

      const now = Date.now();
      if (now - lastCrash < 5_000) {
        console.error("Worker crash loop, not respawning", { slug });
        return;
      }
      lastCrash = now;
      console.info("Respawning worker", { slug });
      spawnAgent(slot, getWorkerCode, kvCtx).catch((err: unknown) => {
        console.error("Worker respawn failed", {
          slug,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }) as EventListener,
  );

  const api = createWorkerApi(worker, createHostApi(kvCtx));
  slot.worker = { handle: worker, api };

  if (!slot.configLoaded) {
    const { config, toolSchemas } = await api.getConfig();
    slot.config = config;
    slot.name = config.name;
    slot.toolSchemas = toolSchemas;
    slot.configLoaded = true;
  }
}

function createHostApi(
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): HostApi {
  return {
    async fetch(req) {
      await assertPublicUrl(req.url);
      const resp = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return {
        status: resp.status,
        statusText: resp.statusText,
        headers,
        body,
      };
    },

    async kv(req): Promise<{ result: unknown }> {
      if (!kvCtx) throw new Error("KV not configured for this agent");
      const { kvStore, scope } = kvCtx;
      switch (req.op) {
        case "get":
          return { result: await kvStore.get(scope, req.key) };
        case "set":
          await kvStore.set(scope, req.key, req.value, req.ttl);
          return { result: "OK" };
        case "del":
          await kvStore.del(scope, req.key);
          return { result: "OK" };
        case "list":
          return {
            result: await kvStore.list(scope, req.prefix, {
              limit: req.limit,
              reverse: req.reverse,
            }),
          };
        default:
          throw new Error(
            `Unknown KV operation: ${(req as { op: string }).op}`,
          );
      }
    },
  };
}

function resetIdleTimer(slot: AgentSlot): void {
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  const id = setTimeout(() => {
    if (!slot.worker) return;
    console.info("Evicting idle worker", { slug: slot.slug });
    slot.worker.handle.terminate();
    slot.worker = undefined;
    slot.idleTimer = undefined;
  }, IDLE_MS);
  Deno.unrefTimer(id);
  slot.idleTimer = id;
}

export function ensureAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): Promise<void> {
  const t0 = performance.now();

  if (slot.worker) {
    resetIdleTimer(slot);
    return Promise.resolve();
  }
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot, getWorkerCode, kvCtx).then(() => {
    slot.initializing = undefined;
    resetIdleTimer(slot);
    console.info("Agent ready", {
      slug: slot.slug,
      name: slot.name,
      durationMs: Math.round(performance.now() - t0),
    });
  }).catch((err) => {
    slot.initializing = undefined;
    throw err;
  });

  return slot.initializing;
}

export function registerSlot(
  slots: Map<string, AgentSlot>,
  metadata: AgentMetadata,
): boolean {
  try {
    loadPlatformConfig(metadata.env); // validate only
  } catch (err: unknown) {
    console.warn("Skipping deploy — missing platform config", {
      slug: metadata.slug,
      err,
    });
    return false;
  }

  slots.set(metadata.slug, {
    slug: metadata.slug,
    env: metadata.env,
    transport: metadata.transport,
    accountId: metadata.account_id,
  });
  return true;
}

export type SessionSetup = {
  agentConfig: AgentConfig;
  toolSchemas: ToolSchema[];
  platformConfig: ReturnType<typeof loadPlatformConfig>;
  executeTool: ExecuteTool;
  getWorkerApi: () => Promise<WorkerApi>;
  env?: Record<string, string | undefined>;
};

export async function prepareSession(
  slot: AgentSlot,
  slug: string,
  store: BundleStore,
  kvStore: KvStore,
): Promise<SessionSetup> {
  const kvCtx = slot.accountId
    ? { kvStore, scope: { accountId: slot.accountId, slug } }
    : undefined;
  const getWorkerCode = (s: string) => store.getFile(s, "worker");
  const getWorkerApi = async () => {
    await ensureAgent(slot, getWorkerCode, kvCtx);
    return slot.worker!.api;
  };
  const executeTool: ExecuteTool = async (name, args, sessionId, messages) => {
    const api = await getWorkerApi();
    return api.executeTool(name, args, sessionId, 30_000, slot.env, messages);
  };

  // Boot worker and extract config from agent definition
  await getWorkerApi();
  const config = slot.config!;

  const builtinTools = getBuiltinToolSchemas(config.builtinTools ?? []);
  const toolSchemas = [...(slot.toolSchemas ?? []), ...builtinTools];

  return {
    agentConfig: config,
    toolSchemas,
    platformConfig: loadPlatformConfig(slot.env),
    executeTool,
    getWorkerApi,
    env: slot.env,
  };
}
