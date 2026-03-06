import type * as preact from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { batch, effect, type Signal, signal } from "@preact/signals";
import type { VoiceSession } from "./session.ts";

import type { AgentState, Message, SessionError } from "./types.ts";

export interface SessionSignals {
  state: Signal<AgentState>;
  messages: Signal<Message[]>;
  transcript: Signal<string>;
  error: Signal<SessionError | null>;
  started: Signal<boolean>;
  running: Signal<boolean>;
  dispose(): void;
  start(): void;
  toggle(): void;
  reset(): void;
  [Symbol.dispose](): void;
}

export function createSessionControls(session: VoiceSession): SessionSignals {
  const started = signal(false);
  const running = signal(true);

  const dispose = effect(() => {
    if (session.state.value === "error") running.value = false;
  });

  return {
    state: session.state,
    messages: session.messages,
    transcript: session.transcript,
    error: session.error,
    started,
    running,
    dispose,
    start() {
      batch(() => {
        started.value = true;
        running.value = true;
      });
      session.connect();
    },
    toggle() {
      if (running.value) session.disconnect();
      else session.connect();
      running.value = !running.value;
    },
    reset() {
      session.reset();
    },
    [Symbol.dispose]() {
      dispose();
    },
  };
}

const Ctx = createContext<SessionSignals | null>(null);

export function SessionProvider(
  { value, children }: { value: SessionSignals; children: ComponentChildren },
): preact.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionSignals {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession() requires <SessionProvider>");
  return ctx;
}
