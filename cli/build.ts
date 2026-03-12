import { step } from "./_output.ts";
import { type AgentEntry, loadAgent } from "./_discover.ts";
import { bundleAgent, type BundleOutput } from "./_bundler.ts";

export type { BundleOutput } from "./_bundler.ts";

export type BuildResult = {
  agent: AgentEntry;
  bundle: BundleOutput;
};

export type BuildOpts = {
  agentDir: string;
};

export async function runBuild(opts: BuildOpts): Promise<BuildResult> {
  const agent = await loadAgent(opts.agentDir);
  if (!agent) {
    throw new Error("no agent found — run `aai new` first");
  }

  step("Bundle", agent.slug);
  let bundle: BundleOutput;
  try {
    bundle = await bundleAgent(agent);
  } catch (err) {
    if (err instanceof Error && err.name === "BundleError") {
      console.error(err.message);
      throw new Error("bundle failed — fix the errors above");
    }
    throw err;
  }

  return { agent, bundle };
}
