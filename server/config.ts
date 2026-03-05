import { z } from "zod";
import {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
  type STTConfig,
  type TTSConfig,
} from "./types.ts";

const EnvSchema = z.object({
  ASSEMBLYAI_API_KEY: z.string().min(1, "ASSEMBLYAI_API_KEY is required"),
  LLM_MODEL: z.string().optional(),
});

export interface PlatformConfig {
  apiKey: string;
  sttConfig: STTConfig;
  ttsConfig: TTSConfig;
  model: string;
  llmGatewayBase: string;
  braveApiKey: string;
}

/** Read the TTS API key from the server's own process environment. */
export function getServerTtsKey(): string {
  return Deno.env.get("ASSEMBLYAI_TTS_API_KEY") ?? "";
}

/** Read the Brave Search API key from the server's own process environment. */
export function getServerBraveKey(): string {
  return Deno.env.get("BRAVE_API_KEY") ?? "";
}

export function loadPlatformConfig(
  env: Record<string, string | undefined>,
  ttsApiKey?: string,
): PlatformConfig {
  const parsed = EnvSchema.parse(env);

  return {
    apiKey: parsed.ASSEMBLYAI_API_KEY,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      ...DEFAULT_TTS_CONFIG,
      apiKey: ttsApiKey ?? getServerTtsKey(),
    },
    model: parsed.LLM_MODEL ?? DEFAULT_MODEL,
    llmGatewayBase: "https://llm-gateway.assemblyai.com/v1",
    braveApiKey: getServerBraveKey(),
  };
}
