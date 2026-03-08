import { expect } from "@std/expect";
import { createTestStore, VALID_ENV } from "./_test_utils.ts";

Deno.test("TigrisBundleStore", async (t) => {
  await t.step("put + get round-trip", async () => {
    using store = createTestStore();
    await store.putAgent({
      slug: "hello",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "console.log('worker');",
      client: "console.log('client');",
    });

    const manifest = await store.getManifest("hello");
    expect(manifest).toEqual({
      slug: "hello",
      env: VALID_ENV,
      transport: ["websocket"],
    });

    const worker = await store.getFile("hello", "worker");
    expect(worker).toBe("console.log('worker');");

    const client = await store.getFile("hello", "client");
    expect(client).toBe("console.log('client');");
  });

  await t.step("deleteAgent removes all data", async () => {
    using store = createTestStore();
    await store.putAgent({
      slug: "gone",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "w",
      client: "c",
    });
    await store.deleteAgent("gone");

    expect(await store.getManifest("gone")).toBeNull();
    expect(await store.getFile("gone", "worker")).toBeNull();
    expect(await store.getFile("gone", "client")).toBeNull();
  });

  await t.step("overwrite replaces existing agent", async () => {
    using store = createTestStore();
    await store.putAgent({
      slug: "x",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "old",
      client: "old",
    });
    await store.putAgent({
      slug: "x",
      env: { ...VALID_ENV, EXTRA: "val" },
      transport: ["websocket"],
      worker: "new",
      client: "new",
    });

    const manifest = await store.getManifest("x");
    expect(manifest!.env.EXTRA).toBe("val");
    expect(await store.getFile("x", "worker")).toBe("new");
  });

  await t.step("handles large strings without chunking", async () => {
    using store = createTestStore();
    const big = "x".repeat(150_000);
    await store.putAgent({
      slug: "big",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: big,
      client: "small",
    });

    const result = await store.getFile("big", "worker");
    expect(result).toBe(big);
    expect(result!.length).toBe(150_000);
  });

  await t.step("missing slug returns null", async () => {
    using store = createTestStore();
    expect(await store.getManifest("nope")).toBeNull();
    expect(await store.getFile("nope", "worker")).toBeNull();
    expect(await store.getFile("nope", "client")).toBeNull();
  });

  await t.step("clientMap is optional", async () => {
    using store = createTestStore();
    await store.putAgent({
      slug: "nomap",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "w",
      client: "c",
    });
    expect(await store.getFile("nomap", "client_map")).toBeNull();
  });

  await t.step("stores and retrieves clientMap when provided", async () => {
    using store = createTestStore();
    await store.putAgent({
      slug: "mapped",
      env: VALID_ENV,
      transport: ["websocket"],
      worker: "w",
      client: "c",
      client_map: '{"mappings":[]}',
    });
    expect(await store.getFile("mapped", "client_map")).toBe(
      '{"mappings":[]}',
    );
  });
});
