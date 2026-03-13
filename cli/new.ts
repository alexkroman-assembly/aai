// Copyright 2025 the AAI authors. MIT license.
import { parseArgs } from "@std/cli/parse-args";
import { promptSelect } from "@std/cli/unstable-prompt-select";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { brightBlue, brightMagenta, dim } from "@std/fmt/colors";
import { ensureClaudeMd, ensureDependencies } from "./_discover.ts";
import type { SubcommandDef } from "./_help.ts";
import { subcommandHelp } from "./_help.ts";
import { listTemplates } from "./_new.ts";

/** CLI definition for the `aai new` subcommand, including name, description, arguments, and options. */
export const newCommandDef: SubcommandDef = {
  name: "new",
  description: "Scaffold a new agent project",
  args: [{ name: "dir", optional: true }],
  options: [
    { flags: "-t, --template <template>", description: "Template to use" },
    { flags: "-f, --force", description: "Overwrite existing agent.ts" },
    { flags: "-y, --yes", description: "Accept defaults (no prompts)" },
  ],
};

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  "simple": "Minimal starter with search, code, and fetch tools",
  "web-researcher": "Research assistant with web search and page visits",
  "smart-research": "Phase-based research with dynamic tool filtering",
  "memory-agent": "Persistent KV storage across conversations",
  "code-interpreter": "Writes and runs JavaScript for calculations",
  "math-buddy": "Calculations, unit conversions, dice rolls",
  "health-assistant": "Medication lookup, drug interactions, BMI",
  "personal-finance": "Currency, crypto, loans, savings projections",
  "travel-concierge": "Trip planning, weather, flights, hotels",
  "night-owl": "Movie/music/book recs by mood — custom UI",
  "dispatch-center": "911 dispatch with triage — custom UI",
  "infocom-adventure": "Zork-style text adventure — custom UI",
  "embedded-assets": "FAQ bot using embedded JSON knowledge",
  "twilio-phone": "Phone assistant with WebSocket + Twilio",
  "terminal": "STT-only mode for voice-driven commands",
};

/**
 * Interactively prompts for template selection using an arrow-key menu.
 * "simple" is listed first as the default.
 */
function selectTemplate(available: string[]): string {
  // Put "simple" first since it's the default
  const sorted = ["simple", ...available.filter((t) => t !== "simple")];
  const maxLen = Math.max(...sorted.map((t) => t.length));
  const labels = sorted.map((name) =>
    `${brightMagenta(name.padEnd(maxLen + 2))}${
      dim(TEMPLATE_DESCRIPTIONS[name] ?? "")
    }`
  );
  const selected = promptSelect("Which template?", labels, { clear: true });
  if (!selected) return "simple";
  // Map the selected label back to the template name
  const idx = labels.indexOf(selected);
  return idx >= 0 ? sorted[idx]! : "simple";
}

/**
 * Runs the `aai new` subcommand. Scaffolds a new agent project from a template,
 * copies `CLAUDE.md`, and sets up TypeScript tooling for editor support.
 *
 * @param args Command-line arguments passed to the `new` subcommand.
 * @param version Current CLI version string, used in help output.
 * @returns The target directory where the agent was scaffolded.
 */
export async function runNewCommand(
  args: string[],
  version: string,
): Promise<string> {
  const parsed = parseArgs(args, {
    string: ["template"],
    boolean: ["force", "help", "yes"],
    alias: { t: "template", f: "force", h: "help", y: "yes" },
  });

  if (parsed.help) {
    console.log(subcommandHelp(newCommandDef, version));
    return "";
  }

  const dir = parsed._[0] as string | undefined;
  const cwd = dir ?? (Deno.env.get("INIT_CWD") || Deno.cwd());

  if (!parsed.force && await exists(join(cwd, "agent.ts"))) {
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

  // Interactive prompts when flags aren't provided (skip with -y)
  const available = await listTemplates(templatesDir);
  const template = parsed.template ||
    (parsed.yes ? "simple" : selectTemplate(available));

  await runNew({
    targetDir: cwd,
    template,
    templatesDir,
  });

  // In dev mode (running via deno, e.g. aai-dev), rewrite @aai imports
  // to point at the local monorepo source so builds use latest code.
  const isDevMode = Deno.execPath().endsWith("deno");
  if (isDevMode) {
    const monorepoRoot = join(cliDir, "..");
    const denoJsonPath = join(cwd, "deno.json");
    const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));

    // Read sub-path exports from each package's deno.json to map them all
    for (const pkg of ["sdk", "ui"]) {
      const pkgJson = JSON.parse(
        await Deno.readTextFile(join(monorepoRoot, pkg, "deno.json")),
      );
      const pkgName = pkgJson.name as string; // e.g. "@aai/sdk"
      const exports = pkgJson.exports;
      if (typeof exports === "string") {
        denoJson.imports[pkgName] = join(monorepoRoot, pkg, exports);
      } else if (typeof exports === "object") {
        for (const [subpath, target] of Object.entries(exports)) {
          const importKey = subpath === "."
            ? pkgName
            : `${pkgName}/${subpath.slice(2)}`; // "./foo" -> "@aai/sdk/foo"
          denoJson.imports[importKey] = join(
            monorepoRoot,
            pkg,
            target as string,
          );
        }
      }
    }

    await Deno.writeTextFile(
      denoJsonPath,
      JSON.stringify(denoJson, null, 2) + "\n",
    );
  }

  await ensureClaudeMd(cwd);
  await ensureDependencies(cwd);

  return cwd;
}
