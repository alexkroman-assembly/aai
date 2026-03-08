import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { ensureClaudeMd } from "./_discover.ts";

export async function runNewCommand(
  args: string[],
): Promise<number> {
  const flags = parseArgs(args, {
    string: ["template"],
    alias: { h: "help", t: "template" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai new"))} — Scaffold a new agent project

${bold("USAGE:")}
  ${cyan("aai new")}                    Create agent in current directory
  ${cyan("aai new")} ${dim("<dir>")}              Create agent in <dir>

${bold("OPTIONS:")}
  ${cyan("-t, --template")} ${
        dim("<name>")
      }    Template to use (default: simple)
  ${cyan("-h, --help")}               Show this help message
`,
    );
    return 0;
  }

  const cwd = flags._[0]
    ? String(flags._[0])
    : (Deno.env.get("INIT_CWD") || Deno.cwd());

  if (await exists(join(cwd, "agent.ts"))) {
    console.log("agent.ts already exists in this directory.");
    return 1;
  }

  const cliDir = dirname(fromFileUrl(import.meta.url));
  const templatesDir = join(cliDir, "..", "templates");
  const { listTemplates, runNew } = await import("./new.ts");

  const template = flags.template || "simple";
  await runNew({
    targetDir: cwd,
    template,
    templatesDir,
  });

  const templates = await listTemplates(templatesDir);

  console.log(`\n${bold("Templates:")}`);
  for (const t of templates) {
    const marker = t === template ? green("●") : dim("○");
    console.log(`  ${marker} ${t === template ? bold(t) : t}`);
  }
  console.log(
    dim(
      `\n  Re-run with --template <name> to start from a different template\n`,
    ),
  );

  await ensureClaudeMd(cwd);

  console.log(`Run ${cyan("aai dev")} to start developing.\n`);

  return 0;
}
