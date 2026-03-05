import { expect } from "@std/expect";
import { runDeploy } from "./deploy.ts";

function mockReadTextFile(path: string | URL): Promise<string> {
  const p = String(path);
  if (p.endsWith("manifest.json")) {
    return Promise.resolve(
      JSON.stringify({ slug: "agent-a", env: { SLUG: "agent-a" } }),
    );
  }
  return Promise.resolve("// js content");
}

Deno.test("runDeploy", async (t) => {
  await t.step("deploys all bundles found in bundleDir", async () => {
    const fetched: { url: string; authHeader: string | null }[] = [];
    const doFetch: typeof globalThis.fetch = (input, init) => {
      const url = String(input);
      // Mock health check endpoint
      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", slug: "agent-a" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      fetched.push({
        url,
        authHeader:
          (init?.headers as Record<string, string>)?.["Authorization"] ?? null,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };

    await runDeploy(
      {
        url: "http://localhost:3000",
        bundleDir: "dist/bundle",
        slug: "agent-a",
        dryRun: false,
        apiKey: "test-key",
      },
      doFetch,
      mockReadTextFile,
    );
    expect(fetched[0].url).toBe("http://localhost:3000/deploy");
    expect(fetched[0].authHeader).toBe("Bearer test-key");
  });

  await t.step("dry run does not call fetch", async () => {
    let fetchCalled = false;
    const doFetch: typeof globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve(new Response("ok"));
    };

    await runDeploy(
      {
        url: "http://localhost:3000",
        bundleDir: "dist/bundle",
        slug: "agent-a",
        dryRun: true,
        apiKey: "test-key",
      },
      doFetch,
      mockReadTextFile,
    );
    expect(fetchCalled).toBe(false);
  });
});
