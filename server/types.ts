// Copyright 2025 the AAI authors. MIT license.
import {
  DEFAULT_STT_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
} from "@aai/sdk/protocol";

export type STTConfig = {
  sampleRate: number;
  speechModel: string;
  wssBase: string;
  tokenExpiresIn: number;
  formatTurns: boolean;
  minTurnSilence: number;
  maxTurnSilence: number;
  vadThreshold: number;
  sttPrompt?: string | undefined;
};

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
  speedAlpha?: number | undefined;
};

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
