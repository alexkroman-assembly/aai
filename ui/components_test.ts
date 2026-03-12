import { expect } from "@std/expect";
import { h, render } from "preact";
import { signal } from "@preact/signals";
import { createMockSignals, withDOM } from "./_test_utils.ts";
import { SessionProvider, type SessionSignals } from "./signals.ts";
import {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  Transcript,
} from "./_components.ts";
import { html } from "./_html.ts";
import type { AgentState, Message } from "./types.ts";

function renderWithProvider(
  container: Element,
  vnode: preact.ComponentChildren,
  signals: SessionSignals,
) {
  render(
    h(SessionProvider, { value: signals, children: vnode }),
    container,
  );
}

Deno.test("StateIndicator", async (t) => {
  await t.step(
    "renders the state label",
    withDOM((container) => {
      render(
        html`
          <${StateIndicator} state="${signal<AgentState>("listening")}" />
        `,
        container,
      );
      expect(container.textContent).toContain("listening");
    }),
  );
});

Deno.test("ErrorBanner", async (t) => {
  await t.step(
    "renders error message",
    withDOM((container) => {
      render(
        html`
          <${ErrorBanner}
            error="${signal({
              code: "connection" as const,
              message: "Connection lost",
            })}"
          />
        `,
        container,
      );
      expect(container.textContent).toContain("Connection lost");
    }),
  );

  await t.step(
    "renders nothing when null",
    withDOM((container) => {
      render(
        html`
          <${ErrorBanner} error="${signal(null)}" />
        `,
        container,
      );
      expect(container.innerHTML).toBe("");
    }),
  );
});

Deno.test("MessageBubble", async (t) => {
  await t.step(
    "renders message text",
    withDOM((container) => {
      const msg: Message = { role: "user", text: "Hello there" };
      render(
        html`
          <${MessageBubble} message="${msg}" />
        `,
        container,
      );
      expect(container.textContent).toContain("Hello there");
    }),
  );

  await t.step(
    "renders assistant message text",
    withDOM((container) => {
      const msg: Message = { role: "assistant", text: "Simple reply" };
      render(
        html`
          <${MessageBubble} message="${msg}" />
        `,
        container,
      );
      expect(container.textContent).toBe("Simple reply");
    }),
  );
});

Deno.test("Transcript", async (t) => {
  await t.step(
    "renders transcript text",
    withDOM((container) => {
      render(
        html`
          <${Transcript} text="${signal("hello wor")}" />
        `,
        container,
      );
      expect(container.textContent).toContain("hello wor");
    }),
  );

  await t.step(
    "renders nothing when empty",
    withDOM((container) => {
      render(
        html`
          <${Transcript} text="${signal("")}" />
        `,
        container,
      );
      expect(container.innerHTML).toBe("");
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
        html`
          <${App} />
        `,
        signals,
      );
      expect(container.querySelector("button")!.textContent).toBe(
        "Start Conversation",
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
        html`
          <${App} />
        `,
        signals,
      );
      expect(container.textContent).toContain("listening");
      expect(container.textContent).toContain("Stop");
    }),
  );

  await t.step(
    "transitions from start screen to chat",
    withDOM((container) => {
      const signals = createMockSignals({ started: false });
      renderWithProvider(
        container,
        html`
          <${App} />
        `,
        signals,
      );
      expect(container.querySelector("button")!.textContent).toBe(
        "Start Conversation",
      );

      signals.started.value = true;
      signals.state.value = "listening";
      renderWithProvider(
        container,
        html`
          <${App} />
        `,
        signals,
      );

      expect(container.textContent).toContain("listening");
      expect(container.textContent).not.toContain("Start Conversation");
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
        html`
          <${ChatView} />
        `,
        signals,
      );

      expect(container.textContent).toContain("thinking");
      expect(container.textContent).toContain("What is AI?");
      expect(container.textContent).toContain("AI stands for...");
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
        html`
          <${ChatView} />
        `,
        signals,
      );

      expect(container.textContent).toContain("hello wor");
      expect(container.textContent).toContain("Connection failed");
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
        html`
          <${ChatView} />
        `,
        signals,
      );

      const buttons = () =>
        Array.from(container.querySelectorAll("button")).map((b) =>
          b.textContent
        );

      expect(buttons()).toContain("Stop");
      expect(buttons()).toContain("New Conversation");

      signals.running.value = false;
      render(null, container);
      renderWithProvider(
        container,
        html`
          <${ChatView} />
        `,
        signals,
      );
      expect(buttons()).toContain("Resume");
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
        html`
          <${ChatView} />
        `,
        signals,
      );

      const text = container.textContent!;
      expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"));
      expect(text.indexOf("Second")).toBeLessThan(text.indexOf("Third"));
    }),
  );
});
