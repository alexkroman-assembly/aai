import { expect } from "@std/expect";
import { join } from "@std/path";
import { exists } from "@std/fs/exists";
import { runBuild } from "./build.ts";

Deno.test(
  { name: "runBuild", sanitizeOps: false, sanitizeResources: false },
  async (t) => {
    await t.step("validates and bundles agent from agentDir", async () => {
      const tmpOut = await Deno.makeTempDir({ prefix: "aai-build-test-" });
      const agentDir = join(
        new URL("../templates/simple", import.meta.url).pathname,
      );

      try {
        await runBuild({ outDir: tmpOut, agentDir });

        // Find the slug from the template's agent.json
        const agentJson = JSON.parse(
          await Deno.readTextFile(join(agentDir, "agent.json")),
        );
        const slug = agentJson.slug;
        const outDir = join(tmpOut, slug);

        expect(await exists(join(outDir, "worker.js"))).toBe(true);
        expect(await exists(join(outDir, "client.js"))).toBe(true);
        expect(await exists(join(outDir, "manifest.json"))).toBe(true);
      } finally {
        await Deno.remove(tmpOut, { recursive: true });
      }
    });
  },
);
