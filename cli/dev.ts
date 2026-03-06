import { debounce } from "@std/async/debounce";
import { dirname, fromFileUrl, join } from "@std/path";
import { log } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent, BundleError, warmNpmCache } from "./_bundler.ts";
import { validateAgent, type ValidationResult } from "./_validate.ts";
import { generateTypes } from "./types.ts";

export interface DevOpts {
  agentDir: string;
  serverUrl: string;
  watch?: boolean;
  openBrowser?: boolean;
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
    log.stepInfo("App", `${serverUrl}/${agent.slug}/`);
    const wsBase = serverUrl.replace(/^http/, "ws");
    log.stepInfo("WS", `${wsBase}/${agent.slug}/websocket`);
  }
  if (agent.transport.includes("twilio")) {
    log.stepInfo("Twilio", `${serverUrl}/twilio/${agent.slug}/voice`);
  }

  console.log();
  log.stepInfo("Agent", validation.name ?? agent.slug);
  if (validation.voice) {
    log.stepInfo("Voice", validation.voice);
  }
  if (tools.length > 0) {
    log.stepInfo("Tools", tools.join(", "));
  }
  const envKeys = Object.keys(agent.env);
  if (envKeys.length > 0) {
    log.stepInfo("Secrets", envKeys.join(", "));
  }

  // List project files
  const files: string[] = [];
  for (const name of ["agent.ts", "agent.json", "client.tsx", ".env"]) {
    try {
      await Deno.stat(join(agent.dir, name));
      files.push(name);
    } catch { /* not present */ }
  }
  if (files.length > 0) {
    log.stepInfo("Files", files.join(", "));
  }
  log.stepInfo("Docs", "CLAUDE.md — aai agent API reference");
  log.stepInfo("GitHub", "https://github.com/alexkroman/aai");
}

/** Run `deno check` on agent files and return any diagnostics. */
async function typeCheck(agent: AgentEntry): Promise<string | null> {
  const files = [join(agent.dir, "types.d.ts"), agent.entryPoint];
  if (agent.clientEntry.startsWith(agent.dir)) {
    files.push(agent.clientEntry);
  }
  const cmd = new Deno.Command("deno", {
    args: ["check", ...files],
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stderr } = await cmd.output();
  if (success) return null;
  // Strip Deno's "Check file://..." progress lines, keep only errors
  return new TextDecoder().decode(stderr)
    .split("\n")
    // deno-lint-ignore no-control-regex
    .filter((l) => !l.replace(/\x1b\[[0-9;]*m/g, "").match(/^\s*Check\s/))
    .join("\n")
    .trim();
}

/** Validate, bundle, and deploy an agent. */
async function buildAndDeploy(
  agent: AgentEntry,
  serverUrl: string,
  tmpDir: string,
): Promise<ValidationResult> {
  log.step("Check", agent.slug);

  const diagnostics = await typeCheck(agent);
  if (diagnostics) {
    console.error(diagnostics);
    throw new Error("type check failed — fix the errors above");
  }

  const validation = await validateAgent(agent);
  if (validation.errors.length > 0) {
    for (const e of validation.errors) {
      log.error(`${e.field}: ${e.message}`);
    }
    throw new Error("agent validation failed — fix the errors above");
  }

  log.step("Bundle", agent.slug);
  try {
    await bundleAgent(agent, `${tmpDir}/${agent.slug}`);
  } catch (err) {
    if (err instanceof BundleError) {
      console.error(err.message);
      throw new Error("bundle failed — fix the errors above");
    }
    throw err;
  }
  log.step("Deploy", agent.slug);
  await deploy(serverUrl, tmpDir, agent.slug, agent.env.ASSEMBLYAI_API_KEY);

  return validation;
}

export async function runDev(opts: DevOpts): Promise<void> {
  let agent: AgentEntry;
  try {
    const result = await loadAgent(opts.agentDir);
    if (!result) {
      log.error("no agent found — needs agent.ts + agent.json");
      throw new Error("missing agent files");
    }
    agent = result;

    // Always regenerate types.d.ts (auto-generated); write tsconfig.json if missing
    await generateTypes(opts.agentDir);

    // Write CLAUDE.md if missing
    const claudePath = join(opts.agentDir, "CLAUDE.md");
    try {
      await Deno.stat(claudePath);
    } catch {
      const cliDir = dirname(fromFileUrl(import.meta.url));
      const srcClaude = join(cliDir, "claude.md");
      await Deno.copyFile(srcClaude, claudePath);
      log.step(
        "Wrote",
        "CLAUDE.md — read this file for the aai agent API reference",
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message === "missing agent files") {
      throw err;
    }
    log.error(err instanceof Error ? err.message : String(err));
    throw new Error("failed to load agent — fix the errors above");
  }

  const tmpDir = await Deno.makeTempDir({ prefix: "aai-dev-" });

  const spinner = log.spinner("Setup", "preparing bundler...");
  await warmNpmCache();
  spinner.stop();

  const validation = await buildAndDeploy(agent, opts.serverUrl, tmpDir);
  log.step("Ready", agent.slug);
  await printSummary(agent, validation, opts.serverUrl);

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

  // Watch for file changes → rebuild and redeploy
  log.stepInfo("Watch", "for changes...");

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
      );
      log.step("Ready", freshAgent.slug);
      await printSummary(freshAgent, freshValidation, opts.serverUrl);
    } catch (err: unknown) {
      log.error(err instanceof Error ? err.message : String(err));
    } finally {
      building = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild();
      }
    }
  }, 300);

  (async () => {
    for await (const event of watcher) {
      const hasRelevantChange = event.paths.some((p) =>
        WATCHED_EXTENSIONS.some((ext) => p.endsWith(ext))
      );
      if (!hasRelevantChange) continue;
      if (event.paths.every((p) => p.includes("_test.ts"))) continue;
      rebuild();
    }
  })();

  const cleanup = () => {
    watcher.close();
    Deno.removeSync(tmpDir, { recursive: true });
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);

  await new Promise(() => {});
}
