import { z } from "zod";
import {
  DEFAULT_MODEL,
  DEFAULT_STT_CONFIG,
  DEFAULT_TTS_CONFIG,
  STTConfigSchema,
  TTSConfigSchema,
} from "./types.ts";
import { EnvSchema } from "./_schemas.ts";

export const PlatformConfigSchema = z.object({
  apiKey: z.string().min(1),
  sttConfig: STTConfigSchema,
  ttsConfig: TTSConfigSchema,
  model: z.string(),
  llmGatewayBase: z.string().url(),
});

export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

export function loadPlatformConfig(
  env: Record<string, string | undefined>,
): PlatformConfig {
  const parsed = EnvSchema.parse(env);

  return PlatformConfigSchema.parse({
    apiKey: parsed.ASSEMBLYAI_API_KEY,
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: {
      ...DEFAULT_TTS_CONFIG,
      apiKey: Deno.env.get("RIME_API_KEY") ?? "",
    },
    model: parsed.LLM_MODEL ?? DEFAULT_MODEL,
    llmGatewayBase: "https://llm-gateway.assemblyai.com/v1",
  });
}
