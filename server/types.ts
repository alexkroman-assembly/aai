import { z } from "zod";
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
} from "@aai/core/protocol";

export type STTConfig = {
  sampleRate: number;
  speechModel: string;
  wssBase: string;
  tokenExpiresIn: number;
  formatTurns: boolean;
  minTurnSilence: number;
  maxTurnSilence: number;
  vadThreshold: number;
  sttPrompt?: string;
};

export const STTConfigSchema: z.ZodType<STTConfig> = z.object({
  sampleRate: z.number(),
  speechModel: z.string(),
  wssBase: z.string(),
  tokenExpiresIn: z.number(),
  formatTurns: z.boolean(),
  minTurnSilence: z.number(),
  maxTurnSilence: z.number(),
  vadThreshold: z.number(),
  sttPrompt: z.string().optional(),
});

export const DEFAULT_STT_CONFIG: STTConfig = {
  sampleRate: DEFAULT_STT_SAMPLE_RATE,
  speechModel: "u3-rt-pro",
  wssBase: "wss://streaming.assemblyai.com/v3/ws",
  tokenExpiresIn: 480,
  formatTurns: true,
  minTurnSilence: 400,
  maxTurnSilence: 1000,
  vadThreshold: 0.7,
};

export type TTSConfig = {
  wssUrl: string;
  apiKey: string;
  voice: string;
  modelId: string;
  audioFormat: string;
  samplingRate: number;
  sampleRate: number;
  speedAlpha?: number;
};

export const TTSConfigSchema: z.ZodType<TTSConfig> = z.object({
  wssUrl: z.string(),
  apiKey: z.string(),
  voice: z.string(),
  modelId: z.string(),
  audioFormat: z.string(),
  samplingRate: z.number(),
  sampleRate: z.number(),
  speedAlpha: z.number().optional(),
});

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  wssUrl: "wss://users-ws.rime.ai/ws",
  apiKey: "",
  voice: "luna",
  modelId: "arcana",
  audioFormat: "pcm",
  samplingRate: DEFAULT_TTS_SAMPLE_RATE,
  sampleRate: DEFAULT_TTS_SAMPLE_RATE,
  speedAlpha: 1.1,
};

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
