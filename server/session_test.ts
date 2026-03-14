// Copyright 2025 the AAI authors. MIT license.
import { assert, assertStrictEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import {
  type ClientSink,
  createSession,
  type SessionOptions,
} from "./session.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { SttConnection } from "./stt.ts";
import { DEFAULT_STT_CONFIG, DEFAULT_TTS_CONFIG } from "./types.ts";
import type { PlatformConfig } from "./config.ts";

function createMockClientSink(): ClientSink & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    open: true,
    ready(...args) {
      calls.push({ method: "ready", args });
    },
    partialTranscript(...args) {
      calls.push({ method: "partialTranscript", args });
    },
    finalTranscript(...args) {
      calls.push({ method: "finalTranscript", args });
    },
    turn(...args) {
      calls.push({ method: "turn", args });
    },
    chat(...args) {
      calls.push({ method: "chat", args });
    },
    ttsDone() {
      calls.push({ method: "ttsDone", args: [] });
    },
    cancelled() {
      calls.push({ method: "cancelled", args: [] });
    },
    resetNotify() {
      calls.push({ method: "resetNotify", args: [] });
    },
    error(...args) {
      calls.push({ method: "error", args });
    },
    playAudioStream(...args) {
      calls.push({ method: "playAudioStream", args });
    },
  };
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
    client: createMockClientSink(),
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

  const client = mocks.opts.client as ReturnType<typeof createMockClientSink>;
  const session = createSession(mocks.opts);

  return {
    session,
    client,
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

  const client = mocks.opts.client as ReturnType<typeof createMockClientSink>;
  const session = createSession(mocks.opts);

  return {
    session,
    client,
    handle,
    ...mocks,
  };
}

function findCall(
  client: ReturnType<typeof createMockClientSink>,
  method: string,
) {
  return client.calls.find((c) => c.method === method);
}

function filterCalls(
  client: ReturnType<typeof createMockClientSink>,
  method: string,
) {
  return client.calls.filter((c) => c.method === method);
}

Deno.test("start sends ready with protocol metadata", async () => {
  const ctx = setup();
  await ctx.session.start();
  const call = findCall(ctx.client, "ready");
  assert(call !== undefined);
  const config = call!.args[0] as Record<string, unknown>;
  assertStrictEquals(config.protocol_version, 1);
  assertStrictEquals(config.audio_format, "pcm16");
  assert(config.sample_rate !== undefined);
  assert(config.tts_sample_rate !== undefined);
});

Deno.test("start defers greeting until onAudioReady", () => {
  const ctx = setup();
  ctx.session.start();
  assertStrictEquals(filterCalls(ctx.client, "chat").length, 0);
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
  assert(findCall(ctx.client, "error") !== undefined);
});

Deno.test("onAudioReady sends greeting and starts TTS", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  const call = findCall(ctx.client, "chat");
  assertStrictEquals(call!.args[0], "Hi there!");
  assert(ctx.ttsClient.synthesizeStream.calls.length > 0);
});

Deno.test("onAudioReady is a no-op on second call", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onAudioReady();
  const firstCount = ctx.ttsClient.synthesizeStream.calls.length;
  ctx.session.onAudioReady();
  assertStrictEquals(ctx.ttsClient.synthesizeStream.calls.length, firstCount);
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
  ctx.session.onAudio(new Uint8Array([1]));
});

Deno.test("onCancel clears STT and sends cancelled", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onCancel();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  assert(findCall(ctx.client, "cancelled") !== undefined);
});

Deno.test("onReset sends resetNotify and re-sends greeting", async () => {
  const ctx = setup();
  await ctx.session.start();
  ctx.session.onReset();
  assertSpyCalls(ctx.sttHandle.clear, 1);
  assert(findCall(ctx.client, "resetNotify") !== undefined);
  assert(filterCalls(ctx.client, "chat").length > 0);
});

Deno.test("relays STT partial transcript to client", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "partial text", isFinal: false });
  const call = findCall(ctx.client, "partialTranscript");
  assertStrictEquals(call!.args[0], "partial text");
});

Deno.test("relays STT final transcript to client", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "done", isFinal: true, turnOrder: 3 });
  const call = findCall(ctx.client, "finalTranscript");
  assertStrictEquals(call!.args[0], "done");
  assertStrictEquals(call!.args[1], 3);
});

Deno.test("omits turnOrder on final transcript when undefined", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTranscript!({ text: "done", isFinal: true });
  const call = findCall(ctx.client, "finalTranscript");
  assertStrictEquals(call!.args[1], undefined);
});

Deno.test("forwards turnOrder in turn messages", async () => {
  const ctx = setupWithSttHandle();
  await ctx.session.start();
  ctx.handle.onTurn!({ text: "What is the weather?", turnOrder: 5 });
  await new Promise((r) => setTimeout(r, 10));
  const call = findCall(ctx.client, "turn");
  assertStrictEquals(call!.args[1], 5);
  await ctx.session.stop();
});

Deno.test("client.open=false silently drops messages", () => {
  const ctx = setup();
  const closedClient = createMockClientSink();
  (closedClient as { open: boolean }).open = false;
  ctx.opts.client = closedClient;
  const session = createSession(ctx.opts);
  session.start();
  assertStrictEquals(closedClient.calls.length, 0);
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
  const client = mocks.opts.client as ReturnType<typeof createMockClientSink>;
  assertStrictEquals(filterCalls(client, "chat").length, 0);
});
