import { expect } from "@std/expect";
import { discoverSlot, resolveSlot } from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import { createTestStore, makeSlot, VALID_ENV } from "./_test_utils.ts";

// --- discoverSlot ---

Deno.test("discoverSlot returns existing slot from map", async () => {
  const slot = makeSlot();
  const slots = new Map([["ns/test-agent", slot]]);
  const store = createTestStore();
  const result = await discoverSlot("ns/test-agent", slots, store);
  expect(result).toBe(slot);
});

Deno.test("discoverSlot returns null when not in map and not in store", async () => {
  const store = createTestStore();
  const result = await discoverSlot("ns/missing", new Map(), store);
  expect(result).toBe(null);
});

Deno.test("discoverSlot lazy-loads from store", async () => {
  const store = createTestStore();
  const slots = new Map<string, AgentSlot>();
  await store.putAgent({
    slug: "ns/stored-agent",
    env: VALID_ENV,
    transport: ["websocket"],
    worker: "console.log('w');",
    client: "console.log('c');",
  });
  const result = await discoverSlot("ns/stored-agent", slots, store);
  expect(result).not.toBe(null);
  expect(result!.slug).toBe("ns/stored-agent");
  expect(slots.has("ns/stored-agent")).toBe(true);
});

// --- resolveSlot ---

Deno.test("resolveSlot returns null for twilio-only slot", async () => {
  const slot = makeSlot({ transport: ["twilio"] });
  const store = createTestStore();
  const result = await resolveSlot(
    "ns/twilio-only",
    new Map([["ns/twilio-only", slot]]),
    store,
  );
  expect(result).toBe(null);
});

Deno.test("resolveSlot returns slot with websocket transport", async () => {
  const slot = makeSlot({ transport: ["websocket", "twilio"] });
  const store = createTestStore();
  const result = await resolveSlot(
    "ns/both",
    new Map([["ns/both", slot]]),
    store,
  );
  expect(result).toBe(slot);
});
