import { assertEquals, assertStringIncludes } from "@std/assert";
import { createOrchestrator } from "./orchestrator.ts";
import { createTestStore, DUMMY_INFO } from "./_test_utils.ts";

Deno.test("createOrchestrator", async (t) => {
  await t.step("returns landing page for root path", async () => {
    using store = createTestStore();
    const { handler } = await createOrchestrator({ store });
    const res = await handler(new Request("http://localhost/"), DUMMY_INFO);
    assertEquals(res.status, 200);
    assertStringIncludes(await res.text(), "</html>");
  });

  await t.step("returns 404 for unknown agent slug", async () => {
    using store = createTestStore();
    const { handler } = await createOrchestrator({ store });
    const res = await handler(
      new Request("http://localhost/nonexistent"),
      DUMMY_INFO,
    );
    assertEquals(res.status, 404);
  });

  await t.step("returns 404 for unknown nested path", async () => {
    using store = createTestStore();
    const { handler } = await createOrchestrator({ store });
    const res = await handler(
      new Request("http://localhost/foo/bar/baz"),
      DUMMY_INFO,
    );
    assertEquals(res.status, 404);
  });

  await t.step("still serves /health", async () => {
    using store = createTestStore();
    const { handler } = await createOrchestrator({ store });
    const res = await handler(
      new Request("http://localhost/health"),
      DUMMY_INFO,
    );
    assertEquals(res.status, 200);
  });
});
