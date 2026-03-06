import { debounce } from "@std/async/debounce";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { error, spinner, step, stepInfo } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent, BundleError, warmNpmCache } from "./_bundler.ts";
import { validateAgent, type ValidationResult } from "./_validate.ts";
import { runDeploy } from "./deploy.ts";
import { generateTypes } from "./types.ts";

export interface DevOpts {
  agentDir: string;
  serverUrl: string;
  watch?: boolean;
  openBrowser?: boolean;
  dryRun?: boolean;
}

async function printSummary(
  agent: AgentEntry,
  validation: ValidationResult,
  serverUrl: string,
): Promise<void> {
  const tools = [
    ...(validation.builtinTools ?? []),
    ...(validation.tools ?? []),
  ];

  if (agent.transport.includes("websocket")) {
    stepInfo("App", `${serverUrl}/${agent.slug}/`);
    const wsBase = serverUrl.replace(/^http/, "ws");
    stepInfo("WS", `${wsBase}/${agent.slug}/websocket`);
  }
  if (agent.transport.includes("twilio")) {
    stepInfo("Twilio", `${serverUrl}/twilio/${agent.slug}/voice`);
  }

  console.log();
  stepInfo("Agent", validation.name ?? agent.slug);
  if (validation.voice) {
    stepInfo("Voice", validation.voice);
  }
  if (tools.length > 0) {
    stepInfo("Tools", tools.join(", "));
  }
  const envKeys = Object.keys(agent.env);
  if (envKeys.length > 0) {
    stepInfo("Secrets", envKeys.join(", "));
  }

  const files: string[] = [];
  for (const name of ["agent.ts", "agent.json", "client.tsx", ".env"]) {
    if (await exists(join(agent.dir, name))) {
      files.push(name);
    }
  }
  if (files.length > 0) {
    stepInfo("Files", files.join(", "));
  }
  stepInfo("Docs", "CLAUDE.md -- aai agent API reference");
  stepInfo("GitHub", "https://github.com/alexkroman/aai");
}

/** Validate, bundle, and optionally deploy an agent. */
async function buildAndDeploy(
  agent: AgentEntry,
  serverUrl: string,
  tmpDir: string,
  dryRun?: boolean,
): Promise<ValidationResult> {
  step("Check", agent.slug);

  const validation = await validateAgent(agent);
  if (validation.errors.length > 0) {
    for (const e of validation.errors) {
      error(`${e.field}: ${e.message}`);
    }
    throw new Error("agent validation failed -- fix the errors above");
  }

  step("Bundle", agent.slug);
  try {
    await bundleAgent(agent, `${tmpDir}/${agent.slug}`);
  } catch (err) {
    if (err instanceof BundleError) {
      console.error(err.message);
      throw new Error("bundle failed -- fix the errors above");
    }
    throw err;
  }

  if (!dryRun) {
    step("Deploy", agent.slug);
    await runDeploy({
      url: serverUrl,
      bundleDir: tmpDir,
      slug: agent.slug,
      dryRun: false,
      apiKey: agent.env.ASSEMBLYAI_API_KEY,
    });
  }

  return validation;
}

export async function runDev(opts: DevOpts): Promise<void> {
  let agent: AgentEntry;
  try {
    const result = await loadAgent(opts.agentDir);
    if (!result) {
      error("no agent found -- needs agent.ts + agent.json");
      throw new Error("missing agent files");
    }
    agent = result;

    await generateTypes(opts.agentDir);

    // Write CLAUDE.md if missing
    const claudePath = join(opts.agentDir, "CLAUDE.md");
    if (!await exists(claudePath)) {
      const cliDir = dirname(fromFileUrl(import.meta.url));
      const srcClaude = join(cliDir, "claude.md");
      await Deno.copyFile(srcClaude, claudePath);
      step(
        "Wrote",
        "CLAUDE.md -- read this file for the aai agent API reference",
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message === "missing agent files") {
      throw err;
    }
    error(err instanceof Error ? err.message : String(err));
    throw new Error("failed to load agent -- fix the errors above");
  }

  const tmpDir = await Deno.makeTempDir({ prefix: "aai-dev-" });

  const sp = spinner("Setup", "preparing bundler...");
  await warmNpmCache();
  sp.stop();

  const validation = await buildAndDeploy(
    agent,
    opts.serverUrl,
    tmpDir,
    opts.dryRun,
  );
  step(opts.dryRun ? "OK" : "Ready", agent.slug);
  if (!opts.dryRun) {
    await printSummary(agent, validation, opts.serverUrl);
  }

  if (opts.dryRun) {
    Deno.removeSync(tmpDir, { recursive: true });
    return;
  }

  // Open in browser (only for newly created agents)
  const agentUrl = `${opts.serverUrl}/${agent.slug}/`;
  if (opts.openBrowser) {
    const openCmd = Deno.build.os === "darwin"
      ? "open"
      : Deno.build.os === "windows"
      ? "start"
      : "xdg-open";
    new Deno.Command(openCmd, { args: [agentUrl] }).spawn();
  }

  if (!opts.watch) {
    Deno.removeSync(tmpDir, { recursive: true });
    return;
  }

  // Watch for file changes -> rebuild and redeploy
  stepInfo("Watch", "for changes...");

  const ac = new AbortController();
  const watcher = Deno.watchFs([agent.dir], { recursive: true });

  const WATCHED_EXTENSIONS = [
    ".ts",
    ".tsx",
    ".json",
    ".md",
    ".csv",
    ".txt",
    ".html",
  ];

  let building = false;
  let pendingRebuild = false;

  const rebuild = debounce(async () => {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    try {
      const freshAgent = await loadAgent(opts.agentDir);
      if (!freshAgent) throw new Error("agent not found after change");
      const freshValidation = await buildAndDeploy(
        freshAgent,
        opts.serverUrl,
        tmpDir,
        opts.dryRun,
      );
      step("Ready", freshAgent.slug);
      await printSummary(freshAgent, freshValidation, opts.serverUrl);
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild();
      }
    }
  }, 300);

  const cleanup = () => {
    ac.abort();
    watcher.close();
    Deno.removeSync(tmpDir, { recursive: true });
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  for await (const event of watcher) {
    if (ac.signal.aborted) break;
    const hasRelevantChange = event.paths.some((p) =>
      WATCHED_EXTENSIONS.some((ext) => p.endsWith(ext))
    );
    if (!hasRelevantChange) continue;
    if (event.paths.every((p) => p.includes("_test.ts"))) continue;
    rebuild();
  }
}
