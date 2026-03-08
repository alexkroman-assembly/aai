import type { ChatMessage, LLMResponse } from "./types.ts";
import {
  type BundleStore,
  createBundleStore,
  createMemoryS3Client,
} from "./bundle_store_tigris.ts";

export const flush = (): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, 0));

export const DUMMY_INFO: Deno.ServeHandlerInfo = {
  remoteAddr: { transport: "tcp" as const, hostname: "127.0.0.1", port: 0 },
  completed: Promise.resolve(),
};

export function createMockLLMResponse(
  content: string | null,
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
  }[],
): LLMResponse {
  const message: ChatMessage = {
    role: "assistant",
    content,
  };
  if (toolCalls) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return {
    choices: [
      {
        message,
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
  };
}

export const VALID_ENV = {
  ASSEMBLYAI_API_KEY: "test-key",
};

export function createTestStore(): BundleStore {
  return createBundleStore(createMemoryS3Client(), "test-bucket");
}
