// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { delay } from "@std/async/delay";
import { withMountEnv } from "./_test_utils.ts";
import { mount } from "./mount.tsx";

Deno.test("mount()", async (t) => {
  await t.step(
    "throws when target selector does not match",
    withMountEnv(() => {
      function App() {
        return <div>test</div>;
      }
      assertThrows(
        () =>
          mount(App, {
            target: "#nonexistent",
            platformUrl: "http://localhost:3000",
          }),
        Error,
        "Element not found: #nonexistent",
      );
    }),
  );

  await t.step(
    "renders a component into the default #app element",
    withMountEnv(() => {
      function App() {
        return <div class="hello">Hello Mount</div>;
      }
      mount(App, { platformUrl: "http://localhost:3000" });

      const el = globalThis.document.querySelector("#app")!;
      assertStringIncludes(el.textContent!, "Hello Mount");
    }),
  );

  await t.step(
    "returns session, signals, and dispose",
    withMountEnv(() => {
      function App() {
        return <div />;
      }
      const handle = mount(App, { platformUrl: "http://localhost:3000" });

      assert(handle.session !== undefined);
      assert(handle.signals !== undefined);
      assertStrictEquals(typeof handle.dispose, "function");
    }),
  );

  await t.step(
    "dispose tears down render and disconnects session",
    withMountEnv(() => {
      function App() {
        return <div>content</div>;
      }
      const handle = mount(App, { platformUrl: "http://localhost:3000" });

      const el = globalThis.document.querySelector("#app")!;
      assertStringIncludes(el.textContent!, "content");

      handle.dispose();
      assertStrictEquals(el.textContent, "");
    }),
  );

  await t.step(
    "derives platformUrl from location.href when not explicitly provided",
    withMountEnv(async (mock) => {
      const g = globalThis as unknown as Record<string, unknown>;
      g.location = {
        origin: "https://aai-agent.fly.dev",
        pathname: "/alex/ai-takes",
        href: "https://aai-agent.fly.dev/alex/ai-takes",
      };
      const App = () => <div />;
      const handle = mount(App);
      handle.session.connect();
      await delay(0);
      const ws = mock.lastWs!;
      assertStrictEquals(
        ws.url.toString(),
        "wss://aai-agent.fly.dev/alex/ai-takes/websocket",
      );
      handle.dispose();
    }),
  );
});
