import { debounce } from "@std/async/debounce";
import { log } from "./_output.ts";
import { loadAgent } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";

export interface DevOpts {
  agentDir: string;
  serverUrl: string;
}

async function deploy(
  serverUrl: string,
  bundleDir: string,
  slug: string,
  apiKey: string,
): Promise<void> {
  const dir = `${bundleDir}/${slug}`;
  const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  const worker = await Deno.readTextFile(`${dir}/worker.js`);
  const client = await Deno.readTextFile(`${dir}/client.js`);

  let resp: Response;
  try {
    resp = await fetch(`${serverUrl}/deploy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        slug: manifest.slug,
        env: manifest.env,
        worker,
        client,
        transport: manifest.transport,
      }),
    });
  } catch (err) {
    throw new Error(
      `Deploy request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

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
  const tmpDir = await Deno.makeTempDir({ prefix: "aai-dev-" });

  // Initial build + deploy
  log.step("Bundle", agent.slug);
  await bundleAgent(agent, `${tmpDir}/${agent.slug}`);
  log.step("Deploy", `${agent.slug} → ${opts.serverUrl}`);
  await deploy(opts.serverUrl, tmpDir, agent.slug, apiKey);

  // Watch for file changes → rebuild and redeploy
  const watcher = Deno.watchFs([agent.dir], { recursive: true });

  const rebuild = debounce(async () => {
    log.step("Change", "file modified, rebuilding...");
    try {
      const freshAgent = await loadAgent(opts.agentDir);
      if (!freshAgent) throw new Error("agent not found after change");
      await bundleAgent(freshAgent, `${tmpDir}/${freshAgent.slug}`);
      await deploy(opts.serverUrl, tmpDir, freshAgent.slug, apiKey);
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

  const agentUrl = `${opts.serverUrl}/${agent.slug}/`;
  if (agent.transport.includes("websocket")) {
    log.stepInfo("Listen", agentUrl);
  }
  if (agent.transport.includes("twilio")) {
    log.stepInfo("Listen", `${opts.serverUrl}/${agent.slug}/twilio/voice`);
  }
  log.stepInfo("Watch", "for changes...");
  console.log();

  const openCmd = Deno.build.os === "darwin"
    ? "open"
    : Deno.build.os === "windows"
    ? "start"
    : "xdg-open";
  new Deno.Command(openCmd, { args: [agentUrl] }).spawn();

  const cleanup = () => {
    watcher.close();
    Deno.removeSync(tmpDir, { recursive: true });
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  await new Promise(() => {});
}
