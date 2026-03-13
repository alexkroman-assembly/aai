// Copyright 2025 the AAI authors. MIT license.
import { assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { discoverSlot, resolveSlot } from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, makeSlot, VALID_ENV } from "./_test_utils.ts";

// --- discoverSlot ---

Deno.test("discoverSlot returns existing slot from map", async () => {
  const slot = makeSlot();
  const slots = new Map([["test-agent", slot]]);
  const store = createTestStore();
  const result = await discoverSlot("test-agent", { slots, store });
  assertStrictEquals(result, slot);
});

Deno.test("discoverSlot returns null when not in map and not in store", async () => {
  const store = createTestStore();
  const result = await discoverSlot("missing-agent", {
    slots: new Map(),
    store,
  });
  assertStrictEquals(result, null);
});

Deno.test("discoverSlot lazy-loads from store", async () => {
  const store = createTestStore();
  const slots = new Map<string, AgentSlot>();
  await store.putAgent({
    slug: "stored-agent",
    env: VALID_ENV,
    transport: ["websocket"],
    worker: "console.log('w');",
    html: "<html></html>",
    credential_hashes: ["hash1"],
  });
  const result = await discoverSlot("stored-agent", { slots, store });
  assertNotStrictEquals(result, null);
  assertStrictEquals(result!.slug, "stored-agent");
  assertStrictEquals(slots.has("stored-agent"), true);
});

// --- resolveSlot ---

Deno.test("resolveSlot returns null for twilio-only slot", async () => {
  const slot = makeSlot({ transport: ["twilio"] });
  const store = createTestStore();
  const result = await resolveSlot("twilio-only", {
    slots: new Map([["twilio-only", slot]]),
    store,
  });
  assertStrictEquals(result, null);
});

Deno.test("resolveSlot returns slot with websocket transport", async () => {
  const slot = makeSlot({ transport: ["websocket", "twilio"] });
  const store = createTestStore();
  const result = await resolveSlot("both-transports", {
    slots: new Map([["both-transports", slot]]),
    store,
  });
  assertStrictEquals(result, slot);
});
