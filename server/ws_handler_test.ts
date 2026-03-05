import { expect } from "@std/expect";
import { handleSessionWebSocket } from "./ws_handler.ts";
import type { Session } from "./session.ts";
import { MockWebSocket } from "./_mock_ws.ts";
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

  handleSessionWebSocket(ws as unknown as WebSocket, sessions, {
    createSession: () => spy,
    ...overrides,
  });

  return { ws, sessions, spy };
}

Deno.test("handleSessionWebSocket", async (t) => {
  await t.step("creates and starts session on open", async () => {
    const { ws, sessions, spy } = setup();
    ws.open();
    await flush();

    expect(sessions.size).toBe(1);
    expect(spy.calls).toContain("start");
  });

  await t.step("calls onOpen/onClose callbacks", async () => {
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

  await t.step("responds to ping with pong before session is ready", () => {
    const { ws } = setup();
    // Send before open — session not ready
    ws.msg(JSON.stringify({ type: "ping" }));
    expect(ws.sentJson().some((m) => m.type === "pong")).toBe(true);
  });

  await t.step(
    "responds to ping with pong after session is ready",
    async () => {
      const { ws } = setup();
      ws.open();
      await flush();

      ws.sent.length = 0;
      ws.msg(JSON.stringify({ type: "ping" }));
      await flush();
      expect(ws.sentJson().some((m) => m.type === "pong")).toBe(true);
    },
  );

  await t.step(
    "queues control messages sent before open and replays them",
    async () => {
      const { ws, spy } = setup();
      ws.msg(JSON.stringify({ type: "audio_ready" }));
      ws.open();
      await flush();
      await flush();

      expect(spy.calls).toContain("start");
      expect(spy.calls).toContain("onAudioReady");
    },
  );

  await t.step("dispatches audio_ready, cancel, reset to session", async () => {
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

  await t.step("dispatches binary audio to session.onAudio", async () => {
    const { ws, spy } = setup();
    ws.open();
    await flush();

    ws.msg(new ArrayBuffer(16));
    expect(spy.calls).toContain("onAudio");
  });

  await t.step("ignores invalid JSON and unknown control types", async () => {
    const { ws, spy } = setup();
    ws.open();
    await flush();

    const callsBefore = spy.calls.length;
    ws.msg("not json");
    ws.msg(JSON.stringify({ type: "bogus" }));
    await flush();

    // No new session method calls
    expect(spy.calls.length).toBe(callsBefore);
  });

  await t.step("stops session and removes from map on close", async () => {
    const { ws, sessions, spy } = setup();
    ws.open();
    await flush();
    expect(sessions.size).toBe(1);

    ws.disconnect();
    await flush();
    expect(spy.calls).toContain("stop");
    expect(sessions.size).toBe(0);
  });

  await t.step("handles ws error without crashing", () => {
    const { ws } = setup();
    ws.error();
    // No throw
  });
});
