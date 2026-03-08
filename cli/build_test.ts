import { expect } from "@std/expect";
import { join } from "@std/path";
import { runBuild } from "./build.ts";

Deno.test(
  { name: "runBuild", sanitizeOps: false, sanitizeResources: false },
  async (t) => {
    await t.step("validates and bundles agent from agentDir", async () => {
      const agentDir = join(
        new URL("../templates/simple", import.meta.url).pathname,
      );

      const result = await runBuild({ agentDir });

      expect(result.bundle.worker.length).toBeGreaterThan(0);
      expect(result.bundle.client.length).toBeGreaterThan(0);
      expect(result.bundle.manifest.length).toBeGreaterThan(0);

      const manifest = JSON.parse(result.bundle.manifest);
      expect(manifest.config.name).toBe("Simple Assistant");
      expect(result.agent.slug).toBe("simple");
    });
  },
);
