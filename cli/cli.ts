// Copyright 2025 the AAI authors. MIT license.
import { parseArgs } from "@std/cli/parse-args";
import { error } from "./_output.ts";
import { promptUpgradeIfAvailable } from "./_update.ts";
import { runNewCommand } from "./new.ts";
import { runDeployCommand } from "./deploy.ts";
import { runEnvCommand } from "./env.ts";
import { rootHelp } from "./_help.ts";

const denoConfig = await import("./deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

// Skip update check when running via `deno run` (aai-dev) — only check for compiled binary
const isCompiled = !Deno.execPath().endsWith("deno");
if (isCompiled) {
  await promptUpgradeIfAvailable(VERSION);
}

async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args, {
    boolean: ["help", "version"],
    alias: { h: "help", V: "version" },
    stopEarly: true,
  });

  if (parsed.version) {
    console.log(VERSION);
    return;
  }

  if (parsed.help && parsed._.length === 0) {
    console.log(rootHelp(VERSION));
    return;
  }

  const [subcommand, ...rest] = parsed._;
  const subArgs = rest.map(String);

  switch (subcommand) {
    case "new":
      await runNewCommand(subArgs, VERSION);
      return;
    case "deploy":
      await runDeployCommand(subArgs, VERSION);
      return;
    case "env":
      await runEnvCommand(subArgs, VERSION);
      return;
    case "help":
      console.log(rootHelp(VERSION));
      return;
    case undefined:
      // Default: scaffold (if needed) + deploy
      await runDeployCommand(args, VERSION);
      return;
    default:
      error(`Unknown command: ${subcommand}`);
      console.log(rootHelp(VERSION));
      Deno.exit(1);
  }
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (err: unknown) {
    error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

/**
 * Entry point for the `aai` CLI. Parses top-level arguments and dispatches
 * to the appropriate subcommand (`new`, `deploy`, or `help`).
 *
 * @param args Command-line arguments (typically `Deno.args`).
 * @returns Resolves when the subcommand completes.
 * @throws If an unknown subcommand is provided or the subcommand fails.
 */
export { main };
