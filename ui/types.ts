export const PING_INTERVAL_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const MAX_BACKOFF_MS = 16_000;
export const INITIAL_BACKOFF_MS = 1_000;
export const MIC_BUFFER_SECONDS = 0.1;

export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type Message = {
  role: "user" | "assistant";
  text: string;
};

export type SessionErrorCode = "connection" | "audio" | "protocol";

export type SessionError = {
  readonly code: SessionErrorCode;
  readonly message: string;
};

export type SessionOptions = {
  platformUrl: string;
};
