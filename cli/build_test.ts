import { expect } from "@std/expect";
import { runBuild } from "./build.ts";
import type { AgentEntry } from "./_discover.ts";

const fakeAgent: AgentEntry = {
  slug: "test-agent",
  dir: "templates/test-agent",
  entryPoint: "templates/test-agent/agent.ts",
  env: { SLUG: "test-agent" },
  clientEntry: "ui/client.tsx",
  transport: ["websocket"],
  hasNpmDeps: false,
};

Deno.test("runBuild", async (t) => {
  await t.step("bundles the agent from agentDir", async () => {
    const bundled: string[] = [];

    await runBuild(
      { outDir: "dist/bundle", agentDir: "templates/test-agent" },
      () => Promise.resolve(fakeAgent),
      (agent, _outDir) => {
        bundled.push(agent.slug);
        return Promise.resolve({ workerBytes: 1024, clientBytes: 512 });
      },
      () => Promise.resolve({ errors: [] }),
    );
    expect(bundled).toEqual(["test-agent"]);
  });

  await t.step("bundles into the specified output directory", async () => {
    const dirs: string[] = [];

    await runBuild(
      { outDir: "/custom/path", agentDir: "templates/test-agent" },
      () => Promise.resolve(fakeAgent),
      (_agent, outDir) => {
        dirs.push(outDir);
        return Promise.resolve({ workerBytes: 100, clientBytes: 100 });
      },
      () => Promise.resolve({ errors: [] }),
    );
    expect(dirs).toEqual(["/custom/path/test-agent"]);
  });
});
