import { encodeBase64 } from "@std/encoding/base64";
import { loadPlatformConfig } from "./config.ts";
import type { AgentConfig, ToolSchema } from "@aai/sdk/types";
import { createWorkerApi, type WorkerApi } from "@aai/core/worker-entry";
import type { ExecuteTool } from "@aai/core/worker-entry";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { AgentMetadata } from "@aai/core/rpc-schema";
import { createDenoWorker } from "@aai/core/deno-worker";
export type { AgentMetadata } from "@aai/core/rpc-schema";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export type AgentSlot = {
  slug: string;
  env: Record<string, string>;
  transport: ("websocket" | "twilio")[];
  config?: AgentConfig;
  name?: string;
  toolSchemas?: ToolSchema[];
  worker?: { handle: { terminate(): void }; api: WorkerApi };
  initializing?: Promise<void>;
  activeSessions: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  _dev?: boolean;
};

async function spawnAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
): Promise<void> {
  const { slug } = slot;

  console.info("Spawning agent worker", { slug });

  if (!getWorkerCode) {
    throw new Error(`No worker code source for ${slug}`);
  }
  const code = await getWorkerCode(slug);
  if (!code) throw new Error(`Worker code not found for ${slug}`);
  const workerUrl = `data:application/javascript;base64,${encodeBase64(code)}`;

  const worker = createDenoWorker(workerUrl, slug, {
    net: true,
    read: false,
    env: false,
    run: false,
    write: false,
    ffi: false,
    sys: false,
  });

  worker.addEventListener(
    "error",
    ((event: ErrorEvent) => {
      console.error("Worker error", { slug, error: event.message });
      if (slot.worker?.handle === worker) slot.worker = undefined;
    }) as EventListener,
  );

  const api = createWorkerApi(worker);
  slot.worker = { handle: worker, api };
}

export function ensureAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
): Promise<void> {
  const t0 = performance.now();

  if (slot.worker) {
    console.info("Agent ready", {
      slug: slot.slug,
      cached: true,
      durationMs: Math.round(performance.now() - t0),
    });
    return Promise.resolve();
  }
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot, getWorkerCode).then(() => {
    slot.initializing = undefined;
    console.info("Agent ready", {
      slug: slot.slug,
      name: slot.name,
      cached: false,
      durationMs: Math.round(performance.now() - t0),
    });
  }).catch((err) => {
    slot.initializing = undefined;
    throw err;
  });

  return slot.initializing;
}

export function trackSessionOpen(slot: AgentSlot): void {
  slot.activeSessions++;
  if (slot.idleTimer) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = undefined;
  }
}

export function trackSessionClose(
  slot: AgentSlot,
): void {
  slot.activeSessions = Math.max(0, slot.activeSessions - 1);
  if (slot.activeSessions === 0 && slot.worker) {
    const timerId = setTimeout(() => {
      if (slot.activeSessions === 0 && slot.worker) {
        console.info("Evicting idle agent Worker", { slug: slot.slug });
        slot.worker.handle.terminate();
        slot.worker = undefined;
        slot.idleTimer = undefined;
      }
    }, IDLE_TIMEOUT_MS);
    Deno.unrefTimer(timerId);
    slot.idleTimer = timerId;
  }
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
    config: metadata.config,
    name: metadata.config?.name,
    toolSchemas: metadata.toolSchemas,
    activeSessions: 0,
  });
  return true;
}

export function createToolExecutor(
  slot: AgentSlot,
  store: BundleStore,
): { executeTool: ExecuteTool; getWorkerApi?: () => Promise<WorkerApi> } {
  const customTools = slot.toolSchemas ?? [];
  const getWorkerCode = (s: string) => store.getFile(s, "worker");
  if (customTools.length === 0) {
    return {
      executeTool: () => Promise.resolve("Error: No custom tools"),
    };
  }
  const getWorkerApi = async () => {
    await ensureAgent(slot, getWorkerCode);
    return slot.worker!.api;
  };
  return {
    executeTool: async (name, args, sessionId) => {
      const api = await getWorkerApi();
      return api.executeTool(name, args, sessionId, 30_000, slot.env);
    },
    getWorkerApi,
  };
}
