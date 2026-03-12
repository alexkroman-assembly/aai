import { Command } from "@cliffy/command";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { brightBlue } from "@std/fmt/colors";
import { ensureClaudeMd, ensureTypescriptSetup } from "./_discover.ts";

export const newCommand: Command = new Command()
  .description("Scaffold a new agent project")
  .arguments("[dir:string]")
  .option("-n, --name <name:string>", "Agent name")
  .option("-t, --template <template:string>", "Template to use")
  .option("-f, --force", "Overwrite existing agent.ts")
  .action(async ({ name, template, force }, dir) => {
    const cwd = dir ?? (Deno.env.get("INIT_CWD") || Deno.cwd());

    if (!force && await exists(join(cwd, "agent.ts"))) {
      console.log(
        `agent.ts already exists in this directory. Use ${
          brightBlue("--force")
        } to overwrite.`,
      );
      Deno.exit(1);
    }

    const cliDir = dirname(fromFileUrl(import.meta.url));
    const templatesDir = join(cliDir, "..", "templates");
    const { runNew } = await import("./_new.ts");

    if (!template) {
      template = "simple";
    }

    await runNew({ targetDir: cwd, template, templatesDir, name });
    await ensureClaudeMd(cwd);
    await ensureTypescriptSetup(cwd);

    console.log(`Run ${brightBlue("aai deploy")} to deploy to production.\n`);
  }) as unknown as Command;
