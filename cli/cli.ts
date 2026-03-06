import { parseArgs } from "@std/cli/parse-args";
import { exists } from "@std/fs/exists";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { dirname, fromFileUrl, join } from "@std/path";
import { error } from "./_output.ts";
import { promptUpgradeIfAvailable } from "./_update.ts";

const denoConfig = await import("../deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

function printUsage(): void {
  const dryRun = cyan("-n, --dry-run");
  console.log(`${green(bold("aai"))} ${dim(VERSION)}
Voice agent development kit

${bold("USAGE:")}
    ${cyan("aai")}                Run dev server (scaffolds new agent if needed)

${bold("OPTIONS:")}
    ${cyan("-h, --help")}       Show this help message
    ${cyan("-V, --version")}    Show version number
    ${cyan("-w, --watch")}      Watch for changes and auto-reload
    ${cyan("-y, --yes")}        Skip confirmation prompts (for automation)
    ${cyan("-t, --template")}   Template to use for new agents (default: simple)
    ${dryRun}    Type-check, validate, and bundle without deploying

${dim("https://github.com/alexkroman/aai")}
`);
}

export async function main(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: ["url", "template"],
    alias: {
      u: "url",
      h: "help",
      V: "version",
      w: "watch",
      y: "yes",
      t: "template",
      n: "dry-run",
    },
    boolean: ["help", "version", "watch", "yes", "dry-run"],
  });

  if (flags.help) {
    printUsage();
    return 0;
  }

  if (flags.version) {
    console.log(VERSION);
    return 0;
  }

  // Skip update check when running via `deno run` (aai-dev) — only check for compiled binary
  const isCompiled = !Deno.execPath().endsWith("deno");
  if (isCompiled) {
    await promptUpgradeIfAvailable(VERSION);
  }

  const { getApiKey } = await import("./_discover.ts");
  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const serverUrl = flags.url || "https://aai-agent.fly.dev";

  if (flags["dry-run"]) {
    if (!Deno.env.get("ASSEMBLYAI_API_KEY")) {
      Deno.env.set("ASSEMBLYAI_API_KEY", "dry-run");
    }
  } else {
    await getApiKey();
  }

  let isNewAgent = false;
  if (!await exists(join(cwd, "agent.ts"))) {
    isNewAgent = true;
    if (!flags.yes) {
      console.log(`\n${green(bold("aai"))} ${dim(VERSION)}`);
      console.log("Voice agent development kit\n");

      const answer = prompt(`Set up a new agent in "${cwd}"? (Y/n)`);
      if (answer === null) return 0;
      if (answer !== "" && answer.toLowerCase() !== "y") return 0;
    }

    const cliDir = dirname(fromFileUrl(import.meta.url));
    const templatesDir = join(cliDir, "..", "templates");
    const { generateSlug, runNew } = await import("./new.ts");

    await runNew({
      slug: generateSlug(),
      targetDir: cwd,
      template: flags.template || "simple",
      templatesDir,
    });
  }

  const { runDev } = await import("./dev.ts");
  await runDev({
    agentDir: cwd,
    serverUrl,
    watch: flags.watch,
    openBrowser: isNewAgent,
    dryRun: flags["dry-run"],
  });

  return 0;
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
