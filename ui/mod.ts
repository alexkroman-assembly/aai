// Copyright 2025 the AAI authors. MIT license.
/**
 * Browser client library for AAI voice agents.
 *
 * Provides WebSocket session management, audio capture/playback,
 * and Preact UI components.
 *
 * @example
 * ```tsx
 * import { App, mount } from "@aai/ui";
 *
 * mount(App, { target: "#app" });
 * ```
 *
 * @module
 */

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
} from "./components.ts";
