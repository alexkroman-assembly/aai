import { Command } from "@cliffy/command";
import { error } from "./_output.ts";
import { promptUpgradeIfAvailable } from "./_update.ts";
import { newCommand } from "./cmd_new.ts";
import { buildCommand } from "./cmd_build.ts";
import { devCommand } from "./cmd_dev.ts";
import { deployCommand } from "./cmd_deploy.ts";
import { typesCommand } from "./cmd_types.ts";

const denoConfig = await import("./deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

// Skip update check when running via `deno run` (aai-dev) — only check for compiled binary
const isCompiled = !Deno.execPath().endsWith("deno");
if (isCompiled) {
  await promptUpgradeIfAvailable(VERSION);
}

const cli: Command = new Command()
  .name("aai")
  .version(VERSION)
  .description("Voice agent development kit")
  .default("new")
  .command("new", newCommand)
  .command("build", buildCommand)
  .command("dev", devCommand)
  .command("deploy", deployCommand)
  .command("types", typesCommand) as unknown as Command;

if (import.meta.main) {
  try {
    await cli.parse(Deno.args);
  } catch (err: unknown) {
    error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

export { cli };
