import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import { _internals, callLLM } from "./llm.ts";
import type { ChatMessage } from "./types.ts";
import type { ToolSchema } from "../sdk/types.ts";

function mockFetch(
  responseBody: unknown,
  status = 200,
): {
  fetch: typeof globalThis.fetch;
  lastRequest: () => { url: string; init: RequestInit } | null;
} {
  let _lastRequest: { url: string; init: RequestInit } | null = null;
  const fetchFn = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    _lastRequest = { url, init: init ?? {} };
    const resp = new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    return Promise.resolve(resp);
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, lastRequest: () => _lastRequest };
}

const messages: ChatMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hi" },
];

const okResponse = {
  choices: [{
    message: { role: "assistant", content: "Hello!" },
    finish_reason: "stop",
  }],
};

Deno.test("callLLM sends correct request shape", async () => {
  const ctx = mockFetch(okResponse);
  using _ = stub(_internals, "fetch", ctx.fetch);
  await callLLM({
    messages,
    tools: [],
    apiKey: "test-key",
    model: "test-model",
  });
  const lastRequest = ctx.lastRequest();
  expect(lastRequest!.url).toContain("/chat/completions");
  const reqBody = JSON.parse(lastRequest!.init.body as string);
  expect(reqBody.model).toBe("test-model");
});

Deno.test("callLLM returns parsed response", async () => {
  const ctx = mockFetch(okResponse);
  using _ = stub(_internals, "fetch", ctx.fetch);
  const result = await callLLM({
    messages,
    tools: [],
    apiKey: "key",
    model: "model",
  });
  expect(result.choices[0].message.content).toBe("Hello!");
});

Deno.test("callLLM includes tools when provided", async () => {
  const ctx = mockFetch(okResponse);
  using _ = stub(_internals, "fetch", ctx.fetch);
  const tools: ToolSchema[] = [
    {
      name: "get_weather",
      description: "Get weather",
      parameters: { type: "object", properties: {} },
    },
  ];
  await callLLM({
    messages,
    tools,
    apiKey: "key",
    model: "model",
  });
  const reqBody = JSON.parse(ctx.lastRequest()!.init.body as string);
  expect(reqBody.tools).toHaveLength(1);
  expect(reqBody.tools[0].function.name).toBe("get_weather");
});

Deno.test("callLLM throws on non-OK response", async () => {
  const ctx = mockFetch("Unauthorized", 401);
  using _ = stub(_internals, "fetch", ctx.fetch);
  await expect(
    callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
    }),
  ).rejects.toThrow(/401/);
});

Deno.test("callLLM sanitizes empty message content", async () => {
  const ctx = mockFetch(okResponse);
  using _ = stub(_internals, "fetch", ctx.fetch);
  const msgs: ChatMessage[] = [
    { role: "user", content: "" },
    { role: "user", content: "   " },
  ];
  await callLLM({
    messages: msgs,
    tools: [],
    apiKey: "key",
    model: "model",
  });
  const reqBody = JSON.parse(ctx.lastRequest()!.init.body as string);
  expect(reqBody.messages[0].content).toBe("...");
  expect(reqBody.messages[1].content).toBe("...");
});
