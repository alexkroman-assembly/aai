import { parseArgs } from "@std/cli/parse-args";
import { bold, cyan, green } from "@std/fmt/colors";
import { error } from "./_output.ts";
import { runBuild } from "./build.ts";

export async function runBuildCommand(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    alias: { h: "help" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai build"))} — Validate and bundle the agent

${bold("USAGE:")}
  ${cyan("aai build")}

${bold("OPTIONS:")}
  ${cyan("-h, --help")}             Show this help message
`,
    );
    return 0;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();

  try {
    await runBuild({ agentDir: cwd });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  return 0;
}
