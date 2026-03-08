import { expect } from "@std/expect";
import { assertSpyCalls, resolvesNext, spy, stub } from "@std/testing/mock";
import {
  _internals,
  createSession,
  type SessionOptions,
  type SessionTransport,
} from "./session.ts";
import type { AgentConfig, ToolSchema } from "../sdk/types.ts";
import { createMockLLMResponse } from "./_test_utils.ts";
import type { SttEvents } from "./stt.ts";
import type { ChatMessage, LLMResponse } from "./types.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";
import type { CallLLMOptions } from "./llm.ts";
import type { PlatformConfig } from "./config.ts";

function createMockTransport(): SessionTransport & {
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

function getSentJson(
  transport: ReturnType<typeof createMockTransport>,
): Record<string, unknown>[] {
  return transport.sent
    .filter((d): d is string => typeof d === "string")
    .map((s) => JSON.parse(s));
}

function createMockPlatformConfig(): PlatformConfig {
  return {
    apiKey: "test-api-key",
    sttConfig: { ...DEFAULT_STT_CONFIG },
    ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" },
    model: "test-model",
    llmGatewayBase: "https://test-gateway.example.com/v1",
    braveApiKey: "",
  };
}

function createMockSessionOptions() {
  const sttHandle = {
    send: spy((_audio: Uint8Array) => {}),
    clear: spy(() => {}),
    close: spy(() => {}),
  };

  const streamedText: string[] = [];
  const ttsClient = {
    streamedText,
    synthesizeStream: spy(
      async (
        chunks: string | AsyncIterable<string>,
        _onAudio: (chunk: Uint8Array) => void,
        _signal?: AbortSignal,
      ): Promise<void> => {
        if (typeof chunks === "string") {
          streamedText.push(chunks);
        } else {
          for await (const text of chunks) {
            streamedText.push(text);
          }
        }
      },
    ),
    close: spy(() => {}),
  };

  let mockResult = '"tool result"';
  const executeTool = spy(
    (_name: string, _args: Record<string, unknown>, _sessionId?: string) =>
      Promise.resolve(mockResult),
  );

  const llmCalls: { messages: ChatMessage[]; tools: ToolSchema[] }[] = [];
  const llmResponses: LLMResponse[] = [
    createMockLLMResponse("Hello from LLM"),
  ];
  const nextResponse = resolvesNext(llmResponses);

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
    executeTool,
  };

  return {
    opts,
    sttHandle,
    ttsClient,
    executeTool,
    llmCalls,
    llmResponses,
    get mockResult() {
      return mockResult;
    },
    set mockResult(v: string) {
      mockResult = v;
    },
    get mockCallLLM() {
      return (callOpts: CallLLMOptions) => {
        llmCalls.push({
          messages: [...callOpts.messages],
          tools: callOpts.tools,
        });
        return nextResponse();
      };
    },
  };
}

type SetupOptions = {
  connectStt?: typeof _internals.connectStt;
  callLLM?: (opts: CallLLMOptions) => Promise<LLMResponse>;
  toolSchemas?: ToolSchema[];
  agentConfig?: Partial<AgentConfig>;
};

function setup(options?: SetupOptions) {
  const mocks = createMockSessionOptions();
  if (options?.agentConfig) {
    mocks.opts.agentConfig = {
      ...mocks.opts.agentConfig,
      ...options.agentConfig,
    };
  }
  if (options?.toolSchemas) {
    mocks.opts.toolSchemas = options.toolSchemas;
  }

  const sttStub = stub(
    _internals,
    "connectStt",
    options?.connectStt ?? (() => Promise.resolve(mocks.sttHandle)),
  );
  const llmStub = stub(
    _internals,
    "callLLM",
    options?.callLLM ?? mocks.mockCallLLM,
  );
  const ttsStub = stub(
    _internals,
    "createTtsClient",
    () => mocks.ttsClient,
  );
  const builtinStub = stub(
    _internals,
    "executeBuiltinTool",
    () => Promise.resolve(null),
  );

  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const session = createSession(mocks.opts);

  return {
    session,
    transport,
    ...mocks,
    [Symbol.dispose]() {
      sttStub.restore();
      llmStub.restore();
      ttsStub.restore();
      builtinStub.restore();
    },
  };
}

function setupWithSttEvents(options?: SetupOptions) {
  const mocks = createMockSessionOptions();
  if (options?.agentConfig) {
    mocks.opts.agentConfig = {
      ...mocks.opts.agentConfig,
      ...options.agentConfig,
    };
  }
  if (options?.toolSchemas) {
    mocks.opts.toolSchemas = options.toolSchemas;
  }

  const events: { current: SttEvents | null } = { current: null };

  const sttStub = stub(_internals, "connectStt", (_key, _config, sttEvents) => {
    events.current = sttEvents;
    return Promise.resolve({
      send: () => {},
      clear: () => {},
      close: () => {},
    });
  });
  const llmStub = stub(
    _internals,
    "callLLM",
    options?.callLLM ?? mocks.mockCallLLM,
  );
  const ttsStub = stub(
    _internals,
    "createTtsClient",
    () => mocks.ttsClient,
  );
  const builtinStub = stub(
    _internals,
    "executeBuiltinTool",
    () => Promise.resolve(null),
  );

  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const session = createSession(mocks.opts);

  return {
    session,
    transport,
    events,
    ...mocks,
    [Symbol.dispose]() {
      sttStub.restore();
      llmStub.restore();
      ttsStub.restore();
      builtinStub.restore();
    },
  };
}

Deno.test("start sends READY message with sample rates", async () => {
  using ctx = setup();
  await ctx.session.start();
  const messages = getSentJson(ctx.transport);
  const ready = messages.find((m) => m.type === "ready");
  expect(ready).toBeDefined();
  expect(ready!.sample_rate).toBeDefined();
  expect(ready!.tts_sample_rate).toBeDefined();
});

Deno.test("start defers greeting until onAudioReady", () => {
  using ctx = setup();
  ctx.session.start();
  const messages = getSentJson(ctx.transport);
  expect(messages.filter((m) => m.type === "chat")).toHaveLength(0);
});

Deno.test("start sends error on STT connection failure", async () => {
  using ctx = setup({
    connectStt: () => {
      throw new Error("STT connection refused");
    },
  });
  await ctx.session.start();
  expect(getSentJson(ctx.transport).find((m) => m.type === "error"))
    .toBeDefined();
});

Deno.test("onAudioReady sends greeting and starts TTS", async () => {
  using ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  const chat = getSentJson(ctx.transport).find((m) => m.type === "chat");
  expect(chat!.text).toBe("Hi there!");
  expect(ctx.ttsClient.synthesizeStream.calls.length).toBeGreaterThan(0);
});

Deno.test("onAudioReady is a no-op on second call", async () => {
  using ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  const firstCount = ctx.ttsClient.synthesizeStream.calls.length;
  ctx.session.onAudioReady();
  expect(ctx.ttsClient.synthesizeStream.calls.length).toBe(firstCount);
});

Deno.test("onAudio relays data to STT handle", async () => {
  using ctx = setup();
  await ctx.session.start();
  ctx.session.onAudio(new Uint8Array([1, 2, 3]));
  assertSpyCalls(ctx.sttHandle.send, 1);
});

Deno.test("onAudio does not throw before STT is connected", () => {
  using ctx = setup({
    connectStt: () => new Promise(() => {}),
  });
  ctx.session.start();
  expect(() => ctx.session.onAudio(new Uint8Array([1]))).not.toThrow();
});

Deno.test("onCancel clears STT and sends CANCELLED", async () => {
  using ctx = setup();
  await ctx.session.start();
  ctx.session.onCancel();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  expect(getSentJson(ctx.transport).find((m) => m.type === "cancelled"))
    .toBeDefined();
});

Deno.test("onReset sends RESET and re-sends greeting", async () => {
  using ctx = setup();
  await ctx.session.start();
  ctx.session.onReset();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  const messages = getSentJson(ctx.transport);
  expect(messages.find((m) => m.type === "reset")).toBeDefined();
  expect(messages.filter((m) => m.type === "chat").length).toBeGreaterThan(0);
});

Deno.test("handleTurn sends TURN, CHAT, triggers TTS", async () => {
  using ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTurn("What is the weather?");
  await ctx.session.waitForTurn();

  const messages = getSentJson(ctx.transport);
  expect(messages.find((m) => m.type === "turn")!.text).toBe(
    "What is the weather?",
  );
  expect(messages.find((m) => m.type === "chat")!.text).toBe(
    "Hello from LLM",
  );
  expect(ctx.ttsClient.synthesizeStream.calls.length).toBeGreaterThan(0);
});

Deno.test("handleTurn handles tool calls", async () => {
  const toolResponse = createMockLLMResponse(null, [
    { id: "call1", name: "get_weather", arguments: '{"city":"NYC"}' },
  ]);
  const finalResponse = createMockLLMResponse("It's sunny in NYC.");

  using ctx = setupWithSttEvents({
    callLLM: resolvesNext([toolResponse, finalResponse]),
    toolSchemas: [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: {} },
      },
    ],
  });
  await ctx.session.start();
  ctx.events.current!.onTurn("What's the weather in NYC?");
  await ctx.session.waitForTurn();

  assertSpyCalls(ctx.executeTool, 1);
  expect(ctx.executeTool.calls[0].args[0]).toBe("get_weather");
  expect(getSentJson(ctx.transport).find((m) => m.type === "chat")!.text).toBe(
    "It's sunny in NYC.",
  );
});

Deno.test("handleTurn sends ERROR on LLM failure", async () => {
  using ctx = setupWithSttEvents({
    callLLM: () => {
      throw new Error("LLM unavailable");
    },
  });
  await ctx.session.start();
  ctx.events.current!.onTurn("Hello");
  await ctx.session.waitForTurn();
  expect(getSentJson(ctx.transport).find((m) => m.type === "error"))
    .toBeDefined();
});

Deno.test("handleTurn sends TTS_DONE for empty response", async () => {
  using ctx = setupWithSttEvents({
    callLLM: () => Promise.resolve(createMockLLMResponse("")),
  });
  await ctx.session.start();
  ctx.events.current!.onTurn("Hello");
  await ctx.session.waitForTurn();
  expect(getSentJson(ctx.transport).find((m) => m.type === "tts_done"))
    .toBeDefined();
});

Deno.test("relays STT partial transcript to browser", async () => {
  using ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTranscript("partial text", false);
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "partial_transcript"
  );
  expect(transcript!.text).toBe("partial text");
});

Deno.test("relays STT final transcript to browser", async () => {
  using ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTranscript("done", true, 3);
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "final_transcript"
  );
  expect(transcript!.text).toBe("done");
  expect(transcript!.turn_order).toBe(3);
});

Deno.test("omits turn_order on final transcript when undefined", async () => {
  using ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTranscript("done", true);
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "final_transcript"
  );
  expect(transcript!.turn_order).toBeUndefined();
});

Deno.test("forwards turn_order in turn messages", async () => {
  using ctx = setupWithSttEvents();
  await ctx.session.start();
  ctx.events.current!.onTurn("What is the weather?", 5);
  await ctx.session.waitForTurn();
  const turn = getSentJson(ctx.transport).find((m) => m.type === "turn");
  expect(turn!.turn_order).toBe(5);
});

Deno.test("trySendJson silently drops messages when WS is closed", () => {
  using ctx = setup();
  ctx.opts.transport = {
    sent: [] as (string | ArrayBuffer | Uint8Array)[],
    readyState: 3,
    send(data: string | ArrayBuffer | Uint8Array) {
      (this as { sent: (string | ArrayBuffer | Uint8Array)[] }).sent.push(data);
    },
  } as unknown as ReturnType<typeof createMockTransport>;
  const session = createSession(ctx.opts);
  session.start();
  expect(
    (ctx.opts.transport as unknown as { sent: unknown[] }).sent,
  ).toHaveLength(0);
});

Deno.test("stop closes STT and TTS", async () => {
  using ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  assertSpyCalls(ctx.sttHandle.close, 1);
  assertSpyCalls(ctx.ttsClient.close, 1);
});

Deno.test("stop is idempotent", async () => {
  using ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  assertSpyCalls(ctx.ttsClient.close, 1);
  await ctx.session.stop();
  assertSpyCalls(ctx.ttsClient.close, 1);
});
