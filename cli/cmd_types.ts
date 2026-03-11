import { Command } from "@cliffy/command";
import { ensureClaudeMd, ensureTypescriptSetup } from "./_discover.ts";

export const typesCommand: Command = new Command()
  .description("Set up TypeScript tooling for an existing agent")
  .action(async () => {
    const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
    await ensureClaudeMd(cwd);
    await ensureTypescriptSetup(cwd);
  }) as unknown as Command;
