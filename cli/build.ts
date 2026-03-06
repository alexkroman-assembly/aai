import { error, spinner, step } from "./_output.ts";
import { loadAgent } from "./_discover.ts";
import { bundleAgent, warmNpmCache } from "./_bundler.ts";
import { validateAgent } from "./_validate.ts";

export interface BuildOpts {
  outDir: string;
  agentDir: string;
}

export async function runBuild(opts: BuildOpts): Promise<void> {
  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} -- needs agent.ts + agent.json`,
    );
  }

  step("Check", agent.slug);
  const validation = await validateAgent(agent);
  if (validation.errors.length > 0) {
    for (const e of validation.errors) {
      error(`${e.field}: ${e.message}`);
    }
    throw new Error("agent validation failed -- fix the errors above");
  }

  const sp = spinner("Setup", "preparing bundler...");
  await warmNpmCache();
  sp.stop();

  const outDir = `${opts.outDir}/${agent.slug}`;
  await bundleAgent(agent, outDir);
  step("Bundle", agent.slug);
}
