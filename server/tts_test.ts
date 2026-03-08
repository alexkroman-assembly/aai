import { expect } from "@std/expect";
import { createTtsClient } from "./tts.ts";
import { DEFAULT_TTS_CONFIG } from "./types.ts";
import { installMockWebSocket } from "./_mock_ws.ts";
import { flush } from "./_test_utils.ts";

const config = { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" };

async function* textStream(...texts: string[]): AsyncGenerator<string> {
  for (const t of texts) yield t;
}

Deno.test("createTtsClient", async (t) => {
  await t.step("does not create a WebSocket on construction", () => {
    using mockWs = installMockWebSocket();
    const _client = createTtsClient(config);
    expect(mockWs.created.length).toBe(0);
  });

  await t.step(
    "synthesizeStream sends text chunks + FLUSH and relays audio",
    async () => {
      using mockWs = installMockWebSocket();
      const client = createTtsClient(config);

      const chunks: Uint8Array[] = [];
      const promise = client.synthesizeStream(
        textStream("Hello ", "world"),
        (chunk) => chunks.push(chunk),
      );

      await flush();
      const ws = mockWs.created[0];

      // Server sends audio
      ws.dispatchEvent(
        new MessageEvent("message", {
          data: new Uint8Array([10, 20]).buffer,
        }),
      );

      // Simulate connection close to trigger completion
      ws.close();
      await promise;

      expect(ws.sent).toContain("Hello ");
      expect(ws.sent).toContain("world");
      expect(ws.sent).toContain("<FLUSH>");

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
      await client.synthesizeStream(
        textStream("Hello"),
        (c) => chunks.push(c),
        controller.signal,
      );
      expect(chunks).toHaveLength(0);
    },
  );

  await t.step("aborts mid-synthesis and closes WebSocket", async () => {
    using mockWs = installMockWebSocket();
    const client = createTtsClient(config);

    const controller = new AbortController();
    const chunks: Uint8Array[] = [];
    const promise = client.synthesizeStream(
      textStream("Long text"),
      (c) => chunks.push(c),
      controller.signal,
    );

    await flush();
    controller.abort();
    await promise;

    const ws = mockWs.created[0];
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  await t.step("close sends EOS and prevents further synthesis", async () => {
    using mockWs = installMockWebSocket();
    const client = createTtsClient(config);

    const p = client.synthesizeStream(textStream("Hello"), () => {});
    await flush();
    mockWs.created[0].close();
    await p;

    client.close();

    const chunks: Uint8Array[] = [];
    await client.synthesizeStream(textStream("Hello"), (c) => chunks.push(c));
    expect(chunks).toHaveLength(0);
  });
});
