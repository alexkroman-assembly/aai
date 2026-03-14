// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { encodeBase64 } from "@std/encoding/base64";
import { loadPlatformConfig } from "./config.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { ToolSchema } from "@aai/sdk/types";
import {
  createWorkerApi,
  type HostApi,
  type WorkerApi,
} from "./_worker_entry.ts";
import type { ExecuteTool } from "./_worker_entry.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { AgentMetadata } from "./_schemas.ts";
import { createDenoWorker, LOCKED_PERMISSIONS } from "./_deno_worker.ts";
import { assertPublicUrl, getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { KvStore } from "./kv.ts";
import type { AgentScope } from "./scope_token.ts";
export type { AgentMetadata } from "./_schemas.ts";

const IDLE_MS = 5 * 60 * 1000;

/**
 * Runtime state for a deployed agent, including its worker process and
 * cached configuration. Managed by the worker pool.
 */
export type AgentSlot = {
  /** The agent's unique slug identifier. */
  slug: string;
  /** Environment variables provided at deploy time. */
  env: Record<string, string>;
  /** Supported transport types for this agent. */
  transport: readonly ("websocket" | "twilio")[];
  /** Cached agent configuration extracted from the worker. */
  config?: AgentConfig;
  /** Human-readable agent name from the configuration. */
  name?: string;
  /** Cached tool schemas extracted from the worker. */
  toolSchemas?: ToolSchema[];
  /** Credential hash of the agent owner (for KV scoping). */
  keyHash: string;
  /** Active worker handle and RPC API proxy. */
  worker?: { handle: { terminate(): void }; api: WorkerApi };
  /** Promise that resolves when the worker is done initializing. */
  initializing?: Promise<void>;
  /** Whether the agent config has been loaded from the worker. */
  configLoaded?: boolean;
  /** Timer handle for idle worker eviction. */
  idleTimer?: ReturnType<typeof setTimeout>;
};

async function spawnAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
  kvCtx?: { kvStore: KvStore; scope: AgentScope },
): Promise<void> {
  const { slug } = slot;

  log.info("Spawning agent worker", { slug });

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
      log.error("Worker died", { slug, error: event.message });
      if (slot.worker?.handle !== worker) return;
      delete slot.worker;

      const now = Date.now();
      if (now - lastCrash < 5_000) {
        log.error("Worker crash loop, not respawning", { slug });
        return;
      }
      lastCrash = now;
      log.info("Respawning worker", { slug });
      spawnAgent(slot, getWorkerCode, kvCtx).catch((err: unknown) => {
        log.error("Worker respawn failed", {
          slug,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }) as EventListener,
  );

  const api = createWorkerApi(worker, createHostApi(kvCtx), slot.env);
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
              ...(req.limit !== undefined && { limit: req.limit }),
              ...(req.reverse !== undefined && { reverse: req.reverse }),
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
    log.info("Evicting idle worker", { slug: slot.slug });
    slot.worker.handle.terminate();
    delete slot.worker;
    delete slot.idleTimer;
  }, IDLE_MS);
  Deno.unrefTimer(id);
  slot.idleTimer = id;
}

/**
 * Ensures an agent worker is running for the given slot.
 *
 * If a worker is already active, resets its idle eviction timer. If no worker
 * exists, spawns a new one and extracts its configuration. Concurrent calls
 * for the same slot coalesce into a single initialization promise.
 *
 * @param slot - The agent slot to ensure has a running worker.
 * @param getWorkerCode - Async function to retrieve the bundled worker JS by slug.
 * @param kvCtx - Optional KV context for agents with KV access.
 * @returns A promise that resolves when the worker is ready.
 * @throws If the worker code cannot be found or the worker fails to initialize.
 */
export function ensureAgent(
  slot: AgentSlot,
  opts?: {
    getWorkerCode?: (slug: string) => Promise<string | null>;
    kvCtx?: { kvStore: KvStore; scope: AgentScope };
  },
): Promise<void> {
  const getWorkerCode = opts?.getWorkerCode;
  const kvCtx = opts?.kvCtx;
  const t0 = performance.now();

  if (slot.worker) {
    resetIdleTimer(slot);
    return Promise.resolve();
  }
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot, getWorkerCode, kvCtx).then(() => {
    delete slot.initializing;
    resetIdleTimer(slot);
    log.info("Agent ready", {
      slug: slot.slug,
      name: slot.name,
      durationMs: Math.round(performance.now() - t0),
    });
  }).catch((err) => {
    delete slot.initializing;
    throw err;
  });

  return slot.initializing;
}

/**
 * Registers an agent slot from deploy metadata.
 *
 * Validates that the metadata contains a valid platform config before
 * registering. Agents with missing or invalid config are skipped.
 *
 * @param slots - The map of active agent slots to register into.
 * @param metadata - Agent metadata from the bundle store.
 * @returns `true` if the slot was registered, `false` if skipped due to invalid config.
 */
export function registerSlot(
  slots: Map<string, AgentSlot>,
  metadata: AgentMetadata,
): boolean {
  try {
    loadPlatformConfig(metadata.env); // validate only
  } catch (err: unknown) {
    log.warn("Skipping deploy — missing platform config", {
      slug: metadata.slug,
      err,
    });
    return false;
  }

  slots.set(metadata.slug, {
    slug: metadata.slug,
    env: metadata.env,
    transport: metadata.transport,
    keyHash: metadata.credential_hashes[0] ?? "",
  });
  return true;
}

/** Everything needed to create a {@linkcode Session} for an agent. */
export type SessionSetup = {
  /** The agent's configuration from `defineAgent()`. */
  agentConfig: AgentConfig;
  /** Combined builtin and agent-defined tool schemas. */
  toolSchemas: ToolSchema[];
  /** Platform-level configuration (API keys, model, STT/TTS settings). */
  platformConfig: ReturnType<typeof loadPlatformConfig>;
  /** Function to execute a tool call in the agent worker. */
  executeTool: ExecuteTool;
  /** Factory to lazily obtain the worker API. */
  getWorkerApi: () => Promise<WorkerApi>;
  /** Environment variables available to the agent. */
  env?: Record<string, string | undefined>;
};

/**
 * Prepares all dependencies needed to create a session for an agent.
 *
 * Boots the agent worker (if not already running), extracts its configuration,
 * and assembles tool schemas, platform config, and tool execution functions.
 *
 * @param slot - The agent slot to prepare a session for.
 * @param slug - The agent's slug identifier.
 * @param store - Bundle store for retrieving worker code.
 * @param kvStore - Key-value store for agent state persistence.
 * @returns A {@linkcode SessionSetup} with everything needed to create a session.
 * @throws If the worker cannot be spawned or config cannot be extracted.
 */
export async function prepareSession(
  slot: AgentSlot,
  opts: { slug: string; store: BundleStore; kvStore: KvStore },
): Promise<SessionSetup> {
  const { slug, store, kvStore } = opts;
  const kvCtx = { kvStore, scope: { keyHash: slot.keyHash, slug } };
  const getWorkerCode = (s: string) => store.getFile(s, "worker");
  const getWorkerApi = async () => {
    await ensureAgent(slot, { getWorkerCode, kvCtx });
    return slot.worker!.api;
  };
  const executeTool: ExecuteTool = async (name, args, sessionId, messages) => {
    const api = await getWorkerApi();
    return api.executeTool(name, args, sessionId, 30_000, messages);
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
