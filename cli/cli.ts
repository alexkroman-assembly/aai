import { Command } from "@cliffy/command";
import { error } from "./_output.ts";
import { promptUpgradeIfAvailable } from "./_update.ts";
import { newCommand } from "./new.ts";
import { deployCommand } from "./deploy.ts";
import { rootHelp, subcommandHelp } from "./_help.ts";

const denoConfig = await import("./deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

// Skip update check when running via `deno run` (aai-dev) — only check for compiled binary
const isCompiled = !Deno.execPath().endsWith("deno");
if (isCompiled) {
  await promptUpgradeIfAvailable(VERSION);
}

// Apply themed help to each subcommand
for (
  const cmd of [
    newCommand,
    deployCommand,
  ]
) {
  cmd.help(subcommandHelp);
}

const cli: Command = new Command()
  .name("aai")
  .version(VERSION)
  .description("Voice agent development kit")
  .help(rootHelp)
  .default("new")
  .command("new", newCommand)
  .command("deploy", deployCommand) as unknown as Command;

if (import.meta.main) {
  try {
    await cli.parse(Deno.args);
  } catch (err: unknown) {
    error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

export { cli };
