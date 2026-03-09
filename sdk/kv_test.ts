import { assertEquals, assertThrows } from "@std/assert";
import { createKv } from "./kv.ts";
import { FakeTime } from "@std/testing/time";

Deno.test("createKv memory fallback", async (t) => {
  await t.step("returns memory client when env vars are missing", () => {
    const kv = createKv({ env: {} });
    assertEquals(typeof kv.get, "function");
    assertEquals(typeof kv.set, "function");
    assertEquals(typeof kv.del, "function");
    assertEquals(typeof kv.keys, "function");
  });

  await t.step("get returns null for missing key", async () => {
    const kv = createKv({ env: {} });
    assertEquals(await kv.get("nope"), null);
  });

  await t.step("set then get", async () => {
    const kv = createKv({ env: {} });
    await kv.set("k1", "v1");
    assertEquals(await kv.get("k1"), "v1");
  });

  await t.step("del removes key", async () => {
    const kv = createKv({ env: {} });
    await kv.set("k1", "v1");
    await kv.del("k1");
    assertEquals(await kv.get("k1"), null);
  });

  await t.step("keys lists all keys", async () => {
    const kv = createKv({ env: {} });
    await kv.set("a", "1");
    await kv.set("b", "2");
    await kv.set("c", "3");
    const keys = (await kv.keys()).sort();
    assertEquals(keys, ["a", "b", "c"]);
  });

  await t.step("keys filters by pattern", async () => {
    const kv = createKv({ env: {} });
    await kv.set("user:1", "alice");
    await kv.set("user:2", "bob");
    await kv.set("post:1", "hello");
    const keys = (await kv.keys("user:*")).sort();
    assertEquals(keys, ["user:1", "user:2"]);
  });

  await t.step("keys with ? pattern", async () => {
    const kv = createKv({ env: {} });
    await kv.set("a1", "x");
    await kv.set("a2", "y");
    await kv.set("ab", "z");
    const keys = (await kv.keys("a?")).sort();
    assertEquals(keys, ["a1", "a2", "ab"]);
  });

  await t.step("rejects oversized values", () => {
    const kv = createKv({ env: {} });
    const big = "x".repeat(65_537);
    assertThrows(
      () => kv.set("big", big),
      Error,
      "exceeds max size",
    );
  });

  await t.step("TTL expires entries", async () => {
    using time = new FakeTime();
    const kv = createKv({ env: {} });
    await kv.set("temp", "val", 10);
    assertEquals(await kv.get("temp"), "val");

    time.tick(11_000);
    assertEquals(await kv.get("temp"), null);
  });

  await t.step("TTL=0 does not expire", async () => {
    using time = new FakeTime();
    const kv = createKv({ env: {} });
    await kv.set("perm", "val", 0);

    time.tick(100_000);
    assertEquals(await kv.get("perm"), "val");
  });

  await t.step("expired keys excluded from keys()", async () => {
    using time = new FakeTime();
    const kv = createKv({ env: {} });
    await kv.set("alive", "1");
    await kv.set("dying", "2", 5);

    time.tick(6_000);
    assertEquals(await kv.keys(), ["alive"]);
  });

  await t.step("overwrite replaces value", async () => {
    const kv = createKv({ env: {} });
    await kv.set("k", "v1");
    await kv.set("k", "v2");
    assertEquals(await kv.get("k"), "v2");
  });

  await t.step("separate createKv calls have isolated stores", async () => {
    const kv1 = createKv({ env: {} });
    const kv2 = createKv({ env: {} });
    await kv1.set("x", "from1");
    assertEquals(await kv2.get("x"), null);
  });
});
