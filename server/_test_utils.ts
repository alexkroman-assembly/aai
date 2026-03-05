import type { SessionOptions, SessionTransport } from "./session.ts";
import type { SttEvents, SttHandle } from "./stt.ts";
import type { ExecuteTool } from "./tool_executor.ts";
import type { PlatformConfig } from "./config.ts";
import type { CallLLMOptions } from "./llm.ts";
import type { ChatMessage, LLMResponse, ToolSchema } from "./types.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";
import { TigrisBundleStore } from "./bundle_store_tigris.ts";
import { createMemoryS3Client } from "./s3_memory.ts";

import type { ToolContext } from "./agent_types.ts";

export function createTestContext(
  overrides?: Partial<ToolContext>,
): ToolContext {
  return {
    secrets: {},
    fetch: globalThis.fetch,
    ...overrides,
  };
}

export function testCtx(fetch?: typeof globalThis.fetch): ToolContext {
  return createTestContext(fetch ? { fetch } : undefined);
}

export function stubFetchJson(data: unknown): typeof globalThis.fetch {
  return (() => Promise.resolve(Response.json(data))) as typeof fetch;
}

export function stubFetchError(
  status: number,
  body: string,
): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(new Response(body, { status }))) as typeof fetch;
}

export function stubFetch(
  stubs: Record<string, unknown>,
): typeof globalThis.fetch {
  return ((input: string | URL) => {
    const url = String(input);
    const match = Object.entries(stubs).find(([k]) => url.includes(k));
    if (!match) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(Response.json(match[1]));
  }) as typeof fetch;
}

export const flush = (): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, 0));

export function createMockTransport(): SessionTransport & {
  sent: (string | ArrayBuffer | Uint8Array)[];
} {
  const sent: (string | ArrayBuffer | Uint8Array)[] = [];
  return {
    sent,
    readyState: 1,
    send(data: string | ArrayBuffer | Uint8Array) {
      sent.push(data);
    },
  };
}

export function getSentJson(
  transport: ReturnType<typeof createMockTransport>,
): Record<string, unknown>[] {
  return transport.sent
    .filter((d): d is string => typeof d === "string")
    .map((s) => JSON.parse(s));
}

export function createMockSttHandle(): SttHandle & {
  sentData: Uint8Array[];
  clearCalled: boolean;
  closeCalled: boolean;
} {
  const sentData: Uint8Array[] = [];
  return {
    sentData,
    clearCalled: false,
    closeCalled: false,
    send(audio: Uint8Array) {
      sentData.push(audio);
    },
    clear() {
      this.clearCalled = true;
    },
    close() {
      this.closeCalled = true;
    },
  };
}

export interface MockTtsClient {
  synthesizeStreamCalls: number;
  streamedText: string[];
  closeCalled: boolean;
  synthesizeStream(
    chunks: AsyncIterable<string>,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
}

export function createMockTtsClient(): MockTtsClient {
  return {
    synthesizeStreamCalls: 0,
    streamedText: [],
    closeCalled: false,
    async synthesizeStream(
      chunks: AsyncIterable<string>,
      _onAudio: (chunk: Uint8Array) => void,
      _signal?: AbortSignal,
    ): Promise<void> {
      this.synthesizeStreamCalls++;
      for await (const text of chunks) {
        this.streamedText.push(text);
      }
    },
    close() {
      this.closeCalled = true;
    },
  };
}

export interface MockExecuteTool {
  fn: ExecuteTool;
  calls: { name: string; args: Record<string, unknown> }[];
  mockResult: string;
}

export function createMockExecuteTool(): MockExecuteTool {
  const mock: MockExecuteTool = {
    fn: (name: string, args: Record<string, unknown>) => {
      mock.calls.push({ name, args });
      return Promise.resolve(mock.mockResult);
    },
    calls: [],
    mockResult: '"tool result"',
  };
  return mock;
}

export function createMockPlatformConfig(): PlatformConfig {
  return {
    apiKey: "test-api-key",
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" },
    model: "test-model",
    llmGatewayBase: "https://test-gateway.example.com/v1",
    braveApiKey: "",
  };
}

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

export function responses(
  ...rs: LLMResponse[]
): () => Promise<LLMResponse> {
  let i = 0;
  return () => {
    if (i >= rs.length) {
      throw new Error(`responses() exhausted after ${rs.length} call(s)`);
    }
    return Promise.resolve(rs[i++]);
  };
}

export function createMockSessionOptions(
  overrides?: Partial<
    Pick<
      SessionOptions,
      | "connectStt"
      | "callLLM"
      | "ttsClient"
      | "executeBuiltinTool"
    >
  >,
): {
  opts: SessionOptions;
  sttHandle: ReturnType<typeof createMockSttHandle>;
  ttsClient: ReturnType<typeof createMockTtsClient>;
  executeTool: MockExecuteTool;
  llmCalls: {
    messages: ChatMessage[];
    tools: ToolSchema[];
  }[];
  llmResponses: LLMResponse[];
} {
  const sttHandle = createMockSttHandle();
  const ttsClient = createMockTtsClient();
  const executeTool = createMockExecuteTool();
  const llmCalls: { messages: ChatMessage[]; tools: ToolSchema[] }[] = [];
  const llmResponses: LLMResponse[] = [
    createMockLLMResponse("Hello from LLM"),
  ];
  const nextResponse = responses(...llmResponses);

  const opts: SessionOptions = {
    id: "test-session-id",
    transport: createMockTransport(),
    agentConfig: {
      instructions: "Test instructions",
      greeting: "Hi there!",
      voice: "luna",
    },
    toolSchemas: [],
    platformConfig: createMockPlatformConfig(),
    executeTool: executeTool.fn,
    connectStt: () => Promise.resolve(sttHandle),
    callLLM: (callOpts: CallLLMOptions) => {
      llmCalls.push({
        messages: [...callOpts.messages],
        tools: callOpts.tools,
      });
      return nextResponse();
    },
    ttsClient,
    executeBuiltinTool: () => Promise.resolve(null),
    ...overrides,
  };

  return { opts, sttHandle, ttsClient, executeTool, llmCalls, llmResponses };
}

export function createMockSttEvents(
  overrides?: Partial<SttEvents>,
): SttEvents & {
  transcripts: { text: string; isFinal: boolean; turnOrder?: number }[];
  turns: { text: string; turnOrder?: number }[];
  terminations: { audioDuration: number; sessionDuration: number }[];
  errors: Error[];
  closed: boolean;
} {
  const transcripts: { text: string; isFinal: boolean; turnOrder?: number }[] =
    [];
  const turns: { text: string; turnOrder?: number }[] = [];
  const terminations: { audioDuration: number; sessionDuration: number }[] = [];
  const errors: Error[] = [];
  let closed = false;

  return {
    transcripts,
    turns,
    terminations,
    errors,
    get closed() {
      return closed;
    },
    onSpeechStarted() {},
    onTranscript(text, isFinal, turnOrder) {
      transcripts.push({ text, isFinal, turnOrder });
    },
    onTurn(text, turnOrder) {
      turns.push({ text, turnOrder });
    },
    onTermination(audioDuration, sessionDuration) {
      terminations.push({ audioDuration, sessionDuration });
    },
    onError(err) {
      errors.push(err);
    },
    onClose() {
      closed = true;
    },
    ...overrides,
  };
}

// --- From _test_fixtures.ts ---

export const VALID_ENV = {
  ASSEMBLYAI_API_KEY: "test-key",
};

export function createTestStore(): TigrisBundleStore {
  return new TigrisBundleStore(createMemoryS3Client(), "test-bucket");
}
