import { installDomShim } from "./_dom_shim.ts";
import { DOMParser } from "@b-fuze/deno-dom";
import { signal } from "@preact/signals";
import type { SessionSignals } from "./signals.tsx";
import type { AgentState, Message, SessionError } from "./types.ts";

const HTML =
  `<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>`;

export function setupDOM() {
  installDomShim();
  const doc = new DOMParser().parseFromString(HTML, "text/html")!;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;
  return doc;
}

export function getContainer(): Element {
  return globalThis.document.querySelector("#app")!;
}

// Ensure document exists at import time for modules using goober css``.
setupDOM();

export {
  installMockWebSocket,
  MockWebSocket,
} from "@aai/server/testing/mock-ws";

export const flush = () => new Promise<void>((r) => queueMicrotask(r));

export function installMockLocation(origin = "http://localhost:3000") {
  const had = "location" in globalThis;
  // deno-lint-ignore no-explicit-any
  if (!had) (globalThis as any).location = { origin };
  return {
    restore() {
      // deno-lint-ignore no-explicit-any
      if (!had) delete (globalThis as any).location;
    },
  };
}

export function createMockSignals(
  overrides?: Partial<{
    state: AgentState;
    messages: Message[];
    transcript: string;
    error: SessionError | null;
    started: boolean;
    running: boolean;
  }>,
): SessionSignals {
  const signals: SessionSignals = {
    state: signal<AgentState>(overrides?.state ?? "connecting"),
    messages: signal<Message[]>(overrides?.messages ?? []),
    transcript: signal<string>(overrides?.transcript ?? ""),
    error: signal<SessionError | null>(overrides?.error ?? null),
    started: signal<boolean>(overrides?.started ?? false),
    running: signal<boolean>(overrides?.running ?? true),
    dispose() {},
    [Symbol.dispose]() {},
    start() {
      signals.started.value = true;
      signals.running.value = true;
    },
    toggle() {
      signals.running.value = !signals.running.value;
    },
    reset() {},
  };

  return signals;
}
