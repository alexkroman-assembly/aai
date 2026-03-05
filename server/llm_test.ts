import { expect } from "@std/expect";
import { callLLM } from "./llm.ts";
import type { ChatMessage, ToolSchema } from "./types.ts";

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

Deno.test("callLLM", async (t) => {
  await t.step("sends correct request shape", async () => {
    const ctx = mockFetch(okResponse);
    await callLLM({
      messages,
      tools: [],
      apiKey: "test-key",
      model: "test-model",
      fetch: ctx.fetch,
    });

    const lastRequest = ctx.lastRequest();
    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.url).toContain("/chat/completions");
    const reqBody = JSON.parse(lastRequest!.init.body as string);
    expect(reqBody.model).toBe("test-model");
  });

  await t.step("returns parsed response", async () => {
    const ctx = mockFetch(okResponse);
    const result = await callLLM({
      messages,
      tools: [],
      apiKey: "key",
      model: "model",
      fetch: ctx.fetch,
    });

    expect(result.choices[0].message.content).toBe("Hello!");
  });

  await t.step("includes tools when provided", async () => {
    const ctx = mockFetch(okResponse);
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
      fetch: ctx.fetch,
    });

    const reqBody = JSON.parse(ctx.lastRequest()!.init.body as string);
    expect(reqBody.tools).toHaveLength(1);
    expect(reqBody.tools[0].function.name).toBe("get_weather");
  });

  await t.step("throws on non-OK response", async () => {
    const ctx = mockFetch("Unauthorized", 401);
    await expect(
      callLLM({
        messages,
        tools: [],
        apiKey: "key",
        model: "model",
        fetch: ctx.fetch,
      }),
    ).rejects.toThrow(/401/);
  });

  await t.step("sanitizes empty message content to '...'", async () => {
    const ctx = mockFetch(okResponse);
    const msgs: ChatMessage[] = [
      { role: "user", content: "" },
      { role: "user", content: "   " },
    ];
    await callLLM({
      messages: msgs,
      tools: [],
      apiKey: "key",
      model: "model",
      fetch: ctx.fetch,
    });

    const reqBody = JSON.parse(ctx.lastRequest()!.init.body as string);
    expect(reqBody.messages[0].content).toBe("...");
    expect(reqBody.messages[1].content).toBe("...");
  });
});
