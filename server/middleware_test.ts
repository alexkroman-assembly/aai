import { expect } from "@std/expect";
import { createOrchestrator } from "./orchestrator.ts";
import { createTestStore, DUMMY_INFO } from "./_test_utils.ts";

Deno.test("orchestrator adds Cross-Origin-Isolation headers", async () => {
  using store = createTestStore();
  const { handler } = createOrchestrator({ store });
  const res = await handler(
    new Request("http://localhost/health"),
    DUMMY_INFO,
  );
  expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe(
    "credentialless",
  );
});

Deno.test("orchestrator returns 400 on deploy without auth", async () => {
  using store = createTestStore();
  const { handler } = createOrchestrator({ store });
  const res = await handler(
    new Request("http://localhost/ns/agent/deploy", { method: "POST" }),
    DUMMY_INFO,
  );
  expect(res.status).toBe(400);
});
