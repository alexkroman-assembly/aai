// Copyright 2025 the AAI authors. MIT license.
import { join } from "@std/path";
import { error as logError, step } from "./_output.ts";
import { type AgentEntry, denoExec, loadAgent } from "./_discover.ts";
import { bundleAgent, BundleError, type BundleOutput } from "./_bundler.ts";

export type { BundleOutput } from "./_bundler.ts";

/** Result of a successful agent build, containing the discovered agent metadata and bundled output. */
export type BuildResult = {
  agent: AgentEntry;
  bundle: BundleOutput;
};

/** Options for {@linkcode runBuild}. */
export type BuildOpts = {
  /** Absolute path to the directory containing `agent.ts`. */
  agentDir: string;
};

/**
 * Writes build artifacts to the `.aai/build/` directory inside the agent
 * project, similar to how Next.js writes to `.next/`.
 */
async function writeBuildOutput(
  agentDir: string,
  bundle: BundleOutput,
): Promise<void> {
  const buildDir = join(agentDir, ".aai", "build");
  await Deno.mkdir(buildDir, { recursive: true });
  await Promise.all([
    Deno.writeTextFile(join(buildDir, "worker.js"), bundle.worker),
    Deno.writeTextFile(join(buildDir, "manifest.json"), bundle.manifest),
    Deno.writeTextFile(join(buildDir, "index.html"), bundle.html),
  ]);
}

/**
 * Run `deno check`, `deno lint`, and `deno fmt --check` on the agent project.
 * Fails the build on any errors.
 */
async function checkAgent(agentDir: string): Promise<void> {
  // Only check user files, not node_modules or .aai/
  const userFiles = ["agent.ts"];
  for (const f of ["client.tsx", "components.tsx"]) {
    try {
      await Deno.stat(join(agentDir, f));
      userFiles.push(f);
    } catch {
      // file doesn't exist
    }
  }
  const checks = [
    { args: ["check", ...userFiles], label: "Type-check" },
    { args: ["lint", ...userFiles], label: "Lint" },
    { args: ["fmt", "--check", ...userFiles], label: "Format" },
  ];
  for (const { args, label } of checks) {
    const cmd = new Deno.Command(denoExec(), {
      args,
      cwd: agentDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stderr } = await cmd.output();
    if (code !== 0) {
      const msg = new TextDecoder().decode(stderr).trim();
      logError(`${label}: ${msg}`);
      throw new Error(`${label} failed — fix the errors above`);
    }
  }
}

/**
 * Discovers the agent in the given directory and bundles it into deployable
 * JavaScript artifacts (worker + client).
 *
 * @param opts Build options specifying the agent directory.
 * @returns The discovered agent metadata and bundle output.
 * @throws If no `agent.ts` is found or the bundle fails.
 */
export async function runBuild(opts: BuildOpts): Promise<BuildResult> {
  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error("No agent found — run `aai new` first");
  }

  step("Check", agent.slug);
  await checkAgent(opts.agentDir);

  step("Bundle", agent.slug);
  let bundle: BundleOutput;
  try {
    bundle = await bundleAgent(agent);
  } catch (err) {
    if (err instanceof BundleError) {
      logError(err.message);
      throw new Error("Bundle failed — fix the errors above");
    }
    throw err;
  }

  await writeBuildOutput(opts.agentDir, bundle);

  return { agent, bundle };
}
