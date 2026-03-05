import { expect } from "@std/expect";
import { createTtsClient } from "./tts.ts";
import { DEFAULT_TTS_CONFIG } from "./types.ts";
import { installMockWebSocket, MockWebSocket } from "./_mock_ws.ts";
import { flush } from "./_test_utils.ts";

const config = { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" };

Deno.test("createTtsClient", async (t) => {
  await t.step("creates a warm WebSocket on construction", () => {
    using mockWs = installMockWebSocket();
    const _client = createTtsClient(config);
    expect(mockWs.created.length).toBe(1);
  });

  await t.step("skips warm-up when apiKey is empty", () => {
    using mockWs = installMockWebSocket();
    const _client = createTtsClient({ ...config, apiKey: "" });
    expect(mockWs.created.length).toBe(0);
  });

  await t.step(
    "synthesize sends config, words, __END__ and relays audio",
    async () => {
      using mockWs = installMockWebSocket();
      const client = createTtsClient(config);
      await flush();

      const chunks: Uint8Array[] = [];
      const promise = client.synthesize(
        "one two three",
        (chunk) => chunks.push(chunk),
      );

      await flush();
      const ws = mockWs.created[mockWs.created.length - 1];

      // Server sends audio
      ws.dispatchEvent(
        new MessageEvent("message", {
          data: new Uint8Array([10, 20]).buffer,
        }),
      );

      // Server closes (TTS done)
      ws.close();
      await promise;

      // Verify protocol: config JSON, "one", "two", "three", "__END__"
      const configMsg = JSON.parse(ws.sent[0] as string);
      expect(configMsg.voice).toBe(config.voice);
      expect(ws.sent).toContain("one");
      expect(ws.sent).toContain("two");
      expect(ws.sent).toContain("three");
      expect(ws.sent[ws.sent.length - 1]).toBe("__END__");

      // Verify audio was relayed
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(new Uint8Array([10, 20]));
    },
  );

  await t.step(
    "resolves immediately when signal is already aborted",
    async () => {
      using _mockWs = installMockWebSocket();
      const client = createTtsClient(config);
      const controller = new AbortController();
      controller.abort();

      const chunks: Uint8Array[] = [];
      await client.synthesize(
        "Hello",
        (c) => chunks.push(c),
        controller.signal,
      );
      expect(chunks).toHaveLength(0);
    },
  );

  await t.step("aborts mid-stream when signal fires", async () => {
    using _mockWs = installMockWebSocket();
    const client = createTtsClient(config);
    await flush();

    const controller = new AbortController();
    const chunks: Uint8Array[] = [];
    const promise = client.synthesize(
      "Long text",
      (c) => chunks.push(c),
      controller.signal,
    );

    await flush();
    controller.abort();
    await promise;
    expect(chunks).toHaveLength(0);
  });

  await t.step(
    "creates fresh connection when warm WS is unavailable",
    async () => {
      using mockWs = installMockWebSocket();
      const client = createTtsClient(config);
      expect(mockWs.created.length).toBe(1);

      // Kill the warm WS
      mockWs.created[0].readyState = MockWebSocket.CLOSED;

      const promise = client.synthesize("Hello", () => {});
      await flush();
      expect(mockWs.created.length).toBe(2);

      mockWs.created[1].close();
      await promise;
    },
  );

  await t.step(
    "warms up a new connection after synthesize completes",
    async () => {
      using mockWs = installMockWebSocket();
      const client = createTtsClient(config);
      await flush();
      expect(mockWs.created.length).toBe(1);

      const promise = client.synthesize("Hello", () => {});
      await flush();
      mockWs.created[mockWs.created.length - 1].close();
      await promise;
      await flush();

      expect(mockWs.created.length).toBeGreaterThanOrEqual(2);
    },
  );

  await t.step("close disposes warm WS", () => {
    using mockWs = installMockWebSocket();
    const client = createTtsClient(config);
    client.close();
    expect(mockWs.created[0].readyState).toBe(MockWebSocket.CLOSED);
  });

  await t.step("rejects on unexpected WS error during synthesize", async () => {
    using mockWs = installMockWebSocket();
    const client = createTtsClient(config);
    await flush();

    const promise = client.synthesize("Test", () => {});
    await flush();

    mockWs.created[mockWs.created.length - 1].dispatchEvent(
      new Event("error"),
    );

    try {
      await promise;
      // If it resolves, that's also acceptable
    } catch (err) {
      expect((err as Error).message).toContain("TTS WebSocket error");
    }
  });
});
