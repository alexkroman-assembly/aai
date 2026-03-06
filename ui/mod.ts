/** @module @aai/ui */

export { css, keyframes, styled } from "goober";

export { createVoiceSession } from "./session.ts";
export type { VoiceSession } from "./session.ts";
export type {
  AgentState,
  Message,
  SessionError,
  SessionErrorCode,
  SessionOptions,
} from "./types.ts";

export {
  createSessionControls,
  SessionProvider,
  useSession,
} from "./signals.tsx";
export type { SessionSignals } from "./signals.tsx";

export { applyTheme, darkTheme, defaultTheme } from "./theme.ts";
export type { Theme } from "./theme.ts";

export { mount } from "./mount.tsx";
export type { MountHandle, MountOptions } from "./mount.tsx";

export {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  ThinkingIndicator,
  Transcript,
} from "./components.tsx";
