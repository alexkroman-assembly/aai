import { resolve, toFileUrl } from "@std/path";
import { agentToolsToSchemas } from "../server/agent_types.ts";
import { executeToolCall } from "../server/tool_executor.ts";
import type { AgentConfig, ToolSchema } from "../server/types.ts";
import type { AgentEntry } from "./_discover.ts";
import { log } from "./_output.ts";

export interface WorkerServer {
  shutdown(): Promise<void>;
  reload(): Promise<void>;
}

/** Start a local HTTP server that exposes the agent's getConfig/executeTool as RPC. */
export async function startWorkerServer(
  agent: AgentEntry,
  port: number,
): Promise<WorkerServer> {
  let config: AgentConfig;
  let toolSchemas: ToolSchema[];
  let toolHandlers: Map<string, unknown>;
  let secrets: Record<string, string>;

  async function loadAgent() {
    // Inject SDK globals so import-free agent files work
    const { defineAgent } = await import("../server/agent.ts");
    const { fetchJSON } = await import("../server/fetch_json.ts");
    const { z } = await import("zod");
    Object.assign(globalThis, { defineAgent, fetchJSON, z });

    // Use a cache-busting query param to force re-import on reload
    const url = toFileUrl(resolve(agent.entryPoint)).href +
      `?t=${Date.now()}`;
    const mod = await import(url);
    const agentDef = mod.default;

    config = {
      name: agentDef.name,
      instructions: agentDef.instructions,
      greeting: agentDef.greeting,
      voice: agentDef.voice,
      prompt: agentDef.prompt,
      builtinTools: agentDef.builtinTools
        ? [...agentDef.builtinTools]
        : undefined,
    };

    toolSchemas = agentToolsToSchemas(agentDef.tools);
    toolHandlers = new Map(Object.entries(agentDef.tools));
    secrets = { ...agent.env };
  }

  await loadAgent();

  const server = Deno.serve({ port, onListen: () => {} }, async (req) => {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(req.url);
    if (url.pathname !== "/rpc") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const body = await req.json();

      if (body.type === "getConfig") {
        return Response.json({ config, toolSchemas });
      }

      if (body.type === "executeTool") {
        const tool = toolHandlers.get(body.name);
        if (!tool) {
          return Response.json({ error: `Unknown tool "${body.name}"` });
        }
        const result = await executeToolCall(
          body.name,
          body.args,
          // deno-lint-ignore no-explicit-any
          tool as any,
          secrets,
        );
        return Response.json({ result });
      }

      return Response.json({ error: `Unknown type: ${body.type}` }, {
        status: 400,
      });
    } catch (err: unknown) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  });

  log.stepInfo("Worker", `http://localhost:${port}/rpc`);

  return {
    async shutdown() {
      await server.shutdown();
    },
    async reload() {
      try {
        await loadAgent();
        log.step("Reload", "agent reloaded");
      } catch (err: unknown) {
        log.error(
          `reload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
