import { debounce } from "@std/async/debounce";
import { context } from "esbuild";
import { dirname, fromFileUrl, resolve } from "@std/path";
import { log } from "./_output.ts";
import { loadAgent } from "./_discover.ts";
import { bundleAgent, clientBuildOptions } from "./_bundler.ts";
import { deployToLocal, spawn, waitForServer } from "./_server.ts";

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

export interface DevOpts {
  port: number;
  agentDir: string;
}

export async function runDev(opts: DevOpts): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: "aai-dev-" });
  const baseUrl = `http://localhost:${opts.port}`;

  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} — needs agent.ts + agent.json`,
    );
  }

  log.step("Bundle", agent.slug);
  const slugDir = `${tmpDir}/${agent.slug}`;
  const { workerBytes } = await bundleAgent(agent, slugDir, {
    skipClient: true,
  });
  log.size("worker.js", workerBytes);

  const clientCtx = await context({
    ...clientBuildOptions(agent.clientEntry, `${slugDir}/client.js`),
    sourcemap: true,
  });
  await clientCtx.rebuild();
  await clientCtx.watch();
  log.stepInfo("Watch", "client (esbuild)");

  let orchestrator = spawn(opts.port);
  await waitForServer(baseUrl);
  await deployToLocal(
    baseUrl,
    slugDir,
    agent.slug,
    agent.env,
    agent.transport,
  );

  const watcher = Deno.watchFs(
    [agent.dir, resolve(AAI_ROOT, "server")],
    { recursive: true },
  );

  const rebuild = debounce(async () => {
    log.step("Change", "file modified, rebuilding...");
    try {
      await bundleAgent(agent, slugDir);
      log.step("Restart", "orchestrator");
      orchestrator.kill();
      await orchestrator.status.catch(() => {});
      orchestrator = spawn(opts.port);
      await waitForServer(baseUrl);
      await deployToLocal(
        baseUrl,
        slugDir,
        agent.slug,
        agent.env,
        agent.transport,
      );
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
      if (
        event.paths.every((p) =>
          p.includes("_test.ts") || p.includes("_worker_entry")
        )
      ) continue;

      rebuild();
    }
  })();

  if (agent.transport.includes("websocket")) {
    log.stepInfo(
      "Listen",
      `http://localhost:${opts.port}/${agent.slug}/`,
    );
  }
  if (agent.transport.includes("twilio")) {
    log.stepInfo(
      "Listen",
      `http://localhost:${opts.port}/${agent.slug}/twilio/voice`,
    );
  }
  log.stepInfo("Watch", "for changes...");
  console.log();

  const cleanup = () => {
    watcher.close();
    orchestrator.kill();
    clientCtx.dispose();
    Deno.removeSync(tmpDir, { recursive: true });
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  await orchestrator.status;
}
