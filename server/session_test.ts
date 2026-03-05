import { expect } from "@std/expect";
import { createSession, type SessionOptions } from "./session.ts";
import type { AgentConfig } from "./types.ts";
import {
  createMockLLMResponse,
  createMockSessionOptions,
  type createMockTransport,
  getSentJson,
  responses,
} from "./_test_utils.ts";
import type { SttEvents } from "./stt.ts";

type SetupOverrides =
  & Partial<
    Pick<
      SessionOptions,
      | "connectStt"
      | "callLLM"
      | "ttsClient"
      | "executeBuiltinTool"
    >
  >
  & { toolSchemas?: SessionOptions["toolSchemas"] };

function setup(
  overrides?: SetupOverrides,
  agentConfig?: Partial<AgentConfig>,
) {
  const mocks = createMockSessionOptions(overrides);
  if (agentConfig) {
    mocks.opts.agentConfig = { ...mocks.opts.agentConfig, ...agentConfig };
  }
  if (overrides?.toolSchemas) {
    mocks.opts.toolSchemas = overrides.toolSchemas;
  }
  const transport = mocks.opts.transport as ReturnType<
    typeof createMockTransport
  >;
  const session = createSession(mocks.opts);
  return { session, transport, ...mocks };
}

function setupWithSttEvents(
  overrides?: SetupOverrides,
  agentConfig?: Partial<AgentConfig>,
) {
  const events: { current: SttEvents | null } = { current: null };
  const result = setup(
    {
      connectStt: (_key, _config, sttEvents) => {
        events.current = sttEvents;
        return Promise.resolve({
          send: () => {},
          clear: () => {},
          close: () => {},
        });
      },
      ...overrides,
    },
    agentConfig,
  );
  return { ...result, events };
}

Deno.test("createSession", async (t) => {
  await t.step("start()", async (t) => {
    await t.step("sends READY message with sample rates", async () => {
      const { session, transport } = setup();
      await session.start();
      const messages = getSentJson(transport);
      const ready = messages.find((m) => m.type === "ready");
      expect(ready).toBeDefined();
      expect(ready!.sample_rate).toBeDefined();
      expect(ready!.tts_sample_rate).toBeDefined();
    });

    await t.step("defers greeting until onAudioReady", () => {
      const { session, transport } = setup();
      session.start();
      const messages = getSentJson(transport);
      expect(messages.filter((m) => m.type === "chat")).toHaveLength(0);
    });

    await t.step("sends error on STT connection failure", async () => {
      const { session, transport } = setup({
        connectStt: () => {
          throw new Error("STT connection refused");
        },
      });
      await session.start();

      const messages = getSentJson(transport);
      expect(messages.find((m) => m.type === "error")).toBeDefined();
    });
  });

  await t.step("onAudioReady()", async (t) => {
    await t.step("sends greeting and starts TTS", async () => {
      const { session, transport, ttsClient } = setup();
      await session.start();

      session.onAudioReady();
      const messages = getSentJson(transport);
      const chat = messages.find((m) => m.type === "chat");
      expect(chat).toBeDefined();
      expect(chat!.text).toBe("Hi there!");
      expect(ttsClient.synthesizeStreamCalls).toBeGreaterThan(0);
    });

    await t.step("is a no-op on second call", async () => {
      const { session, ttsClient } = setup();
      await session.start();

      session.onAudioReady();
      const firstCount = ttsClient.synthesizeStreamCalls;
      session.onAudioReady();
      expect(ttsClient.synthesizeStreamCalls).toBe(firstCount);
    });
  });

  await t.step("onAudio()", async (t) => {
    await t.step("relays data to STT handle", async () => {
      const { session, sttHandle } = setup();
      await session.start();

      session.onAudio(new Uint8Array([1, 2, 3]));
      expect(sttHandle.sentData.length).toBe(1);
    });

    await t.step("does not throw before STT is connected", () => {
      const { session } = setup({
        connectStt: () => new Promise(() => {}), // never resolves
      });
      session.start();
      expect(() => session.onAudio(new Uint8Array([1]))).not.toThrow();
    });
  });

  await t.step("onCancel()", async (t) => {
    await t.step("clears STT and sends CANCELLED", async () => {
      const { session, transport, sttHandle } = setup();
      await session.start();

      session.onCancel();
      expect(sttHandle.clearCalled).toBe(true);
      expect(getSentJson(transport).find((m) => m.type === "cancelled"))
        .toBeDefined();
    });
  });

  await t.step("onReset()", async (t) => {
    await t.step("sends RESET and re-sends greeting", async () => {
      const { session, transport, sttHandle } = setup();
      await session.start();

      session.onReset();
      expect(sttHandle.clearCalled).toBe(true);
      const messages = getSentJson(transport);
      expect(messages.find((m) => m.type === "reset")).toBeDefined();
      expect(messages.filter((m) => m.type === "chat").length)
        .toBeGreaterThan(0);
    });
  });

  await t.step("handleTurn()", async (t) => {
    await t.step(
      "sends TURN, CHAT, triggers TTS",
      async () => {
        const ctx = setupWithSttEvents();
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
        expect(ctx.ttsClient.synthesizeStreamCalls).toBeGreaterThan(0);
      },
    );

    await t.step("handles tool calls", async () => {
      const toolResponse = createMockLLMResponse(null, [
        { id: "call1", name: "get_weather", arguments: '{"city":"NYC"}' },
      ]);
      const finalResponse = createMockLLMResponse("It's sunny in NYC.");

      const ctx = setupWithSttEvents({
        callLLM: responses(toolResponse, finalResponse),
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

      expect(ctx.executeTool.calls.length).toBe(1);
      expect(ctx.executeTool.calls[0].name).toBe("get_weather");
      const msgs = getSentJson(ctx.transport);
      expect(msgs.find((m) => m.type === "chat")!.text).toBe(
        "It's sunny in NYC.",
      );
    });

    await t.step("sends ERROR on LLM failure", async () => {
      const ctx = setupWithSttEvents({
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

    await t.step("sends TTS_DONE for empty response", async () => {
      const ctx = setupWithSttEvents({
        callLLM: () => Promise.resolve(createMockLLMResponse("")),
      });

      await ctx.session.start();

      ctx.events.current!.onTurn("Hello");
      await ctx.session.waitForTurn();

      expect(getSentJson(ctx.transport).find((m) => m.type === "tts_done"))
        .toBeDefined();
    });

    await t.step("relays STT partial transcript to browser", async () => {
      const ctx = setupWithSttEvents();
      await ctx.session.start();

      ctx.events.current!.onTranscript("partial text", false);
      const transcript = getSentJson(ctx.transport).find((m) =>
        m.type === "partial_transcript"
      );
      expect(transcript).toBeDefined();
      expect(transcript!.text).toBe("partial text");
    });

    await t.step("relays STT final transcript to browser", async () => {
      const ctx = setupWithSttEvents();
      await ctx.session.start();

      ctx.events.current!.onTranscript("done", true, 3);
      const transcript = getSentJson(ctx.transport).find((m) =>
        m.type === "final_transcript"
      );
      expect(transcript).toBeDefined();
      expect(transcript!.text).toBe("done");
      expect(transcript!.turn_order).toBe(3);
    });

    await t.step(
      "omits turn_order on final transcript when undefined",
      async () => {
        const ctx = setupWithSttEvents();
        await ctx.session.start();

        ctx.events.current!.onTranscript("done", true);
        const transcript = getSentJson(ctx.transport).find((m) =>
          m.type === "final_transcript"
        );
        expect(transcript!.turn_order).toBeUndefined();
      },
    );

    await t.step("forwards turn_order in turn messages", async () => {
      const ctx = setupWithSttEvents();
      await ctx.session.start();

      ctx.events.current!.onTurn("What is the weather?", 5);
      await ctx.session.waitForTurn();

      const turn = getSentJson(ctx.transport).find((m) => m.type === "turn");
      expect(turn!.turn_order).toBe(5);
    });

    await t.step("logs termination without error", async () => {
      const ctx = setupWithSttEvents();
      await ctx.session.start();

      // Should not throw
      ctx.events.current!.onTermination(30.0, 120.0);
    });
  });

  await t.step("trySendJson when WS is closed", async (t) => {
    await t.step("silently drops messages", () => {
      const mocks = createMockSessionOptions();
      mocks.opts.transport = {
        sent: [] as (string | ArrayBuffer | Uint8Array)[],
        readyState: 3,
        send(data: string | ArrayBuffer | Uint8Array) {
          (this as { sent: (string | ArrayBuffer | Uint8Array)[] }).sent.push(
            data,
          );
        },
      } as unknown as ReturnType<typeof createMockTransport>;
      const session = createSession(mocks.opts);
      session.start();
      expect(
        (mocks.opts.transport as unknown as { sent: unknown[] }).sent,
      ).toHaveLength(0);
    });
  });

  await t.step("stop()", async (t) => {
    await t.step("closes STT and TTS", async () => {
      const { session, sttHandle, ttsClient } = setup();
      await session.start();

      await session.stop();
      expect(sttHandle.closeCalled).toBe(true);
      expect(ttsClient.closeCalled).toBe(true);
    });

    await t.step("is idempotent", async () => {
      const { session, ttsClient } = setup();
      await session.start();

      await session.stop();
      const firstCloseCount = ttsClient.closeCalled;
      await session.stop();
      expect(ttsClient.closeCalled).toBe(firstCloseCount);
    });
  });
});
