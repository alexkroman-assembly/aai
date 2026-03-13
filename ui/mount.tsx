// Copyright 2025 the AAI authors. MIT license.
import { render } from "preact";
import type { ComponentType } from "preact";
import { createVoiceSession, type VoiceSession } from "./session.ts";
import {
  createSessionControls,
  SessionProvider,
  type SessionSignals,
} from "./signals.ts";

/** Options for {@linkcode mount}. */
export type MountOptions = {
  /** CSS selector or DOM element to render into. Defaults to `"#app"`. */
  target?: string | HTMLElement;
  /** Base URL of the AAI platform server. Derived from `location.href` by default. */
  platformUrl?: string;
};

/**
 * Handle returned by {@linkcode mount} for cleanup.
 *
 * Implements {@linkcode Disposable} so it can be used with `using`.
 */
export type MountHandle = {
  /** The underlying voice session. */
  session: VoiceSession;
  /** Reactive session controls for the mounted UI. */
  signals: SessionSignals;
  /** Unmount the UI, remove injected styles, and disconnect the session. */
  dispose(): void;
  /** Alias for {@linkcode dispose} for use with `using`. */
  [Symbol.dispose](): void;
};

function resolveContainer(target: string | HTMLElement = "#app"): HTMLElement {
  const el = typeof target === "string"
    ? document.querySelector(target)
    : target;
  if (!el) throw new Error(`Element not found: ${target}`);
  return el as HTMLElement;
}

/**
 * Mount a Preact component with voice session wiring.
 *
 * Creates a {@linkcode VoiceSession}, wraps it in
 * {@linkcode SessionSignals}, and renders the component
 * inside a {@linkcode SessionProvider}.
 *
 * @param Component - The Preact component to render.
 * @param options - Mount options (target element, platform URL).
 * @returns A {@linkcode MountHandle} for cleanup.
 * @throws {Error} If the target element is not found in the DOM.
 */
export function mount(
  Component: ComponentType,
  options?: MountOptions,
): MountHandle {
  const container = resolveContainer(options?.target);

  const platformUrl = options?.platformUrl ??
    globalThis.location.origin + globalThis.location.pathname;
  const session = createVoiceSession({ platformUrl });
  const signals = createSessionControls(session);

  render(
    <SessionProvider value={signals}>
      <Component />
    </SessionProvider>,
    container,
  );

  const handle: MountHandle = {
    session,
    signals,
    dispose() {
      render(null, container);
      signals.dispose();
      session.disconnect();
    },
    [Symbol.dispose]() {
      handle.dispose();
    },
  };
  return handle;
}
