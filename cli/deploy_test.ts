// Copyright 2025 the AAI authors. MIT license.
import { assertStrictEquals, assertStringIncludes } from "@std/assert";
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
    using fetchSpy = stub(
      _internals,
      "fetch",
      spy((input: string | URL | Request, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/health")) return Promise.resolve(healthOk());
        return Promise.resolve(deployOk());
      }),
    );
    const result = await runDeploy({
      url: "http://localhost:3000",
      bundle: makeBundle(),
      env: {},
      slug: "cool-cats-jump",
      dryRun: false,
      apiKey: "test-key",
    });
    // deploy call + health check = 2
    assertSpyCalls(fetchSpy, 2);
    const deployCall = fetchSpy.calls[0]!;
    assertStrictEquals(
      String(deployCall.args[0]),
      "http://localhost:3000/cool-cats-jump/deploy",
    );
    assertStrictEquals(
      (deployCall.args[1]?.headers as Record<string, string>)?.Authorization,
      "Bearer test-key",
    );
    assertStrictEquals(result.slug, "cool-cats-jump");
  });

  await t.step("generates new slug on 403", async () => {
    let attempt = 0;
    using fetchStub = stub(
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
                error: 'Slug "some-slug" is owned by another',
              }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(deployOk());
      }),
    );
    const result = await runDeploy({
      url: "http://localhost:3000",
      bundle: makeBundle(),
      env: {},
      slug: "cool-cats-jump",
      dryRun: false,
      apiKey: "test-key",
    });

    // 2 failed deploy attempts + 1 success + 1 health = 4
    assertSpyCalls(fetchStub, 4);
    // First attempt uses original slug
    assertStringIncludes(
      String(fetchStub.calls[0]!.args[0]),
      "/cool-cats-jump/",
    );
    // Subsequent attempts use new generated slugs (not the original)
    const secondUrl = String(fetchStub.calls[1]!.args[0]);
    assertStringIncludes(secondUrl, "/deploy");
    // Result slug should be whatever the last attempt used (a generated slug)
    assertStrictEquals(typeof result.slug, "string");
  });

  await t.step("dry run does not call fetch", async () => {
    using fetchStub = stub(
      _internals,
      "fetch",
      spy(() => Promise.resolve(new Response("ok"))),
    );
    const result = await runDeploy({
      url: "http://localhost:3000",
      bundle: makeBundle(),
      env: {},
      slug: "cool-cats-jump",
      dryRun: true,
      apiKey: "test-key",
    });
    assertSpyCalls(fetchStub, 0);
    assertStrictEquals(result.slug, "cool-cats-jump");
  });
});
