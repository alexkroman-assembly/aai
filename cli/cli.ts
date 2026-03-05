import { parseArgs } from "@std/cli/parse-args";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { log } from "./_output.ts";

/** Default bundle output directory inside the user's home (~/.aai/bundles). */
function defaultBundleDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  return join(home, ".aai", "bundles");
}

const denoConfig = await import("../deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

/** Resolve the agent directory. Deno tasks set INIT_CWD to the invoking dir. */
function resolveAgentDir(): string {
  const initCwd = Deno.env.get("INIT_CWD");
  if (!initCwd) return ".";
  return relative(Deno.cwd(), initCwd) || ".";
}

function printUsage(): void {
  console.log(`${green(bold("aai"))} ${dim(VERSION)}
Agent development toolkit

${bold("USAGE:")}
    ${cyan("aai")}                Run dev server (scaffolds new agent if needed)
    ${cyan("aai")} <command>      Run a specific command

${bold("COMMANDS:")}
    ${green("deploy")}         Build and deploy agent to the orchestrator
    ${green("install-skill")}  Add the /voice-agent skill to Claude Code

${bold("OPTIONS:")}
    ${cyan("-h, --help")}       Show this help message
    ${cyan("-V, --version")}    Show version number
    ${cyan("-t, --template")} <name>  Agent template ${dim("(default: simple)")}
    ${cyan("-w, --watch")}           Watch for changes and auto-reload
    ${cyan("-u, --url")} <url>       Orchestrator URL ${
    dim("(default: https://aai-agent.fly.dev)")
  }

${bold("TEMPLATES:")}
    ${
    green("simple")
  }              General-purpose assistant with web search and code execution
    ${
    green("code-interpreter")
  }    Answers questions by writing and running JavaScript code
    ${
    green("embedded-assets")
  }     FAQ bot that searches a built-in knowledge base
    ${
    green("health-assistant")
  }    Looks up medications, drug interactions, and health info
    ${
    green("math-buddy")
  }          Math helper with calculations, conversions, and dice rolls
    ${
    green("night-owl")
  }           Evening companion for movie, music, and book recommendations
    ${
    green("personal-finance")
  }    Currency conversion, crypto prices, and loan calculations
    ${
    green("travel-concierge")
  }    Trip planning with flights, hotels, and weather lookups
    ${green("twilio-phone")}        Phone assistant for Twilio voice calls
    ${
    green("web-researcher")
  }      Research assistant that searches the web and cites sources

Run ${cyan("aai <command> --help")} for command-specific options.`);
}

/** Check if agent.ts exists in the given directory. */
async function hasAgent(dir: string): Promise<boolean> {
  try {
    await Deno.stat(join(dir, "agent.ts"));
    return true;
  } catch {
    return false;
  }
}

export async function main(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: ["url", "template"],
    alias: { u: "url", h: "help", V: "version", w: "watch", t: "template" },
    boolean: ["help", "version", "watch"],
  });
  const command = flags._[0] as string | undefined;
  const rest = args.slice(command ? 1 : 0);

  if (flags.help && !command) {
    printUsage();
    return 0;
  }

  if (flags.version) {
    console.log(VERSION);
    return 0;
  }

  if (!command) {
    const { getApiKey } = await import("./_config.ts");
    const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
    const serverUrl = flags.url || "https://aai-agent.fly.dev";

    await getApiKey();

    let isNewAgent = false;
    if (!await hasAgent(cwd)) {
      isNewAgent = true;
      console.log(`\n${green(bold("aai"))} ${dim(VERSION)}`);
      console.log("Agent development toolkit\n");

      const answer = prompt(`Set up a new agent in "${cwd}"? (Y/n)`);
      if (answer !== null && answer !== "" && answer.toLowerCase() !== "y") {
        return 0;
      }

      const cliDir = dirname(fromFileUrl(import.meta.url));
      const templatesDir = join(cliDir, "..", "templates");
      const { generateSlug } = await import("./_slug.ts");
      const { runNew } = await import("./new.ts");

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
    });

    return 0;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    switch (command) {
      case "install-skill":
        console.log(
          `${green(bold("aai install-skill"))} — Install the ${
            cyan("/voice-agent")
          } skill for Claude Code

${bold("USAGE:")}
    ${cyan("aai install-skill")}

Adds a skill so Claude Code can create and modify voice agents for you.`,
        );
        return 0;
      case "dev":
        console.log(`${green(bold("aai dev"))} — Run dev server

${bold("USAGE:")}
    ${cyan("aai dev")} ${dim("[options]")}

${bold("OPTIONS:")}
    ${cyan("-u, --url")} <url>   Orchestrator URL ${
          dim("(default: https://aai-agent.fly.dev)")
        }`);
        return 0;
      case "deploy":
        console.log(
          `${green(bold("aai deploy"))} — Deploy agent to the orchestrator

${bold("USAGE:")}
    ${cyan("aai deploy")} ${dim("[options]")}

${bold("OPTIONS:")}
    ${cyan("-u, --url")} <url>          Orchestrator URL ${
            dim("(default: https://aai-agent.fly.dev)")
          }
    ${cyan("--bundle-dir")} <dir>   Bundle directory ${
            dim("(default: ~/.aai/bundles)")
          }
    ${cyan("--dry-run")}            Show what would be deployed without sending`,
        );
        return 0;
      default:
        log.error(`unknown command '${command}'`);
        printUsage();
        return 1;
    }
  }

  switch (command) {
    case "install-skill": {
      const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
      const skillDir = join(home, ".claude", "skills", "voice-agent");
      const cliDir = dirname(fromFileUrl(import.meta.url));
      const srcSkill = join(cliDir, "..", "skills", "voice-agent", "SKILL.md");
      await Deno.mkdir(skillDir, { recursive: true });
      await Deno.copyFile(srcSkill, join(skillDir, "SKILL.md"));
      log.step("Installed", `${cyan("/voice-agent")} skill for Claude Code`);
      return 0;
    }
    case "deploy": {
      const deployFlags = parseArgs(rest, {
        boolean: ["dry-run"],
        string: ["url", "bundle-dir"],
        alias: { u: "url" },
      });
      const agentDir = resolveAgentDir();
      const bundleDir = deployFlags["bundle-dir"]
        ? join(resolveAgentDir(), deployFlags["bundle-dir"])
        : defaultBundleDir();
      const { runBuild } = await import("./build.ts");
      await runBuild({ outDir: bundleDir, agentDir });
      const { loadAgent } = await import("./_discover.ts");
      const agent = await loadAgent(agentDir);
      if (!agent) {
        log.error(
          `no agent found in ${agentDir} — needs agent.ts + agent.json`,
        );
        return 1;
      }
      const apiKey = agent.env.ASSEMBLYAI_API_KEY;
      const { runDeploy } = await import("./deploy.ts");
      await runDeploy({
        url: deployFlags.url || "https://aai-agent.fly.dev",
        bundleDir,
        slug: agent.slug,
        dryRun: !!deployFlags["dry-run"],
        apiKey,
      });
      return 0;
    }
    default:
      log.error(`unknown command '${command}'`);
      printUsage();
      return 1;
  }
}

if (import.meta.main) {
  try {
    const code = await main(Deno.args);
    if (code !== 0) Deno.exit(code);
  } catch (err: unknown) {
    log.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}
