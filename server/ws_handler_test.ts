import { expect } from "@std/expect";
import { createSessionWSEvents } from "./ws_handler.ts";
import type { Session } from "./session.ts";
import { MockWebSocket } from "./_mock_ws.ts";
import { flush } from "./_test_utils.ts";
import { WSContext } from "hono/ws";

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

  const events = createSessionWSEvents(sessions, {
    createSession: () => spy,
    ...overrides,
  });

  // Wire WSEvents to MockWebSocket via a WSContext wrapper
  const wsContext = new WSContext({
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    raw: ws,
    get readyState() {
      return ws.readyState as 0 | 1 | 2 | 3;
    },
  });
  ws.addEventListener("open", (e) => events.onOpen!(e, wsContext));
  ws.addEventListener(
    "message",
    (e) => events.onMessage!(e as MessageEvent, wsContext),
  );
  ws.addEventListener(
    "close",
    (e) => void events.onClose!(e as CloseEvent, wsContext),
  );
  ws.addEventListener("error", (e) => events.onError!(e, wsContext));

  return { ws, sessions, spy };
}

Deno.test("creates and starts session on open", async () => {
  const { ws, sessions, spy } = setup();
  ws.open();
  await flush();
  expect(sessions.size).toBe(1);
  expect(spy.calls).toContain("start");
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
  expect(openCalled).toBe(true);
  ws.disconnect();
  await flush();
  expect(closeCalled).toBe(true);
});

Deno.test("responds to ping with pong before session is ready", () => {
  const { ws } = setup();
  ws.msg(JSON.stringify({ type: "ping" }));
  expect(ws.sentJson().some((m) => m.type === "pong")).toBe(true);
});

Deno.test("responds to ping with pong after session is ready", async () => {
  const { ws } = setup();
  ws.open();
  await flush();
  ws.sent.length = 0;
  ws.msg(JSON.stringify({ type: "ping" }));
  await flush();
  expect(ws.sentJson().some((m) => m.type === "pong")).toBe(true);
});

Deno.test("queues control messages before open and replays them", async () => {
  const { ws, spy } = setup();
  ws.msg(JSON.stringify({ type: "audio_ready" }));
  ws.open();
  await flush();
  await flush();
  expect(spy.calls).toContain("start");
  expect(spy.calls).toContain("onAudioReady");
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
  expect(spy.calls).toContain("onAudioReady");
  expect(spy.calls).toContain("onCancel");
  expect(spy.calls).toContain("onReset");
});

Deno.test("dispatches binary audio to session.onAudio", async () => {
  const { ws, spy } = setup();
  ws.open();
  await flush();
  ws.msg(new ArrayBuffer(16));
  expect(spy.calls).toContain("onAudio");
});

Deno.test("ignores invalid JSON and unknown control types", async () => {
  const { ws, spy } = setup();
  ws.open();
  await flush();
  const callsBefore = spy.calls.length;
  ws.msg("not json");
  ws.msg(JSON.stringify({ type: "bogus" }));
  await flush();
  expect(spy.calls.length).toBe(callsBefore);
});

Deno.test("stops session and removes from map on close", async () => {
  const { ws, sessions, spy } = setup();
  ws.open();
  await flush();
  expect(sessions.size).toBe(1);
  ws.disconnect();
  await flush();
  expect(spy.calls).toContain("stop");
  expect(sessions.size).toBe(0);
});

Deno.test("handles ws error without crashing", () => {
  const { ws } = setup();
  ws.error();
});
