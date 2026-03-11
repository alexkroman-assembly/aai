import { expect } from "@std/expect";
import { render } from "preact";
import {
  flush,
  getContainer,
  installMockLocation,
  installMockWebSocket,
  setupDOM,
} from "./_test_utils.ts";
import { createSessionControls, useSession } from "./signals.ts";
import { createVoiceSession, type VoiceSession } from "./session.ts";
import { html } from "./_html.ts";

function withSignalsEnv(
  fn: (ctx: {
    mock: ReturnType<typeof installMockWebSocket>;
    session: VoiceSession;
    signals: ReturnType<typeof createSessionControls>;
    connect: () => Promise<void>;
    send: (msg: Record<string, unknown>) => void;
  }) => void | Promise<void>,
) {
  return async () => {
    const mock = installMockWebSocket();
    const loc = installMockLocation();
    const session = createVoiceSession({
      platformUrl: "http://localhost:3000",
    });
    const signals = createSessionControls(session);
    try {
      await fn({
        mock,
        session,
        signals,
        async connect() {
          session.connect();
          await flush();
        },
        send(msg) {
          mock.lastWs!.simulateMessage(JSON.stringify(msg));
        },
      });
    } finally {
      mock.restore();
      loc.restore();
    }
  };
}

Deno.test("createSessionControls", async (t) => {
  await t.step(
    "has correct defaults",
    withSignalsEnv(({ signals }) => {
      expect(signals.state.value).toBe("connecting");
      expect(signals.messages.value).toEqual([]);
      expect(signals.transcript.value).toBe("");
      expect(signals.error.value).toBeNull();
      expect(signals.started.value).toBe(false);
      expect(signals.running.value).toBe(true);
    }),
  );

  await t.step(
    "sets running to false on error state",
    withSignalsEnv(async ({ signals, connect, send, session }) => {
      await connect();
      expect(signals.running.value).toBe(true);
      send({ type: "error", message: "fatal" });
      expect(signals.running.value).toBe(false);
      session.disconnect();
    }),
  );

  await t.step(
    "start() sets started/running and connects",
    withSignalsEnv(async ({ mock, signals, session }) => {
      expect(signals.started.value).toBe(false);
      signals.start();
      await flush();

      expect(signals.started.value).toBe(true);
      expect(signals.running.value).toBe(true);
      expect(mock.lastWs).not.toBeNull();
      session.disconnect();
    }),
  );

  await t.step(
    "toggle() disconnects then reconnects",
    withSignalsEnv(async ({ signals, session }) => {
      signals.start();
      await flush();

      signals.toggle();
      expect(signals.running.value).toBe(false);

      signals.toggle();
      await flush();
      expect(signals.running.value).toBe(true);
      session.disconnect();
    }),
  );

  await t.step(
    "reset() sends reset message",
    withSignalsEnv(async ({ mock, signals, connect, session }) => {
      await connect();

      const before = mock.lastWs!.sent.length;
      signals.reset();

      const sent = mock.lastWs!.sent.slice(before)
        .filter((d): d is string => typeof d === "string");
      expect(sent.some((s) => JSON.parse(s).type === "reset")).toBe(true);
      session.disconnect();
    }),
  );
});

Deno.test("useSession", async (t) => {
  await t.step("throws outside SessionProvider", async () => {
    setupDOM();
    const container = getContainer();

    function Orphan() {
      useSession();
      return html`
        <div />
      `;
    }

    let caught: Error | null = null;
    try {
      render(
        html`
          <${Orphan} />
        `,
        container,
      );
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain(
      "useSession() requires <SessionProvider>",
    );

    render(null, container);
    await new Promise<void>((r) => setTimeout(r, 0));
  });
});
