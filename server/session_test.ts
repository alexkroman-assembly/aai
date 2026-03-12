import { expect } from "@std/expect";
import { assertSpyCalls, spy } from "@std/testing/mock";
import {
  createSession,
  type SessionOptions,
  type SessionTransport,
} from "./session.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { SttConnection } from "./stt.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";
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
  };
}

type MockSttHandle = SttConnection & {
  connect: ReturnType<typeof spy>;
  send: ReturnType<typeof spy>;
  clear: ReturnType<typeof spy>;
  close: ReturnType<typeof spy>;
};

function createMockSttHandle(): MockSttHandle {
  return {
    connected: true,
    closed: false,
    onTranscript: null,
    onTurn: null,
    onError: null,
    onClose: null,
    connect: spy(() => Promise.resolve()),
    send: spy((_audio: Uint8Array) => {}),
    clear: spy(() => {}),
    close: spy(() => {}),
  } as unknown as MockSttHandle;
}

function createMockSessionOptions() {
  const sttHandle = createMockSttHandle();

  const streamedText: string[] = [];
  const ttsClient = {
    streamedText,
    warmup: spy(() => {}),
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
  } as unknown as import("./tts.ts").TtsConnection & {
    streamedText: string[];
    warmup: ReturnType<typeof spy>;
    synthesizeStream: ReturnType<typeof spy>;
    close: ReturnType<typeof spy>;
  };

  const executeTool = spy(
    (_name: string, _args: Record<string, unknown>, _sessionId?: string) =>
      Promise.resolve('"tool result"'),
  );

  const opts: SessionOptions = {
    id: "test-session-id",
    agent: "test/agent",
    transport: createMockTransport(),
    agentConfig: {
      name: "Test Agent",
      instructions: "Test instructions",
      greeting: "Hi there!",
      voice: "luna",
    },
    toolSchemas: [],
    platformConfig: createMockPlatformConfig(),
    executeTool,
    createStt: () => sttHandle,
    createTts: () => ttsClient,
  };

  return {
    opts,
    sttHandle,
    ttsClient,
    executeTool,
  };
}

type SetupOptions = {
  createStt?: SessionOptions["createStt"];
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
  if (options?.createStt) {
    mocks.opts.createStt = options.createStt;
  }

  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const session = createSession(mocks.opts);

  return {
    session,
    transport,
    ...mocks,
  };
}

function setupWithSttHandle(options?: SetupOptions) {
  const mocks = createMockSessionOptions();
  if (options?.agentConfig) {
    mocks.opts.agentConfig = {
      ...mocks.opts.agentConfig,
      ...options.agentConfig,
    };
  }

  const handle: SttConnection = {
    connected: true,
    closed: false,
    onTranscript: null,
    onTurn: null,
    onError: null,
    onClose: null,
    connect: () => Promise.resolve(),
    send: () => {},
    clear: () => {},
    close: () => {},
  };

  mocks.opts.createStt = () => handle;

  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const session = createSession(mocks.opts);

  return {
    session,
    transport,
    handle,
    ...mocks,
  };
}

Deno.test("start sends READY message with protocol metadata", async () => {
  const ctx = setup();
  await ctx.session.start();
  const messages = getSentJson(ctx.transport);
  const ready = messages.find((m) => m.type === "ready");
  expect(ready).toBeDefined();
  expect(ready!.protocol_version).toBe(1);
  expect(ready!.audio_format).toBe("pcm16");
  expect(ready!.sample_rate).toBeDefined();
  expect(ready!.tts_sample_rate).toBeDefined();
});

Deno.test("start defers greeting until onAudioReady", () => {
  const ctx = setup();
  ctx.session.start();
  const messages = getSentJson(ctx.transport);
  expect(messages.filter((m) => m.type === "chat")).toHaveLength(0);
});

Deno.test("start sends error on STT connection failure", async () => {
  const ctx = setup({
    createStt: (): SttConnection => ({
      connected: false,
      closed: false,
      onTranscript: null,
      onTurn: null,
      onError: null,
      onClose: null,
      connect: () => Promise.reject(new Error("STT connection refused")),
      send: () => {},
      clear: () => {},
      close: () => {},
    }),
  });
  await ctx.session.start();
  expect(getSentJson(ctx.transport).find((m) => m.type === "error"))
    .toBeDefined();
});

Deno.test("onAudioReady sends greeting and starts TTS", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  const chat = getSentJson(ctx.transport).find((m) => m.type === "chat");
  expect(chat!.text).toBe("Hi there!");
  expect(ctx.ttsClient.synthesizeStream.calls.length).toBeGreaterThan(0);
});

Deno.test("onAudioReady is a no-op on second call", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  const firstCount = ctx.ttsClient.synthesizeStream.calls.length;
  ctx.session.onAudioReady();
  expect(ctx.ttsClient.synthesizeStream.calls.length).toBe(firstCount);
});

Deno.test("onAudio relays data to STT handle", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudio(new Uint8Array([1, 2, 3]));
  assertSpyCalls(ctx.sttHandle.send, 1);
});

Deno.test("onAudio does not throw before STT is connected", () => {
  const ctx = setup({
    createStt: (): SttConnection => ({
      connected: false,
      closed: false,
      onTranscript: null,
      onTurn: null,
      onError: null,
      onClose: null,
      connect: () => new Promise<void>(() => {}),
      send: () => {},
      clear: () => {},
      close: () => {},
    }),
  });
  ctx.session.start();
  expect(() => ctx.session.onAudio(new Uint8Array([1]))).not.toThrow();
});

Deno.test("onCancel clears STT and sends CANCELLED", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onCancel();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  expect(getSentJson(ctx.transport).find((m) => m.type === "cancelled"))
    .toBeDefined();
});

Deno.test("onReset sends RESET and re-sends greeting", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onReset();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  const messages = getSentJson(ctx.transport);
  expect(messages.find((m) => m.type === "reset")).toBeDefined();
  expect(messages.filter((m) => m.type === "chat").length).toBeGreaterThan(0);
});

Deno.test("relays STT partial transcript to browser", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  // Session wires onTranscript after connect — invoke it directly
  ctx.handle.onTranscript!({ text: "partial text", isFinal: false });
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "partial_transcript"
  );
  expect(transcript!.text).toBe("partial text");
});

Deno.test("relays STT final transcript to browser", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "done", isFinal: true, turnOrder: 3 });
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "final_transcript"
  );
  expect(transcript!.text).toBe("done");
  expect(transcript!.turn_order).toBe(3);
});

Deno.test("omits turn_order on final transcript when undefined", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "done", isFinal: true });
  const transcript = getSentJson(ctx.transport).find((m) =>
    m.type === "final_transcript"
  );
  expect(transcript!.turn_order).toBeUndefined();
});

Deno.test("forwards turn_order in turn messages", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTurn!({ text: "What is the weather?", turnOrder: 5 });
  // Check the turn message was sent immediately (before LLM call)
  await new Promise((r) => setTimeout(r, 10));
  const turn = getSentJson(ctx.transport).find((m) => m.type === "turn");
  expect(turn!.turn_order).toBe(5);
  // Stop session to abort the in-flight LLM call
  await ctx.session.stop();
});

Deno.test("trySendJson silently drops messages when WS is closed", () => {
  const ctx = setup();
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
  const ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  assertSpyCalls(ctx.sttHandle.close, 1);
  assertSpyCalls(ctx.ttsClient.close, 1);
});

Deno.test("stop is idempotent", async () => {
  const ctx = setup();
  await ctx.session.start();
  await ctx.session.stop();
  assertSpyCalls(ctx.ttsClient.close, 1);
  await ctx.session.stop();
  assertSpyCalls(ctx.ttsClient.close, 1);
});

Deno.test("onHistory restores conversation messages", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onHistory([
    { role: "user", text: "Hello" },
    { role: "assistant", text: "Hi there" },
  ]);
  // Verify no errors thrown — history is stored internally
});

Deno.test("skipGreeting suppresses greeting on start", async () => {
  const mocks = createMockSessionOptions();
  mocks.opts.skipGreeting = true;

  const session = createSession(mocks.opts);
  await session.start();
  session.onAudioReady();
  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const chatMessages = getSentJson(transport).filter((m) => m.type === "chat");
  expect(chatMessages).toHaveLength(0);
});
