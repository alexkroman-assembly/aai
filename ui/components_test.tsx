// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStrictEquals, assertStringIncludes } from "@std/assert";
import { render } from "preact";
import { signal } from "@preact/signals";
import { createMockSignals, withDOM } from "./_test_utils.ts";
import { SessionProvider, type SessionSignals } from "./signals.ts";
import { StateIndicator } from "./_components/state_indicator.tsx";
import { ErrorBanner } from "./_components/error_banner.tsx";
import { MessageBubble } from "./_components/message_bubble.tsx";
import { Transcript } from "./_components/transcript.tsx";
import { ChatView } from "./_components/chat_view.tsx";
import { App } from "./_components/app.tsx";
import type { AgentState, Message } from "./types.ts";

function renderWithProvider(
  container: Element,
  vnode: preact.ComponentChildren,
  signals: SessionSignals,
) {
  render(
    <SessionProvider value={signals}>{vnode}</SessionProvider>,
    container,
  );
}

Deno.test("StateIndicator", async (t) => {
  await t.step(
    "renders the state label",
    withDOM((container) => {
      render(
        <StateIndicator state={signal<AgentState>("listening")} />,
        container,
      );
      assertStringIncludes(container.textContent!, "listening");
    }),
  );
});

Deno.test("ErrorBanner", async (t) => {
  await t.step(
    "renders error message",
    withDOM((container) => {
      render(
        <ErrorBanner
          error={signal({
            code: "connection" as const,
            message: "Connection lost",
          })}
        />,
        container,
      );
      assertStringIncludes(container.textContent!, "Connection lost");
    }),
  );

  await t.step(
    "renders nothing when null",
    withDOM((container) => {
      render(
        <ErrorBanner error={signal(null)} />,
        container,
      );
      assertStrictEquals(container.innerHTML, "");
    }),
  );
});

Deno.test("MessageBubble", async (t) => {
  await t.step(
    "renders message text",
    withDOM((container) => {
      const msg: Message = { role: "user", text: "Hello there" };
      render(
        <MessageBubble message={msg} />,
        container,
      );
      assertStringIncludes(container.textContent!, "Hello there");
    }),
  );

  await t.step(
    "renders assistant message text",
    withDOM((container) => {
      const msg: Message = { role: "assistant", text: "Simple reply" };
      render(
        <MessageBubble message={msg} />,
        container,
      );
      assertStrictEquals(container.textContent, "Simple reply");
    }),
  );
});

Deno.test("Transcript", async (t) => {
  await t.step(
    "renders transcript text",
    withDOM((container) => {
      render(
        <Transcript text={signal("hello wor")} />,
        container,
      );
      assertStringIncludes(container.textContent!, "hello wor");
    }),
  );

  await t.step(
    "renders nothing when empty",
    withDOM((container) => {
      render(
        <Transcript text={signal("")} />,
        container,
      );
      assertStrictEquals(container.innerHTML, "");
    }),
  );
});

Deno.test("App", async (t) => {
  await t.step(
    "shows start button when not started",
    withDOM((container) => {
      const signals = createMockSignals({ started: false });
      renderWithProvider(
        container,
        <App />,
        signals,
      );
      assertStrictEquals(
        container.querySelector("button")!.textContent,
        "Start",
      );
    }),
  );

  await t.step(
    "shows ChatView when started",
    withDOM((container) => {
      const signals = createMockSignals({
        started: true,
        state: "listening",
        running: true,
      });
      renderWithProvider(
        container,
        <App />,
        signals,
      );
      assertStringIncludes(container.textContent!, "listening");
      assertStringIncludes(container.textContent!, "Stop");
    }),
  );

  await t.step(
    "transitions from start screen to chat",
    withDOM((container) => {
      const signals = createMockSignals({ started: false });
      renderWithProvider(
        container,
        <App />,
        signals,
      );
      assertStrictEquals(
        container.querySelector("button")!.textContent,
        "Start",
      );

      signals.started.value = true;
      signals.state.value = "listening";
      renderWithProvider(
        container,
        <App />,
        signals,
      );

      assertStringIncludes(container.textContent!, "listening");
      assert(!container.textContent!.includes("Start"));
    }),
  );
});

Deno.test("ChatView", async (t) => {
  await t.step(
    "renders state and messages",
    withDOM((container) => {
      const signals = createMockSignals({
        started: true,
        state: "thinking",
        running: true,
        messages: [
          { role: "user", text: "What is AI?" },
          { role: "assistant", text: "AI stands for..." },
        ],
      });
      renderWithProvider(
        container,
        <ChatView />,
        signals,
      );

      assertStringIncludes(container.textContent!, "thinking");
      assertStringIncludes(container.textContent!, "What is AI?");
      assertStringIncludes(container.textContent!, "AI stands for...");
    }),
  );

  await t.step(
    "renders transcript and error",
    withDOM((container) => {
      const signals = createMockSignals({
        started: true,
        state: "error",
        running: false,
        transcript: "hello wor",
        error: { code: "connection", message: "Connection failed" },
      });
      renderWithProvider(
        container,
        <ChatView />,
        signals,
      );

      assertStringIncludes(container.textContent!, "hello wor");
      assertStringIncludes(container.textContent!, "Connection failed");
    }),
  );

  await t.step(
    "shows Stop when running, Resume when not",
    withDOM((container) => {
      const signals = createMockSignals({
        started: true,
        state: "listening",
        running: true,
      });
      renderWithProvider(
        container,
        <ChatView />,
        signals,
      );

      const text = () => container.textContent!;

      assertStringIncludes(text(), "Stop");
      assertStringIncludes(text(), "New Conversation");

      signals.running.value = false;
      renderWithProvider(
        container,
        <ChatView />,
        signals,
      );
      assertStringIncludes(text(), "Resume");
    }),
  );

  await t.step(
    "renders messages in order",
    withDOM((container) => {
      const signals = createMockSignals({
        started: true,
        state: "listening",
        running: true,
        messages: [
          { role: "user", text: "First" },
          { role: "assistant", text: "Second" },
          { role: "user", text: "Third" },
        ],
      });
      renderWithProvider(
        container,
        <ChatView />,
        signals,
      );

      const text = container.textContent!;
      assert(text.indexOf("First") < text.indexOf("Second"));
      assert(text.indexOf("Second") < text.indexOf("Third"));
    }),
  );
});
