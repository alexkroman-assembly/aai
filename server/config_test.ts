import { expect } from "@std/expect";
import { loadPlatformConfig } from "./config.ts";
import { DEFAULT_MODEL } from "./types.ts";

const validEnv = { ASSEMBLYAI_API_KEY: "test-key-123" };

Deno.test("loadPlatformConfig loads config from valid env", () => {
  const config = loadPlatformConfig(validEnv);
  expect(config.apiKey).toBe("test-key-123");
  expect(config.model).toBe(DEFAULT_MODEL);
  expect(config.sttConfig.sampleRate).toBe(16_000);
});

Deno.test("loadPlatformConfig throws when ASSEMBLYAI_API_KEY is missing", () => {
  expect(() => loadPlatformConfig({})).toThrow();
});

Deno.test("loadPlatformConfig throws when ASSEMBLYAI_API_KEY is empty", () => {
  expect(() => loadPlatformConfig({ ASSEMBLYAI_API_KEY: "" })).toThrow();
});

Deno.test("loadPlatformConfig uses LLM_MODEL override", () => {
  const config = loadPlatformConfig({ ...validEnv, LLM_MODEL: "custom-model" });
  expect(config.model).toBe("custom-model");
});
