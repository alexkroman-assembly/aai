// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStrictEquals } from "@std/assert";
import { wireSessionSocket } from "./ws_handler.ts";
import type { Session } from "./session.ts";
import { MockWebSocket } from "@aai/sdk/testing";
import { flush } from "./_test_utils.ts";

function createSpySession(): Session & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start() {
      calls.push("start");
      return Promise.resolve();
    },
    stop() {
      calls.push("stop");
      return Promise.resolve();
    },
    onAudioReady() {
      calls.push("onAudioReady");
    },
    onAudio(_data: Uint8Array) {
      calls.push("onAudio");
    },
    onCancel() {
      calls.push("onCancel");
    },
    onReset() {
      calls.push("onReset");
    },
    onHistory() {
      calls.push("onHistory");
    },
    waitForTurn() {
      return Promise.resolve();
    },
  };
}

function setup(overrides?: { onOpen?: () => void; onClose?: () => void }) {
  const ws = new MockWebSocket("ws://test");
  const sessions = new Map<string, Session>();
  const spy = createSpySession();

  wireSessionSocket(ws as unknown as WebSocket, {
    sessions,
    createSession: () => spy,
    ...overrides,
  });

  return { ws, sessions, spy };
}

Deno.test("creates and starts session on open", async () => {
  const { ws, sessions, spy } = setup();
  ws.open();
  await flush();
  assertStrictEquals(sessions.size, 1);
  assert(spy.calls.includes("start"));
});

Deno.test("calls onOpen/onClose callbacks", async () => {
  let openCalled = false;
  let closeCalled = false;
  const { ws } = setup({
    onOpen: () => {
      openCalled = true;
    },
    onClose: () => {
      closeCalled = true;
    },
  });
  ws.open();
  await flush();
  assertStrictEquals(openCalled, true);
  ws.disconnect();
  await flush();
  assertStrictEquals(closeCalled, true);
});

Deno.test("responds to ping with pong before session is ready", () => {
  const { ws } = setup();
  ws.msg(JSON.stringify({ type: "ping" }));
  assertStrictEquals(ws.sentJson().some((m) => m.type === "pong"), true);
});

Deno.test("responds to ping with pong after session is ready", async () => {
  const { ws } = setup();
  ws.open();
  await flush();
  ws.sent.length = 0;
  ws.msg(JSON.stringify({ type: "ping" }));
  await flush();
  assertStrictEquals(ws.sentJson().some((m) => m.type === "pong"), true);
});

Deno.test("queues control messages before open and replays them", async () => {
  const { ws, spy } = setup();
  ws.msg(JSON.stringify({ type: "audio_ready" }));
  ws.open();
  await flush();
  await flush();
  assert(spy.calls.includes("start"));
  assert(spy.calls.includes("onAudioReady"));
});

Deno.test("dispatches audio_ready, cancel, reset to session", async () => {
  const { ws, spy } = setup();
  ws.open();
  await flush();
  await flush();
  ws.msg(JSON.stringify({ type: "audio_ready" }));
  ws.msg(JSON.stringify({ type: "cancel" }));
  ws.msg(JSON.stringify({ type: "reset" }));
  await flush();
  assert(spy.calls.includes("onAudioReady"));
  assert(spy.calls.includes("onCancel"));
  assert(spy.calls.includes("onReset"));
});

Deno.test("dispatches binary audio to session.onAudio", async () => {
  const { ws, spy } = setup();
  ws.open();
  await flush();
  ws.msg(new ArrayBuffer(16));
  assert(spy.calls.includes("onAudio"));
});

Deno.test("ignores invalid JSON and unknown control types", async () => {
  const { ws, spy } = setup();
  ws.open();
  await flush();
  const callsBefore = spy.calls.length;
  ws.msg("not json");
  ws.msg(JSON.stringify({ type: "bogus" }));
  await flush();
  assertStrictEquals(spy.calls.length, callsBefore);
});

Deno.test("stops session and removes from map on close", async () => {
  const { ws, sessions, spy } = setup();
  ws.open();
  await flush();
  assertStrictEquals(sessions.size, 1);
  ws.disconnect();
  await flush();
  assert(spy.calls.includes("stop"));
  assertStrictEquals(sessions.size, 0);
});

Deno.test("handles ws error without crashing", () => {
  const { ws } = setup();
  ws.error();
});
