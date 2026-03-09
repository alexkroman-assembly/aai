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
} from "./signals.ts";
export type { SessionSignals } from "./signals.ts";

export { applyTheme, darkTheme, defaultTheme, lightTheme } from "./theme.ts";
export type { Theme } from "./theme.ts";

export { mount } from "./mount.ts";
export type { MountHandle, MountOptions } from "./mount.ts";

export {
  App,
  ChatView,
  ErrorBanner,
  MessageBubble,
  StateIndicator,
  ThinkingIndicator,
  Transcript,
} from "./components.ts";
