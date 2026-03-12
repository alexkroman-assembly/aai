import { expect } from "@std/expect";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { _internals, runDeploy } from "./_deploy.ts";
import { makeBundle } from "./_test_utils.ts";

function healthOk(): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deployOk(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("runDeploy", async (t) => {
  await t.step("deploys bundle to server", async () => {
    const fetchSpy = stub(
      _internals,
      "fetch",
      spy((input: string | URL | Request, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/health")) return Promise.resolve(healthOk());
        return Promise.resolve(deployOk());
      }),
    );
    try {
      const result = await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle(),
        namespace: "my-ns",
        slug: "agent-a",
        dryRun: false,
        apiKey: "test-key",
      });
      // deploy call + health check = 2
      assertSpyCalls(fetchSpy, 2);
      const deployCall = fetchSpy.calls[0];
      expect(String(deployCall.args[0])).toBe(
        "http://localhost:3000/my-ns/agent-a/deploy",
      );
      expect(
        (deployCall.args[1]?.headers as Record<string, string>)?.Authorization,
      ).toBe("Bearer test-key");
      expect(result.namespace).toBe("my-ns");
      expect(result.slug).toBe("agent-a");
    } finally {
      fetchSpy.restore();
    }
  });

  await t.step("auto-increments namespace on 403", async () => {
    let attempt = 0;
    const fetchStub = stub(
      _internals,
      "fetch",
      spy((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/health")) return Promise.resolve(healthOk());
        attempt++;
        if (attempt <= 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: 'Namespace "my-ns" is owned by another',
              }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(deployOk());
      }),
    );
    try {
      const result = await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle(),
        namespace: "my-ns",
        slug: "agent-a",
        dryRun: false,
        apiKey: "test-key",
      });

      // 2 failed deploy attempts + 1 success + 1 health = 4
      assertSpyCalls(fetchStub, 4);
      expect(String(fetchStub.calls[0].args[0])).toContain("/my-ns/");
      expect(String(fetchStub.calls[1].args[0])).toContain("/my-ns-1/");
      expect(String(fetchStub.calls[2].args[0])).toContain("/my-ns-2/");
      expect(result.namespace).toBe("my-ns-2");
      expect(result.slug).toBe("agent-a");
    } finally {
      fetchStub.restore();
    }
  });

  await t.step("dry run does not call fetch", async () => {
    const fetchStub = stub(
      _internals,
      "fetch",
      spy(() => Promise.resolve(new Response("ok"))),
    );
    try {
      const result = await runDeploy({
        url: "http://localhost:3000",
        bundle: makeBundle(),
        namespace: "my-ns",
        slug: "agent-a",
        dryRun: true,
        apiKey: "test-key",
      });
      assertSpyCalls(fetchStub, 0);
      expect(result.namespace).toBe("my-ns");
    } finally {
      fetchStub.restore();
    }
  });
});
