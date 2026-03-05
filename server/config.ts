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

const ServerEnvSchema = z.object({
  RIME_API_KEY: z.string().min(
    1,
    "RIME_API_KEY is required",
  ),
  BRAVE_API_KEY: z.string().min(1, "BRAVE_API_KEY is required"),
});

/** Validate that all required server environment variables are set. Throws on failure. */
export function validateServerEnv(): void {
  const result = ServerEnvSchema.safeParse({
    RIME_API_KEY: Deno.env.get("RIME_API_KEY"),
    BRAVE_API_KEY: Deno.env.get("BRAVE_API_KEY"),
  });
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Missing required environment variables: ${missing}\nSee .env.example for the required keys.`,
    );
  }
}

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
  return Deno.env.get("RIME_API_KEY") ?? "";
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
