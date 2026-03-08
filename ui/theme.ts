import type { AgentState } from "./types.ts";

export type Theme = {
  bg: string;
  surface: string;
  surfaceLight: string;
  primary: string;
  text: string;
  textMuted: string;
  error: string;
  font: string;
  radius: string;
  stateColors: Record<AgentState, string>;
};

export const defaultTheme: Theme = Object.freeze({
  bg: "#ffffff",
  surface: "#f5f5f5",
  surfaceLight: "#e0e0e0",
  primary: "#2196F3",
  text: "#000000",
  textMuted: "#666666",
  error: "#f44336",
  font: "system-ui, -apple-system, sans-serif",
  radius: "8px",
  stateColors: Object.freeze({
    connecting: "#999",
    ready: "#4CAF50",
    listening: "#2196F3",
    thinking: "#FF9800",
    speaking: "#9C27B0",
    error: "#f44336",
  }),
});

export const darkTheme: Theme = Object.freeze({
  bg: "#0f0e17",
  surface: "#1a1a2e",
  surfaceLight: "#2b2c3f",
  primary: "#7f5af0",
  text: "#fffffe",
  textMuted: "#94a1b2",
  error: "#ff6b6b",
  font: "'SF Mono', 'Fira Code', monospace",
  radius: "8px",
  stateColors: Object.freeze({
    connecting: "#94a1b2",
    ready: "#72f1b8",
    listening: "#7f5af0",
    thinking: "#e2b714",
    speaking: "#ff6480",
    error: "#ff6b6b",
  }),
});

export function applyTheme(el: HTMLElement, theme: Readonly<Theme>): void {
  const s = el.style;
  for (const [key, value] of Object.entries(theme)) {
    if (key === "stateColors") {
      for (
        const [state, color] of Object.entries(value as Record<string, string>)
      ) {
        s.setProperty(`--aai-state-${state}`, color);
      }
    } else {
      s.setProperty(
        `--aai-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
        value as string,
      );
    }
  }

  s.background = theme.bg;
  s.color = theme.text;
  s.fontFamily = theme.font;
  s.minHeight = "100vh";
  s.margin = "0";
}
