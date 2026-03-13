// Copyright 2025 the AAI authors. MIT license.
import { assertEquals, assertStrictEquals } from "@std/assert";
import { _internals } from "./model.ts";

const { gatewayBugMiddleware, createGatewayFetch, GatewayResponseSchema } =
  _internals;

/** Content part shape used in test assertions. */
type TestContentPart = { type: string; args?: unknown; text?: string };

/** Shape of the params returned by transformParams in tests. */
type TransformResult = {
  prompt: {
    role: string;
    content: string | TestContentPart[];
  }[];
  [key: string]: unknown;
};

/** Extract content parts array from a TransformResult message. */
function contentParts(
  result: TransformResult,
  msgIdx: number,
): TestContentPart[] {
  const content = result.prompt[msgIdx]!.content;
  if (typeof content === "string") throw new Error("Expected array content");
  return content;
}

// --- gatewayBugMiddleware.transformParams ---

Deno.test("gatewayBugMiddleware: replaces empty {} args with {_:''}", async () => {
  const params = {
    prompt: [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "1", toolName: "t", args: {} },
        ],
      },
    ],
  };
  const result = await gatewayBugMiddleware.transformParams!(
    { params } as never,
  ) as TransformResult;
  assertEquals(contentParts(result, 0)[0]!.args, { _: "" });
});

Deno.test("gatewayBugMiddleware: leaves non-empty args unchanged", async () => {
  const params = {
    prompt: [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "1",
            toolName: "t",
            args: { city: "NYC" },
          },
        ],
      },
    ],
  };
  const result = await gatewayBugMiddleware.transformParams!(
    { params } as never,
  ) as TransformResult;
  assertEquals(contentParts(result, 0)[0]!.args, { city: "NYC" });
});

Deno.test("gatewayBugMiddleware: skips non-assistant messages", async () => {
  const params = {
    prompt: [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "1", toolName: "t", args: {} },
        ],
      },
    ],
  };
  const result = await gatewayBugMiddleware.transformParams!(
    { params } as never,
  ) as TransformResult;
  assertEquals(result.prompt[0], { role: "user", content: "hello" });
  assertEquals(contentParts(result, 1)[0]!.args, { _: "" });
});

Deno.test("gatewayBugMiddleware: skips non-tool-call content parts", async () => {
  const params = {
    prompt: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "thinking..." },
          { type: "tool-call", toolCallId: "1", toolName: "t", args: {} },
        ],
      },
    ],
  };
  const result = await gatewayBugMiddleware.transformParams!(
    { params } as never,
  ) as TransformResult;
  assertEquals(contentParts(result, 0)[0]!, {
    type: "text",
    text: "thinking...",
  });
  assertEquals(contentParts(result, 0)[1]!.args, { _: "" });
});

Deno.test("gatewayBugMiddleware: returns params unchanged when prompt is not array", async () => {
  const params = { prompt: "not an array", model: "test" };
  const result = await gatewayBugMiddleware.transformParams!(
    { params } as never,
  ) as Record<string, unknown>;
  assertEquals(result, params);
});

Deno.test("gatewayBugMiddleware: does not patch array args", async () => {
  const params = {
    prompt: [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "1", toolName: "t", args: [] },
        ],
      },
    ],
  };
  const result = await gatewayBugMiddleware.transformParams!(
    { params } as never,
  ) as TransformResult;
  assertEquals(contentParts(result, 0)[0]!.args, []);
});

// --- createGatewayFetch ---

function mockFetch(body: string, status = 200): typeof globalThis.fetch {
  return () =>
    Promise.resolve(new Response(body, { status, statusText: "OK" }));
}

Deno.test("createGatewayFetch: passes through non-completions URLs", async () => {
  const inner = mockFetch('{"data":"ok"}');
  const gf = createGatewayFetch(inner);
  const res = await gf("https://example.com/v1/models", {});
  const json = await res.json();
  assertEquals(json, { data: "ok" });
});

Deno.test("createGatewayFetch: merges multiple choices into one", async () => {
  const body = JSON.stringify({
    choices: [
      { message: { content: "Hello" } },
      {
        message: {
          tool_calls: [{ id: "1", function: { name: "t", arguments: "{}" } }],
        },
      },
    ],
  });
  const gf = createGatewayFetch(mockFetch(body));
  const res = await gf("https://gw.example.com/v1/chat/completions", {});
  const json = GatewayResponseSchema.parse(await res.json());
  assertStrictEquals(json.choices.length, 1);
  assertStrictEquals(json.choices[0]!.message!.tool_calls!.length, 1);
  assertStrictEquals(json.choices[0]!.message!.content, "Hello");
  assertStrictEquals(json.choices[0]!.index, 0);
});

Deno.test("createGatewayFetch: adds index=0 to single choice missing index", async () => {
  const body = JSON.stringify({
    choices: [{ message: { content: "Hi" } }],
  });
  const gf = createGatewayFetch(mockFetch(body));
  const res = await gf("https://gw.example.com/chat/completions", {});
  const json = GatewayResponseSchema.parse(await res.json());
  assertStrictEquals(json.choices[0]!.index, 0);
});

Deno.test("createGatewayFetch: preserves existing index", async () => {
  const body = JSON.stringify({
    choices: [{ index: 3, message: { content: "Hi" } }],
  });
  const gf = createGatewayFetch(mockFetch(body));
  const res = await gf("https://gw.example.com/chat/completions", {});
  const json = GatewayResponseSchema.parse(await res.json());
  assertStrictEquals(json.choices[0]!.index, 3);
});

Deno.test("createGatewayFetch: returns non-JSON as-is", async () => {
  const gf = createGatewayFetch(mockFetch("not json"));
  const res = await gf("https://gw.example.com/chat/completions", {});
  const text = await res.text();
  assertStrictEquals(text, "not json");
});

Deno.test("createGatewayFetch: handles empty choices array", async () => {
  const body = JSON.stringify({ choices: [] });
  const gf = createGatewayFetch(mockFetch(body));
  const res = await gf("https://gw.example.com/chat/completions", {});
  const json = GatewayResponseSchema.parse(await res.json());
  assertEquals(json.choices, []);
});

Deno.test("createGatewayFetch: handles URL object input", async () => {
  const body = JSON.stringify({
    choices: [{ message: { content: "Hi" } }],
  });
  const gf = createGatewayFetch(mockFetch(body));
  const res = await gf(
    new URL("https://gw.example.com/chat/completions"),
    {},
  );
  const json = GatewayResponseSchema.parse(await res.json());
  assertStrictEquals(json.choices[0]!.index, 0);
});

Deno.test("createGatewayFetch: handles Request object input", async () => {
  const body = JSON.stringify({
    choices: [{ message: { content: "Hi" } }],
  });
  const gf = createGatewayFetch(mockFetch(body));
  const req = new Request("https://gw.example.com/chat/completions");
  const res = await gf(req, {});
  const json = GatewayResponseSchema.parse(await res.json());
  assertStrictEquals(json.choices[0]!.index, 0);
});

Deno.test("createGatewayFetch: tool_calls choice without content gets content from content-only choice", async () => {
  const body = JSON.stringify({
    choices: [
      { message: { content: "I'll help you with that." } },
      {
        message: {
          content: null,
          tool_calls: [
            { id: "1", function: { name: "search", arguments: '{"q":"x"}' } },
          ],
        },
      },
    ],
  });
  const gf = createGatewayFetch(mockFetch(body));
  const res = await gf("https://gw.example.com/chat/completions", {});
  const json = GatewayResponseSchema.parse(await res.json());
  assertStrictEquals(json.choices.length, 1);
  assertStrictEquals(
    json.choices[0]!.message!.content,
    "I'll help you with that.",
  );
  assertStrictEquals(json.choices[0]!.message!.tool_calls!.length, 1);
});

Deno.test("createGatewayFetch: preserves response status", async () => {
  const inner: typeof globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [] }), {
        status: 429,
        statusText: "Too Many Requests",
      }),
    );
  const gf = createGatewayFetch(inner);
  const res = await gf("https://gw.example.com/chat/completions", {});
  assertStrictEquals(res.status, 429);
});
