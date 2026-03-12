/**
 * Re-exports from _components.ts with explicit type annotations so JSR can
 * generate .d.ts without needing to analyze source files.
 */

import type * as preact from "preact";
import type { Signal } from "@preact/signals";
import type { AgentState, Message, SessionError } from "./types.ts";

import {
  App as _App,
  ChatView as _ChatView,
  ErrorBanner as _ErrorBanner,
  MessageBubble as _MessageBubble,
  StateIndicator as _StateIndicator,
  ThinkingIndicator as _ThinkingIndicator,
  Transcript as _Transcript,
} from "./_components.ts";

export const StateIndicator: (
  props: { state: Signal<AgentState> },
) => preact.JSX.Element = _StateIndicator;

export const ErrorBanner: (
  props: { error: Signal<SessionError | null> },
) => preact.JSX.Element | null = _ErrorBanner;

export const MessageBubble: (
  props: { message: Message },
) => preact.JSX.Element = _MessageBubble;

export const Transcript: (
  props: { text: Signal<string> },
) => preact.JSX.Element | null = _Transcript;

export const ThinkingIndicator: () => preact.JSX.Element = _ThinkingIndicator;

export const ChatView: () => preact.JSX.Element = _ChatView;

export const App: () => preact.JSX.Element = _App;
