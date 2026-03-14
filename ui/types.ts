// Copyright 2025 the AAI authors. MIT license.
/** Microphone buffer duration in seconds before sending to the server. */
export const MIC_BUFFER_SECONDS = 0.1;

/** Current state of the voice agent session. */
export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** A chat message exchanged between user and assistant. */
export type Message = {
  /** The sender of the message. */
  role: "user" | "assistant";
  /** The text content of the message. */
  text: string;
};

/** Category of session error. */
export type SessionErrorCode = "connection" | "audio" | "protocol";

/** Error reported by the voice session. */
export type SessionError = {
  /** The category of the error. */
  readonly code: SessionErrorCode;
  /** A human-readable description of the error. */
  readonly message: string;
};

/** Options for creating a voice session. */
export type SessionOptions = {
  /** Base URL of the AAI platform server. */
  platformUrl: string;
};
