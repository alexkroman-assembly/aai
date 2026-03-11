import { h, render } from "preact";
import type { ComponentType } from "preact";
import { createVoiceSession, type VoiceSession } from "./session.ts";
import {
  createSessionControls,
  SessionProvider,
  type SessionSignals,
} from "./signals.ts";
import { applyTheme, defaultTheme, type Theme } from "./theme.ts";

function injectBodyStyle(theme: Theme): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `body { margin: 0; background: ${theme.bg}; }`;
  document.head.appendChild(style);
  return style;
}

export type MountOptions = {
  theme?: Partial<Theme>;
  target?: string | HTMLElement;
  platformUrl?: string;
};

export type MountHandle = {
  session: VoiceSession;
  signals: SessionSignals;
  dispose(): void;
  [Symbol.dispose](): void;
};

function resolveContainer(target: string | HTMLElement = "#app"): HTMLElement {
  const el = typeof target === "string"
    ? document.querySelector(target)
    : target;
  if (!el) throw new Error(`Element not found: ${target}`);
  return el as HTMLElement;
}

export function mount(
  Component: ComponentType,
  options?: MountOptions,
): MountHandle {
  const container = resolveContainer(options?.target);
  const theme = { ...defaultTheme, ...options?.theme };
  applyTheme(container, theme);

  const platformUrl = options?.platformUrl ??
    new URL(".", globalThis.location.href).href.replace(/\/$/, "");
  const session = createVoiceSession({ platformUrl });
  const signals = createSessionControls(session);
  const styleEl = injectBodyStyle(theme);

  render(
    h(SessionProvider, {
      value: signals,
      children: [h(Component, null)],
    }),
    container,
  );

  const handle: MountHandle = {
    session,
    signals,
    dispose() {
      render(null, container);
      styleEl.remove();
      signals.dispose();
      session.disconnect();
    },
    [Symbol.dispose]() {
      handle.dispose();
    },
  };
  return handle;
}
