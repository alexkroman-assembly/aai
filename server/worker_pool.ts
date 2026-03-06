import { loadPlatformConfig } from "./config.ts";
import { getLogger } from "./logger.ts";
import { getBuiltinToolSchemas } from "./builtin_tools.ts";
import type { ExecuteTool } from "../sdk/_tool_executor.ts";
import type { AgentConfig, ToolSchema } from "./types.ts";
import type { WorkerApi } from "../sdk/_worker_entry.ts";
import { createWorkerRpc } from "./rpc.ts";
export interface AgentMetadata {
  slug: string;
  env: Record<string, string>;
  transport: ("websocket" | "twilio")[];
  owner_hash?: string;
}

const log = getLogger("worker-pool");

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TOOL_TIMEOUT_MS = 30_000;

/** A minimal subset of Worker used for lifecycle management. */
export interface WorkerHandle {
  terminate(): void;
}

export interface AgentInfo {
  slug: string;
  name: string;
  worker: WorkerHandle;
  workerApi: WorkerApi;
  config: AgentConfig;
  toolSchemas: ToolSchema[];
}

export interface AgentSlot {
  slug: string;
  env: Record<string, string>;
  transport: ("websocket" | "twilio")[];
  live?: AgentInfo;
  initializing?: Promise<AgentInfo>;
  activeSessions: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export function createRpcToolExecutor(
  workerApi: WorkerApi,
): ExecuteTool {
  return (name, args) => workerApi.executeTool(name, args, TOOL_TIMEOUT_MS);
}

export async function spawnAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
): Promise<AgentInfo> {
  const { slug } = slot;

  log.info("Spawning agent worker", { slug });

  if (!getWorkerCode) {
    throw new Error(`No worker code source for ${slug}`);
  }
  const code = await getWorkerCode(slug);
  if (!code) throw new Error(`Worker code not found for ${slug}`);
  const workerUrl = `data:application/javascript;base64,${btoa(code)}`;

  // deno-lint-ignore no-explicit-any
  const worker = new (Worker as any)(workerUrl, {
    type: "module",
    name: slug,
    deno: {
      permissions: {
        net: true,
        read: false,
        env: false,
        run: false,
        write: false,
        ffi: false,
        sys: false,
      },
    },
  });

  worker.addEventListener(
    "error",
    ((event: ErrorEvent) => {
      log.error("Worker error", { slug, error: event.message });
      if (slot.live?.worker === worker) slot.live = undefined;
    }) as EventListener,
  );

  const workerApi = createWorkerRpc(worker);

  let info;
  try {
    info = await workerApi.getConfig(15_000);
  } catch (err: unknown) {
    worker.terminate();
    throw err;
  }

  const agentConfig: AgentConfig = {
    instructions: info.config.instructions,
    greeting: info.config.greeting,
    voice: info.config.voice,
    prompt: info.config.prompt,
    builtinTools: info.config.builtinTools,
  };

  const allToolSchemas = [
    ...info.toolSchemas,
    ...getBuiltinToolSchemas(agentConfig.builtinTools ?? []),
  ];

  const agentInfo: AgentInfo = {
    slug,
    name: info.config.name ?? slug,
    worker,
    workerApi,
    config: agentConfig,
    toolSchemas: allToolSchemas,
  };
  return agentInfo;
}

export function ensureAgent(
  slot: AgentSlot,
  getWorkerCode?: (slug: string) => Promise<string | null>,
): Promise<AgentInfo> {
  const t0 = performance.now();

  if (slot.live) {
    log.info("Agent ready", {
      slug: slot.slug,
      cached: true,
      durationMs: Math.round(performance.now() - t0),
    });
    return Promise.resolve(slot.live);
  }
  if (slot.initializing) return slot.initializing;

  slot.initializing = spawnAgent(slot, getWorkerCode).then((info) => {
    slot.live = info;
    slot.initializing = undefined;
    log.info("Agent ready", {
      slug: info.slug,
      name: info.name,
      cached: false,
      durationMs: Math.round(performance.now() - t0),
    });
    return info;
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
  if (slot.activeSessions === 0 && slot.live) {
    const timerId = setTimeout(() => {
      if (slot.activeSessions === 0 && slot.live) {
        log.info("Evicting idle agent Worker", { slug: slot.slug });
        slot.live.worker.terminate();
        slot.live = undefined;
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
    activeSessions: 0,
  });
  return true;
}
