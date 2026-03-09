import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { createMemoryKvStore } from "./kv.ts";
import type { AgentScope } from "./scope_token.ts";
import { createTokenSigner } from "./scope_token.ts";

Deno.test("TokenSigner", async (t) => {
  const scope: AgentScope = { ownerHash: "abc123", slug: "ns/my-agent" };

  await t.step("round-trips a scope", async () => {
    const signer = await createTokenSigner("test-secret");
    const token = await signer.sign(scope);
    assertEquals(await signer.verify(token), scope);
  });

  await t.step("rejects tampered token", async () => {
    const signer = await createTokenSigner("test-secret");
    const token = await signer.sign(scope);
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) +
      (token[mid] === "A" ? "B" : "A") +
      token.slice(mid + 1);
    assertEquals(await signer.verify(tampered), null);
  });

  await t.step("rejects garbage", async () => {
    const signer = await createTokenSigner("test-secret");
    assertEquals(await signer.verify("not-a-token"), null);
    assertEquals(await signer.verify(""), null);
  });

  await t.step("different scopes produce different tokens", async () => {
    const signer = await createTokenSigner("test-secret");
    const other: AgentScope = { ownerHash: "abc123", slug: "ns/other-agent" };
    assertNotEquals(await signer.sign(scope), await signer.sign(other));
  });

  await t.step("wrong key rejects token", async () => {
    const signer1 = await createTokenSigner("key-one");
    const signer2 = await createTokenSigner("key-two");
    const token = await signer1.sign(scope);
    assertEquals(await signer2.verify(token), null);
  });
});

Deno.test("MemoryKvStore", async (t) => {
  const scopeA: AgentScope = { ownerHash: "owner1", slug: "ns/agent-a" };
  const scopeB: AgentScope = { ownerHash: "owner1", slug: "ns/agent-b" };
  const scopeC: AgentScope = { ownerHash: "owner2", slug: "ns/agent-a" };

  await t.step("get returns null for missing key", async () => {
    const kv = createMemoryKvStore();
    assertEquals(await kv.get(scopeA, "missing"), null);
  });

  await t.step("set then get", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key1", "value1");
    assertEquals(await kv.get(scopeA, "key1"), "value1");
  });

  await t.step("del removes key", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key1", "value1");
    await kv.del(scopeA, "key1");
    assertEquals(await kv.get(scopeA, "key1"), null);
  });

  await t.step("keys lists all in scope", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "a", "1");
    await kv.set(scopeA, "b", "2");
    await kv.set(scopeA, "c", "3");
    assertEquals((await kv.keys(scopeA)).sort(), ["a", "b", "c"]);
  });

  await t.step("keys filters by pattern", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "user:name", "alice");
    await kv.set(scopeA, "user:age", "30");
    await kv.set(scopeA, "pref:color", "blue");
    assertEquals(
      (await kv.keys(scopeA, "user:*")).sort(),
      ["user:age", "user:name"],
    );
  });

  await t.step("different slugs are isolated", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key", "from-a");
    await kv.set(scopeB, "key", "from-b");
    assertEquals(await kv.get(scopeA, "key"), "from-a");
    assertEquals(await kv.get(scopeB, "key"), "from-b");
  });

  await t.step("different owners are isolated", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "key", "owner1");
    await kv.set(scopeC, "key", "owner2");
    assertEquals(await kv.get(scopeA, "key"), "owner1");
    assertEquals(await kv.get(scopeC, "key"), "owner2");
  });

  await t.step("keys only returns keys for given scope", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "a-key", "1");
    await kv.set(scopeB, "b-key", "2");
    assertEquals(await kv.keys(scopeA), ["a-key"]);
    assertEquals(await kv.keys(scopeB), ["b-key"]);
  });

  await t.step("rejects oversized values", () => {
    const kv = createMemoryKvStore();
    assertThrows(
      () => kv.set(scopeA, "big", "x".repeat(65_537)),
      Error,
      "max size",
    );
  });

  await t.step("TTL=0 does not expire", async () => {
    const kv = createMemoryKvStore();
    await kv.set(scopeA, "ephemeral", "still-here", 0);
    assertEquals(await kv.get(scopeA, "ephemeral"), "still-here");
  });
});
