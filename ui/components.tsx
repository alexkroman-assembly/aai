import type * as preact from "preact";
import { useRef } from "preact/hooks";
import { useComputed, useSignalEffect } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { AgentState, Message, SessionError } from "./types.ts";
import { useSession } from "./signals.tsx";
import {
  base,
  bubble,
  controls,
  errorBanner,
  hero,
  indicator,
  layout,
  messageArea,
  thinking,
} from "./styles.ts";

export function StateIndicator(
  { state }: { state: Signal<AgentState> },
): preact.JSX.Element {
  return (
    <div class={indicator}>
      <div
        class="dot"
        style={`background:var(--aai-state-${state.value})`}
      />
      <span class="label">{state}</span>
    </div>
  );
}

export function ErrorBanner(
  { error }: { error: Signal<SessionError | null> },
): preact.JSX.Element | null {
  if (!error.value) return null;
  return <div class={errorBanner}>{error.value.message}</div>;
}

export function MessageBubble(
  { message }: { message: Message },
): preact.JSX.Element {
  const isUser = message.role === "user";
  return (
    <div class={`${bubble} ${isUser ? "user" : ""}`}>
      <div class="content">
        <div>{message.text}</div>
      </div>
    </div>
  );
}

export function Transcript(
  { text }: { text: Signal<string> },
): preact.JSX.Element | null {
  if (!text.value) return null;
  return (
    <div class={`${bubble} user transcript`}>
      <div class="content">
        <div>{text}</div>
      </div>
    </div>
  );
}

export function ThinkingIndicator(): preact.JSX.Element {
  return (
    <div class={thinking}>
      <div class="dot" />
      <div class="dot" />
      <div class="dot" />
    </div>
  );
}

function MessageList() {
  const { messages, transcript, state } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  useSignalEffect(() => {
    messages.value;
    transcript.value;
    state.value;
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  return (
    <div class={messageArea}>
      {messages.value.map((msg, i) => <MessageBubble key={i} message={msg} />)}
      <Transcript text={transcript} />
      {state.value === "thinking" && <ThinkingIndicator />}
      <div ref={scrollRef} />
    </div>
  );
}

function Controls() {
  const { running, toggle, reset } = useSession();
  const buttonStyle = useComputed(() =>
    `background:${
      running.value ? "var(--aai-error)" : "var(--aai-state-ready)"
    }`
  );
  const buttonLabel = useComputed(() => running.value ? "Stop" : "Resume");

  return (
    <div class={controls}>
      <button
        type="button"
        style={buttonStyle.value}
        onClick={toggle}
      >
        {buttonLabel}
      </button>
      <button type="button" class="reset" onClick={reset}>
        New Conversation
      </button>
    </div>
  );
}

export function ChatView(): preact.JSX.Element {
  const { state, error } = useSession();

  return (
    <div class={`${base} ${layout}`}>
      <StateIndicator state={state} />
      <ErrorBanner error={error} />
      <MessageList />
      <Controls />
    </div>
  );
}

export function App(): preact.JSX.Element {
  const { started, start } = useSession();

  if (!started.value) {
    return (
      <div class={`${base} ${hero}`}>
        <button type="button" onClick={start}>
          Start Conversation
        </button>
      </div>
    );
  }

  return <ChatView />;
}
