import { debounce } from "@std/async/debounce";
import { context } from "esbuild";
import { log } from "./_output.ts";
import { loadAgent } from "./_discover.ts";
import { clientBuildOptions } from "./_bundler.ts";
import { startWorkerServer } from "./worker_server.ts";
import { startTunnel, type Tunnel } from "./tunnel.ts";

export interface DevOpts {
  agentDir: string;
  workerPort: number;
  serverUrl: string;
}

function isLocalServer(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Deploy agent config to the server with a worker_url. */
async function deployToServer(
  serverUrl: string,
  slug: string,
  env: Record<string, string>,
  transport: string[],
  clientJs: string,
  workerUrl: string,
  apiKey: string,
): Promise<void> {
  const resp = await fetch(`${serverUrl}/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      slug,
      env,
      worker_url: workerUrl,
      client: clientJs,
      transport,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Deploy failed (${resp.status}): ${text}`);
  }
}

export async function runDev(opts: DevOpts): Promise<void> {
  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} — needs agent.ts + agent.json`,
    );
  }

  const apiKey = agent.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ASSEMBLYAI_API_KEY not found — set it in .env or your environment",
    );
  }

  const local = isLocalServer(opts.serverUrl);

  // 1. Build client bundle (still needs esbuild for browser JS)
  log.step("Bundle", `${agent.slug} client`);
  const tmpDir = await Deno.makeTempDir({ prefix: "aai-dev-" });
  const slugDir = `${tmpDir}/${agent.slug}`;
  await Deno.mkdir(slugDir, { recursive: true });

  const clientCtx = await context({
    ...clientBuildOptions(agent.clientEntry, `${slugDir}/client.js`),
    sourcemap: true,
  });
  await clientCtx.rebuild();
  await clientCtx.watch();
  log.stepInfo("Watch", "client (esbuild)");

  // 2. Start local worker HTTP server
  const workerServer = await startWorkerServer(agent, opts.workerPort);

  // 3. Get the worker URL — tunnel for remote, direct for local
  let tunnel: Tunnel | undefined;
  let workerUrl: string;

  if (local) {
    workerUrl = `http://localhost:${opts.workerPort}`;
  } else {
    tunnel = await startTunnel(opts.workerPort);
    workerUrl = tunnel.url;
  }

  // 4. Deploy to server with worker_url
  const clientJs = await Deno.readTextFile(`${slugDir}/client.js`);
  log.step("Deploy", `${agent.slug} → ${opts.serverUrl}`);
  await deployToServer(
    opts.serverUrl,
    agent.slug,
    agent.env,
    agent.transport,
    clientJs,
    workerUrl,
    apiKey,
  );

  // 5. Watch for file changes → reload worker (no server restart needed)
  const watcher = Deno.watchFs([agent.dir], { recursive: true });

  const rebuild = debounce(async () => {
    log.step("Change", "file modified, reloading...");
    try {
      await workerServer.reload();
      await clientCtx.rebuild();

      const newClientJs = await Deno.readTextFile(`${slugDir}/client.js`);
      await deployToServer(
        opts.serverUrl,
        agent.slug,
        agent.env,
        agent.transport,
        newClientJs,
        workerUrl,
        apiKey,
      );
      log.step("Deploy", "updated");
    } catch (err: unknown) {
      log.error(
        `rebuild failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, 300);

  (async () => {
    for await (const event of watcher) {
      const hasRelevantChange = event.paths.some((p) =>
        p.endsWith(".ts") || p.endsWith(".tsx")
      );
      if (!hasRelevantChange) continue;
      if (event.paths.every((p) => p.includes("_test.ts"))) continue;
      rebuild();
    }
  })();

  if (agent.transport.includes("websocket")) {
    log.stepInfo("Listen", `${opts.serverUrl}/${agent.slug}/`);
  }
  if (agent.transport.includes("twilio")) {
    log.stepInfo("Listen", `${opts.serverUrl}/${agent.slug}/twilio/voice`);
  }
  log.stepInfo("Watch", "for changes...");
  console.log();

  const cleanup = () => {
    watcher.close();
    tunnel?.close();
    workerServer.shutdown();
    clientCtx.dispose();
    Deno.removeSync(tmpDir, { recursive: true });
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  await new Promise(() => {});
}
