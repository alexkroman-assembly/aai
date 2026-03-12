import {
  ErrorBanner,
  html,
  MessageBubble,
  StateIndicator,
  Transcript,
  useSession,
} from "@aai/ui";
import type { Message } from "@aai/ui";
import { useEffect, useRef } from "preact/hooks";

export default function NightOwl() {
  const {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start,
    toggle,
    reset,
  } = useSession();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.value.length, transcript.value]);

  if (!started.value) {
    return html`
      <div style="${{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "24px",
      }}">
        <div style="${{ fontSize: "48px" }}">🦉</div>
        <h1 style="${{
          fontSize: "24px",
          fontWeight: 600,
          margin: 0,
        }}">Night Owl</h1>
        <p style="${{
          color: "var(--aai-text-muted)",
          fontSize: "14px",
          margin: 0,
        }}">
          your evening companion
        </p>
        <button
          type="button"
          style="${{
            marginTop: "16px",
            padding: "14px 36px",
            background: "var(--aai-primary)",
            color: "var(--aai-text)",
            border: "none",
            borderRadius: "var(--aai-radius)",
            font: "500 15px/1 inherit",
            cursor: "pointer",
            letterSpacing: "0.5px",
          }}"
          onClick="${start}"
        >
          Start Conversation
        </button>
      </div>
    `;
  }

  return html`
    <div style="${{
      maxWidth: "640px",
      margin: "0 auto",
      padding: "24px",
      minHeight: "100vh",
    }}">
      <div style="${{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "20px",
        paddingBottom: "16px",
        borderBottom: "1px solid var(--aai-surface-light)",
      }}">
        <div style="${{ fontSize: "20px" }}">🦉</div>
        <span style="${{ fontSize: "16px", fontWeight: 600 }}">Night Owl</span>
        <div style="${{ marginLeft: "auto" }}">
          <${StateIndicator} state="${state}" />
        </div>
      </div>

      <${ErrorBanner} error="${error}" />

      <div style="${{
        minHeight: "300px",
        maxHeight: "500px",
        overflowY: "auto",
        marginBottom: "16px",
        border: "1px solid var(--aai-surface-light)",
        borderRadius: "var(--aai-radius)",
        padding: "16px",
        background: "var(--aai-surface)",
      }}">
        ${messages.value.map((msg: Message, i: number) =>
          html`
            <${MessageBubble} key="${i}" message="${msg}" />
          `
        )}
        <${Transcript} text="${transcript}" />
        <div ref="${bottom}" />
      </div>

      <div style="${{ display: "flex", gap: "8px" }}">
        <button
          type="button"
          style="${{
            padding: "10px 20px",
            borderRadius: "var(--aai-radius)",
            font: "500 13px/1 inherit",
            cursor: "pointer",
            border: "none",
            color: "var(--aai-bg)",
            background: running.value
              ? "var(--aai-state-speaking)"
              : "var(--aai-state-ready)",
          }}"
          onClick="${toggle}"
        >
          ${running.value ? "Stop" : "Resume"}
        </button>
        <button
          type="button"
          style="${{
            padding: "10px 20px",
            borderRadius: "var(--aai-radius)",
            font: "500 13px/1 inherit",
            cursor: "pointer",
            border: "1px solid var(--aai-surface-light)",
            background: "transparent",
            color: "var(--aai-text-muted)",
          }}"
          onClick="${reset}"
        >
          New Conversation
        </button>
      </div>
    </div>
  `;
}
