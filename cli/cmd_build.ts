import { Command } from "@cliffy/command";
import { runBuild } from "./build.ts";
import { ensureTypescriptSetup } from "./_discover.ts";

export const buildCommand: Command = new Command()
  .description("Validate and bundle the agent")
  .action(async () => {
    const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
    await ensureTypescriptSetup(cwd);
    await runBuild({ agentDir: cwd });
  }) as unknown as Command;
