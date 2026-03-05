import { log } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent } from "./_bundler.ts";

export interface BuildOpts {
  outDir: string;
  agentDir: string;
}

export async function runBuild(
  opts: BuildOpts,
  load: (dir: string) => Promise<AgentEntry | null> = loadAgent,
  bundle = bundleAgent,
): Promise<void> {
  const agent = await load(opts.agentDir);
  if (!agent) {
    throw new Error(
      `no agent found in ${opts.agentDir} — needs agent.ts + agent.json`,
    );
  }

  const outDir = `${opts.outDir}/${agent.slug}`;
  await bundle(agent, outDir);
  log.step("Bundle", agent.slug);
}
