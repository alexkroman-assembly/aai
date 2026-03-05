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
    ${cyan("aai")} <command> [options]

${bold("COMMANDS:")}
    ${green("dev")}       Start development server with watch + hot-reload
    ${green("deploy")}    Build and deploy agent to the orchestrator
    ${green("types")}     Generate ambient type declarations (types.d.ts)
    ${green("skill")}     Install Claude Code skill for creating agents

${bold("OPTIONS:")}
    ${cyan("-h, --help")}       Show this help message
    ${cyan("-V, --version")}    Show version number

Run ${cyan("aai <command> --help")} for command-specific options.`);
}

export async function main(args: string[]): Promise<number> {
  const command = args[0];
  const rest = args.slice(1);

  if (command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }

  if (!command) {
    const { getApiKey } = await import("./_config.ts");

    console.log(`\n${green(bold("aai"))} ${dim(VERSION)}`);
    console.log("Agent development toolkit\n");

    // Ensure API key is configured (prompts on first use)
    await getApiKey();

    const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
    const answer = prompt(`\nSet up and deploy "${cwd}"? (Y/n)`);
    if (answer !== null && answer !== "" && answer.toLowerCase() !== "y") {
      return 0;
    }

    const cliDir = dirname(fromFileUrl(import.meta.url));
    const templatesDir = join(cliDir, "..", "templates");
    const { generateSlug } = await import("./_slug.ts");
    const { runNew } = await import("./new.ts");
    const slug = generateSlug();

    await runNew({
      slug,
      targetDir: cwd,
      template: "simple",
      templatesDir,
    });

    const { runDev } = await import("./dev.ts");
    await runDev({
      agentDir: cwd,
      serverUrl: "https://voice-agent-api.fly.dev",
    });

    return 0;
  }
  if (command === "--version" || command === "-V") {
    console.log(VERSION);
    return 0;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    switch (command) {
      case "dev":
        console.log(`${green(bold("aai dev"))} — Start development server

${bold("USAGE:")}
    ${cyan("aai dev")}

Builds and deploys your agent, then watches for file changes.
On each change, rebuilds and redeploys automatically.
Opens your agent in the browser on start.`);
        return 0;
      case "skill":
        console.log(`${green(bold("aai skill"))} — Install Claude Code skill

${bold("USAGE:")}
    ${cyan("aai skill")} install

Installs the aai agent creation skill to ~/.claude/skills/
so you can use ${cyan("/new-agent")} in Claude Code to scaffold voice agents.`);
        return 0;
      case "types":
        console.log(
          `${green(bold("aai types"))} — Generate ambient type declarations

${bold("USAGE:")}
    ${cyan("aai types")}

Generates a ${cyan("types.d.ts")} file in the current directory that declares
SDK symbols (Agent, tool, z, fetchJSON, etc.) as ambient globals.
Add ${cyan('"types": ["./types.d.ts"]')} to your deno.json compilerOptions.`,
        );
        return 0;
      case "deploy":
        console.log(
          `${green(bold("aai deploy"))} — Deploy agent to the orchestrator

${bold("USAGE:")}
    ${cyan("aai deploy")} ${dim("[options]")}

${bold("OPTIONS:")}
    ${cyan("-u, --url")} <url>          Orchestrator URL ${
            dim("(default: https://voice-agent-api.fly.dev)")
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
    case "dev": {
      const agentDir = resolveAgentDir();
      const { runDev } = await import("./dev.ts");
      await runDev({
        agentDir,
        serverUrl: "https://voice-agent-api.fly.dev",
      });
      return 0;
    }
    case "types": {
      const dir = Deno.env.get("INIT_CWD") || Deno.cwd();
      const { runTypes } = await import("./types.ts");
      await runTypes(dir);
      return 0;
    }
    case "skill": {
      const sub = rest[0];
      if (sub !== "install") {
        log.error("usage: aai skill install");
        return 1;
      }
      const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
      const skillDir = join(home, ".claude", "skills", "new-agent");
      const cliDir = dirname(fromFileUrl(import.meta.url));
      const srcSkill = join(cliDir, "..", "skills", "new-agent", "SKILL.md");
      await Deno.mkdir(skillDir, { recursive: true });
      await Deno.copyFile(srcSkill, join(skillDir, "SKILL.md"));
      log.step("Installed", `skill to ${skillDir}`);
      console.log(
        `\nUse ${cyan("/new-agent")} in Claude Code to create voice agents.`,
      );
      return 0;
    }
    case "deploy": {
      const flags = parseArgs(rest, {
        boolean: ["dry-run"],
        string: ["url", "bundle-dir"],
        alias: { u: "url" },
      });
      const agentDir = resolveAgentDir();
      const bundleDir = flags["bundle-dir"]
        ? join(resolveAgentDir(), flags["bundle-dir"])
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
        url: flags.url || "https://voice-agent-api.fly.dev",
        bundleDir,
        slug: agent.slug,
        dryRun: !!flags["dry-run"],
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
