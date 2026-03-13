// Copyright 2025 the AAI authors. MIT license.
import {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
  type STTConfig,
  type TTSConfig,
} from "./types.ts";
import { EnvSchema } from "./_schemas.ts";

export type PlatformConfig = {
  apiKey: string;
  sttConfig: STTConfig;
  ttsConfig: TTSConfig;
  model: string;
  llmGatewayBase: string;
};

export function loadPlatformConfig(
  env: Record<string, string | undefined>,
): PlatformConfig {
  const parsed = EnvSchema.parse(env);

  return {
    apiKey: parsed.ASSEMBLYAI_API_KEY,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      ...DEFAULT_TTS_CONFIG,
      apiKey: Deno.env.get("RIME_API_KEY") ?? "",
    },
    model: parsed.LLM_MODEL ?? DEFAULT_MODEL,
    llmGatewayBase: "https://llm-gateway.assemblyai.com/v1",
  };
}
