import { bold, cyan, dim, green } from "@std/fmt/colors";
import { dirname, fromFileUrl, join } from "@std/path";
import { error } from "./_output.ts";
import { promptUpgradeIfAvailable } from "./_update.ts";

const denoConfig = await import("./deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

async function printUsage(): Promise<void> {
  const cliDir = dirname(fromFileUrl(import.meta.url));
  const templatesDir = join(cliDir, "..", "templates");
  const { listTemplates } = await import("./new.ts");
  const templates = await listTemplates(templatesDir);
  const templateList = templates.map((t) => `    ${t}`).join("\n");
  console.log(
    `${green(bold("aai"))} ${dim(VERSION)}
Voice agent development kit

${bold("COMMANDS:")}
  ${cyan("aai new")}            Scaffold a new agent project
  ${cyan("aai dev")}            Run local dev server with file watching
  ${cyan("aai deploy")}         Bundle and deploy to production

${bold("TEMPLATES:")}
  Use with ${cyan("aai new -t <template>")}:
${templateList}

${bold("OPTIONS:")}
  ${cyan("-h, --help")}         Show this help message
  ${cyan("-V, --version")}      Show version number

Run ${cyan("aai <command> --help")} for command-specific options.
`,
  );
}

export async function main(args: string[]): Promise<number> {
  const command = args[0];

  // Skip update check when running via `deno run` (aai-dev) — only check for compiled binary
  const isCompiled = !Deno.execPath().endsWith("deno");
  if (isCompiled) {
    await promptUpgradeIfAvailable(VERSION);
  }

  // Top-level flags (no subcommand)
  if (!command || command === "--help" || command === "-h") {
    await printUsage();
    return 0;
  }

  if (command === "--version" || command === "-V") {
    console.log(VERSION);
    return 0;
  }

  const subArgs = args.slice(1);

  switch (command) {
    case "new": {
      const { runNewCommand } = await import("./cmd_new.ts");
      return await runNewCommand(subArgs);
    }
    case "dev": {
      const { runDevCommand } = await import("./cmd_dev.ts");
      return await runDevCommand(subArgs);
    }
    case "deploy": {
      const { runDeployCommand } = await import("./cmd_deploy.ts");
      return await runDeployCommand(subArgs);
    }
    default: {
      error(`unknown command: ${command}`);
      await printUsage();
      return 1;
    }
  }
}

if (import.meta.main) {
  try {
    const code = await main(Deno.args);
    if (code !== 0) Deno.exit(code);
  } catch (err: unknown) {
    error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}
