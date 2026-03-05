import { log } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";
import { validateAgent } from "./_validate.ts";

export interface BuildOpts {
  outDir: string;
  agentDir: string;
}

export async function runBuild(
  opts: BuildOpts,
  load: (dir: string) => Promise<AgentEntry | null> = loadAgent,
  bundle = bundleAgent,
  validate = validateAgent,
): Promise<void> {
  const agent = await load(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} — needs agent.ts + agent.json`,
    );
  }

  log.step("Check", agent.slug);
  const validation = await validate(agent);
  if (validation.errors.length > 0) {
    for (const e of validation.errors) {
      log.error(`${e.field}: ${e.message}`);
    }
    throw new Error("agent validation failed — fix the errors above");
  }

  const outDir = `${opts.outDir}/${agent.slug}`;
  await bundle(agent, outDir);
  log.step("Bundle", agent.slug);
}
