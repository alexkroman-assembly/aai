// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { delay } from "@std/async/delay";
import { render } from "preact";
import {
  flush,
  getContainer,
  setupDOM,
  withSignalsEnv,
} from "./_test_utils.ts";
import { useSession } from "./signals.ts";

Deno.test("createSessionControls", async (t) => {
  await t.step(
    "has correct defaults",
    withSignalsEnv(({ signals }) => {
      assertStrictEquals(signals.state.value, "connecting");
      assertEquals(signals.messages.value, []);
      assertStrictEquals(signals.transcript.value, "");
      assertStrictEquals(signals.error.value, null);
      assertStrictEquals(signals.started.value, false);
      assertStrictEquals(signals.running.value, true);
    }),
  );

  await t.step(
    "sets running to false on error state",
    withSignalsEnv(async ({ signals, connect, send, session }) => {
      await connect();
      assertStrictEquals(signals.running.value, true);
      send({ type: "error", message: "fatal" });
      assertStrictEquals(signals.running.value, false);
      session.disconnect();
    }),
  );

  await t.step(
    "start() sets started/running and connects",
    withSignalsEnv(async ({ mock, signals, session }) => {
      assertStrictEquals(signals.started.value, false);
      signals.start();
      await flush();

      assertStrictEquals(signals.started.value, true);
      assertStrictEquals(signals.running.value, true);
      assert(mock.lastWs !== null);
      session.disconnect();
    }),
  );

  await t.step(
    "toggle() disconnects then reconnects",
    withSignalsEnv(async ({ signals, session }) => {
      signals.start();
      await flush();

      signals.toggle();
      assertStrictEquals(signals.running.value, false);

      signals.toggle();
      await flush();
      assertStrictEquals(signals.running.value, true);
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
      assertStrictEquals(
        sent.some((s) => JSON.parse(s).type === "reset"),
        true,
      );
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
      return <div />;
    }

    let caught: Error | null = null;
    try {
      render(
        <Orphan />,
        container,
      );
    } catch (e) {
      caught = e as Error;
    }

    assert(caught !== null);
    assertStringIncludes(
      caught!.message,
      "Hook useSession() requires a SessionProvider",
    );

    render(null, container);
    await delay(0);
  });
});
