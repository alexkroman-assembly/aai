import type * as preact from "preact";
import { useRef } from "preact/hooks";
import { useComputed, useSignalEffect } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { AgentState, Message, SessionError } from "./types.ts";
import { useSession } from "./signals.ts";
import { html } from "./_html.ts";

// --- Static styles (allocated once, shared across renders) ---

const styles = {
  stateRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "16px",
    flexShrink: 0,
  },
  stateDot: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
  },
  stateLabel: {
    fontSize: "14px",
    color: "var(--aai-text-muted)",
    textTransform: "capitalize",
  },
  errorBanner: {
    background: "var(--aai-surface)",
    color: "var(--aai-error)",
    padding: "10px 14px",
    borderRadius: "var(--aai-radius)",
    marginBottom: "16px",
    fontSize: "14px",
  },
  bubbleWrap: { marginBottom: "12px" },
  bubble: {
    display: "inline-block",
    maxWidth: "80%",
    padding: "8px 12px",
    borderRadius: "var(--aai-radius)",
    textAlign: "left",
    fontSize: "14px",
  },
  transcriptWrap: { marginBottom: "12px", textAlign: "right" },
  transcriptBubble: {
    display: "inline-block",
    maxWidth: "80%",
    padding: "8px 12px",
    borderRadius: "var(--aai-radius)",
    textAlign: "left",
    fontSize: "14px",
    background: "var(--aai-surface-light)",
    opacity: 0.6,
  },
  thinkingRow: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "8px 12px",
    marginBottom: "12px",
  },
  messageList: {
    flex: 1,
    minHeight: "200px",
    overflowY: "auto",
    marginBottom: "16px",
    border: "1px solid var(--aai-surface-light)",
    borderRadius: "var(--aai-radius)",
    padding: "16px",
    WebkitOverflowScrolling: "touch",
  },
  controlsRow: {
    display: "flex",
    gap: "8px",
    flexShrink: 0,
    paddingBottom: "env(safe-area-inset-bottom, 0)",
  },
  baseBtn: {
    flex: 1,
    padding: "12px 16px",
    border: "none",
    borderRadius: "var(--aai-radius)",
    cursor: "pointer",
    fontSize: "15px",
    color: "var(--aai-text)",
    WebkitTapHighlightColor: "transparent",
  },
  secondaryBtn: {
    flex: 1,
    padding: "12px 16px",
    border: "1px solid var(--aai-surface-light)",
    borderRadius: "var(--aai-radius)",
    cursor: "pointer",
    fontSize: "15px",
    background: "transparent",
    color: "var(--aai-text-muted)",
    WebkitTapHighlightColor: "transparent",
  },
  page: {
    fontFamily: "var(--aai-font)",
    maxWidth: "600px",
    margin: "0 auto",
    padding: "20px",
    color: "var(--aai-text)",
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  chatPage: {
    fontFamily: "var(--aai-font)",
    maxWidth: "600px",
    margin: "0 auto",
    padding: "20px",
    color: "var(--aai-text)",
    minHeight: "100vh",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  },
  startPage: {
    fontFamily: "var(--aai-font)",
    maxWidth: "600px",
    margin: "0 auto",
    padding: "20px",
    color: "var(--aai-text)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
  },
  startBtn: {
    padding: "18px 40px",
    border: "none",
    borderRadius: "var(--aai-radius)",
    background: "var(--aai-primary)",
    color: "var(--aai-text)",
    fontSize: "18px",
    fontWeight: 500,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  },
} as const;

// --- Bounce animation (injected once into document) ---

const BOUNCE_CSS = `
@keyframes aai-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}`;

let bounceInjected = false;
function ensureBounceCSS(): void {
  if (bounceInjected) return;
  bounceInjected = true;
  const style = document.createElement("style");
  style.textContent = BOUNCE_CSS;
  document.head.appendChild(style);
}

const dotStyles = [
  {
    ...styles.stateDot,
    background: "var(--aai-text-muted)",
    animation: "aai-bounce 1.4s infinite ease-in-out both",
    animationDelay: "0s",
  },
  {
    ...styles.stateDot,
    background: "var(--aai-text-muted)",
    animation: "aai-bounce 1.4s infinite ease-in-out both",
    animationDelay: "0.16s",
  },
  {
    ...styles.stateDot,
    background: "var(--aai-text-muted)",
    animation: "aai-bounce 1.4s infinite ease-in-out both",
    animationDelay: "0.32s",
  },
];

// --- Components ---

export function StateIndicator(
  { state }: { state: Signal<AgentState> },
): preact.JSX.Element {
  return html`
    <div style="${styles.stateRow}">
      <div style="${{
        ...styles.stateDot,
        background: `var(--aai-state-${state.value})`,
      }}" />
      <span style="${styles.stateLabel}">${state}</span>
    </div>
  `;
}

export function ErrorBanner(
  { error }: { error: Signal<SessionError | null> },
): preact.JSX.Element | null {
  if (!error.value) return null;
  return html`
    <div style="${styles.errorBanner}">${error.value.message}</div>
  `;
}

export function MessageBubble(
  { message }: { message: Message },
): preact.JSX.Element {
  const isUser = message.role === "user";
  return html`
    <div style="${{
      ...styles.bubbleWrap,
      textAlign: isUser ? "right" : "left",
    }}">
      <div style="${{
        ...styles.bubble,
        background: isUser ? "var(--aai-surface-light)" : "var(--aai-surface)",
      }}">
        <div>${message.text}</div>
      </div>
    </div>
  `;
}

export function Transcript(
  { text }: { text: Signal<string> },
): preact.JSX.Element | null {
  if (!text.value) return null;
  return html`
    <div style="${styles.transcriptWrap}">
      <div style="${styles.transcriptBubble}">
        <div>${text}</div>
      </div>
    </div>
  `;
}

export function ThinkingIndicator(): preact.JSX.Element {
  ensureBounceCSS();
  return html`
    <div style="${styles.thinkingRow}">
      <div style="${dotStyles[0]}" />
      <div style="${dotStyles[1]}" />
      <div style="${dotStyles[2]}" />
    </div>
  `;
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

  return html`
    <div style="${styles.messageList}">
      ${messages.value.map((msg: Message, i: number) =>
        html`
          <${MessageBubble} key="${i}" message="${msg}" />
        `
      )}
      <${Transcript} text="${transcript}" />
      ${state.value === "thinking" && html`
        <${ThinkingIndicator} />
      `}
      <div ref="${scrollRef}" />
    </div>
  `;
}

function Controls() {
  const { running, toggle, reset } = useSession();
  const primaryStyle = useComputed(() => ({
    ...styles.baseBtn,
    background: running.value ? "var(--aai-error)" : "var(--aai-state-ready)",
  }));
  const buttonLabel = useComputed(() => running.value ? "Stop" : "Resume");

  return html`
    <div style="${styles.controlsRow}">
      <button
        type="button"
        style="${primaryStyle.value}"
        onClick="${toggle}"
      >
        ${buttonLabel}
      </button>
      <button
        type="button"
        style="${styles.secondaryBtn}"
        onClick="${reset}"
      >
        New Conversation
      </button>
    </div>
  `;
}

export function ChatView(): preact.JSX.Element {
  const { state, error } = useSession();

  return html`
    <div style="${styles.chatPage}">
      <${StateIndicator} state="${state}" />
      <${ErrorBanner} error="${error}" />
      <${MessageList} />
      <${Controls} />
    </div>
  `;
}

export function App(): preact.JSX.Element {
  const { started, start } = useSession();

  if (!started.value) {
    return html`
      <div style="${styles.startPage}">
        <button
          type="button"
          style="${styles.startBtn}"
          onClick="${start}"
        >
          Start Conversation
        </button>
      </div>
    `;
  }

  return html`
    <${ChatView} />
  `;
}
