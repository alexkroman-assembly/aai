import { z } from "zod";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
} from "./protocol.ts";

export interface STTConfig {
  sampleRate: number;
  speechModel: string;
  wssBase: string;
  tokenExpiresIn: number;
  formatTurns: boolean;
  minEndOfTurnSilenceWhenConfident: number;
  maxTurnSilence: number;
  vadThreshold: number;
  prompt?: string;
}

export const DEFAULT_STT_CONFIG: STTConfig = {
  sampleRate: DEFAULT_STT_SAMPLE_RATE,
  speechModel: "u3-pro",
  wssBase: "wss://streaming.assemblyai.com/v3/ws",
  tokenExpiresIn: 480,
  formatTurns: true,
  minEndOfTurnSilenceWhenConfident: 100,
  maxTurnSilence: 1000,
  vadThreshold: 0.3,
};

export interface TTSConfig {
  wssUrl: string;
  apiKey: string;
  voice: string;
  maxTokens: number;
  bufferSize: number;
  repetitionPenalty: number;
  temperature: number;
  topP: number;
  sampleRate: number;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  wssUrl:
    "wss://model-q844y7pw.api.baseten.co/environments/production/websocket",
  apiKey: "",
  voice: "jess",
  maxTokens: 2000,
  bufferSize: 105,
  repetitionPenalty: 1.2,
  temperature: 0.6,
  topP: 0.9,
  sampleRate: DEFAULT_TTS_SAMPLE_RATE,
};

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export interface SttMessage {
  type: string;
  transcript?: string;
  is_final?: boolean;
  turn_is_formatted?: boolean;
  turn_order?: number;
  end_of_turn?: boolean;
  timestamp?: number;
  audio_duration_seconds?: number;
  session_duration_seconds?: number;
  [key: string]: unknown;
}

export const SttMessageSchema: z.ZodType<SttMessage> = z
  .object({
    type: z.string(),
    transcript: z.string().optional(),
    is_final: z.boolean().optional(),
    turn_is_formatted: z.boolean().optional(),
    turn_order: z.number().optional(),
    end_of_turn: z.boolean().optional(),
    timestamp: z.number().optional(),
    audio_duration_seconds: z.number().optional(),
    session_duration_seconds: z.number().optional(),
  })
  .passthrough();

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string; [key: string]: unknown };
    [key: string]: unknown;
  }[];
  tool_call_id?: string;
  [key: string]: unknown;
}

const ChatMessageSchema: z.ZodType<ChatMessage> = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  tool_calls: z.array(
    z.object({
      id: z.string(),
      type: z.literal("function"),
      function: z.object({ name: z.string(), arguments: z.string() })
        .passthrough(),
    }).passthrough(),
  ).optional(),
  tool_call_id: z.string().optional(),
}).passthrough();

export interface LLMResponse {
  id?: string;
  choices: { index?: number; message: ChatMessage; finish_reason: string }[];
  [key: string]: unknown;
}

export const LLMResponseSchema: z.ZodType<LLMResponse> = z
  .object({
    id: z.string().optional(),
    choices: z.array(z.object({
      index: z.number().optional(),
      message: ChatMessageSchema,
      finish_reason: z.string(),
    })).nullable().transform((v) => v ?? []),
  })
  .passthrough();

export type { ToolSchema } from "./agent_types.ts";

export interface AgentConfig {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  prompt?: string;
  builtinTools?: string[];
}
