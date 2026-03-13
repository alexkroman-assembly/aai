// Copyright 2025 the AAI authors. MIT license.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { createTtsConnection } from "./tts.ts";
import { DEFAULT_TTS_CONFIG } from "./types.ts";
import { installMockWebSocket } from "@aai/sdk/testing";
import { flush } from "./_test_utils.ts";

const config = { ...DEFAULT_TTS_CONFIG, apiKey: "test-tts-key" };

async function* textStream(...texts: string[]): AsyncGenerator<string> {
  for (const t of texts) yield t;
}

Deno.test("TtsConnection", async (t) => {
  await t.step("does not create a WebSocket on construction", () => {
    using mockWs = installMockWebSocket();
    const _conn = createTtsConnection(config);
    assertStrictEquals(mockWs.created.length, 0);
  });

  await t.step(
    "synthesizeStream sends text chunks + FLUSH and relays audio",
    async () => {
      using mockWs = installMockWebSocket();
      const conn = createTtsConnection(config);

      const chunks: Uint8Array[] = [];
      const promise = conn.synthesizeStream(
        textStream("Hello ", "world"),
        (chunk) => chunks.push(chunk),
      );

      await flush();
      const ws = mockWs.created[0]!;

      // Server sends audio
      ws.dispatchEvent(
        new MessageEvent("message", {
          data: new Uint8Array([10, 20]).buffer,
        }),
      );

      // Simulate connection close to trigger completion
      ws.close();
      await promise;

      assert(ws!.sent.includes("Hello "));
      assert(ws!.sent.includes("world"));
      assert(ws!.sent.includes("<FLUSH>"));

      assertStrictEquals(chunks.length, 1);
      assertEquals(chunks[0], new Uint8Array([10, 20]));
    },
  );

  await t.step(
    "resolves immediately when signal is already aborted",
    async () => {
      using _mockWs = installMockWebSocket();
      const conn = createTtsConnection(config);
      const controller = new AbortController();
      controller.abort();

      const chunks: Uint8Array[] = [];
      await conn.synthesizeStream(
        textStream("Hello"),
        (c) => chunks.push(c),
        controller.signal,
      );
      assertStrictEquals(chunks.length, 0);
    },
  );

  await t.step("aborts mid-synthesis and closes WebSocket", async () => {
    using mockWs = installMockWebSocket();
    const conn = createTtsConnection(config);

    const controller = new AbortController();
    const chunks: Uint8Array[] = [];
    const promise = conn.synthesizeStream(
      textStream("Long text"),
      (c) => chunks.push(c),
      controller.signal,
    );

    await flush();
    controller.abort();
    await promise;

    const ws = mockWs.created[0]!;
    assertStrictEquals(ws.readyState, WebSocket.CLOSED);
  });

  await t.step("close sends EOS and prevents further synthesis", async () => {
    using mockWs = installMockWebSocket();
    const conn = createTtsConnection(config);

    const p = conn.synthesizeStream(textStream("Hello"), () => {});
    await flush();
    mockWs.created[0]!.close();
    await p;

    conn.close();

    const chunks: Uint8Array[] = [];
    await conn.synthesizeStream(textStream("Hello"), (c) => chunks.push(c));
    assertStrictEquals(chunks.length, 0);
  });

  await t.step("close is idempotent", () => {
    const conn = createTtsConnection(config);
    conn.close();
    conn.close();
    assertStrictEquals(conn.closed, true);
  });
});
