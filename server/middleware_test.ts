import { assertEquals } from "@std/assert";
import { createOrchestrator } from "./orchestrator.ts";
import {
  createTestScopeKey,
  createTestStore,
  DUMMY_INFO,
} from "./_test_utils.ts";

Deno.test("orchestrator adds Cross-Origin-Isolation headers", async () => {
  using store = createTestStore();
  const scopeKey = await createTestScopeKey();
  const handler = createOrchestrator({ store, scopeKey });
  const res = await handler(
    new Request("http://localhost/health"),
    DUMMY_INFO,
  );
  assertEquals(res.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
  assertEquals(
    res.headers.get("Cross-Origin-Embedder-Policy"),
    "credentialless",
  );
});

Deno.test("orchestrator returns 400 on deploy without auth", async () => {
  using store = createTestStore();
  const scopeKey = await createTestScopeKey();
  const handler = createOrchestrator({ store, scopeKey });
  const res = await handler(
    new Request("http://localhost/ns/agent/deploy", { method: "POST" }),
    DUMMY_INFO,
  );
  assertEquals(res.status, 401);
});
