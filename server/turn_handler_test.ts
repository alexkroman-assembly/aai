import { expect } from "@std/expect";
import { assertSpyCalls, resolvesNext, spy } from "@std/testing/mock";
import { executeTurn, type TurnCallLLMOptions } from "./turn_handler.ts";
import { createMockLLMResponse } from "./_test_utils.ts";
import type { ChatMessage, LLMResponse } from "./types.ts";
import type { ToolSchema } from "../sdk/types.ts";

function ctx(overrides?: {
  messages?: ChatMessage[];
  toolSchemas?: ToolSchema[];
  callLLM?: (opts: TurnCallLLMOptions) => Promise<LLMResponse>;
  executeTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;
}) {
  const executeTool = spy(
    overrides?.executeTool ??
      ((_name: string, _args: Record<string, unknown>) =>
        Promise.resolve('"tool result"')),
  );
  return {
    messages: overrides?.messages ??
      [{ role: "system" as const, content: "You are helpful." }],
    toolSchemas: overrides?.toolSchemas ?? [] as ToolSchema[],
    callLLM: overrides?.callLLM ??
      (() => Promise.resolve(createMockLLMResponse("Hello from LLM"))),
    executeTool,
  };
}

function run(c: ReturnType<typeof ctx>, text: string, signal?: AbortSignal) {
  return executeTurn(text, {
    messages: c.messages,
    toolSchemas: c.toolSchemas,
    callLLM: c.callLLM,
    executeTool: c.executeTool,
    signal: signal ?? new AbortController().signal,
  });
}

Deno.test("pushes user message and returns LLM text", async () => {
  const c = ctx();
  const result = await run(c, "Hello");
  expect(result).toBe("Hello from LLM");
  expect(c.messages[1]).toEqual({ role: "user", content: "Hello" });
  expect(c.messages[2]).toEqual({
    role: "assistant",
    content: "Hello from LLM",
  });
});

Deno.test("passes signal to callLLM", async () => {
  const abort = new AbortController();
  const callLLM = spy((_opts: TurnCallLLMOptions) =>
    Promise.resolve(createMockLLMResponse("ok"))
  );
  const c = ctx({ callLLM });
  await run(c, "Hi", abort.signal);
  expect(callLLM.calls[0].args[0].signal).toBe(abort.signal);
});

Deno.test("returns fallback text when LLM content is null", async () => {
  const c = ctx({ callLLM: resolvesNext([createMockLLMResponse(null)]) });
  const result = await run(c, "Hi");
  expect(result).toBe("Sorry, I couldn't generate a response.");
});

Deno.test("returns empty text when choices array is empty", async () => {
  const c = ctx({ callLLM: () => Promise.resolve({ choices: [] }) });
  const result = await run(c, "Hi");
  expect(result).toBe("");
});

Deno.test("mutates the messages array in-place", async () => {
  const messages: ChatMessage[] = [{
    role: "system",
    content: "System prompt",
  }];
  const c = ctx({ messages });
  await run(c, "Hi");
  expect(messages.length).toBe(3);
  expect(messages[1].role).toBe("user");
  expect(messages[2].role).toBe("assistant");
});

Deno.test("executes tool and re-calls LLM with results", async () => {
  const c = ctx({
    callLLM: resolvesNext([
      createMockLLMResponse(null, [{
        id: "c1",
        name: "get_weather",
        arguments: '{"city":"NYC"}',
      }]),
      createMockLLMResponse("Sunny in NYC."),
    ]),
  });
  const result = await run(c, "Weather?");
  expect(result).toBe("Sunny in NYC.");
  assertSpyCalls(c.executeTool, 1);
  expect(c.executeTool.calls[0].args).toEqual(["get_weather", { city: "NYC" }]);
  expect(c.messages[3].role).toBe("tool");
});

Deno.test("handles invalid JSON tool arguments gracefully", async () => {
  const c = ctx({
    callLLM: resolvesNext([
      createMockLLMResponse(null, [{
        id: "c1",
        name: "bad_tool",
        arguments: "not json",
      }]),
      createMockLLMResponse("Recovered."),
    ]),
  });
  const result = await run(c, "Test");
  expect(result).toBe("Recovered.");
  expect(
    c.messages.find((m) =>
      m.role === "tool" && m.content?.includes("Invalid JSON")
    ),
  ).toBeDefined();
});

Deno.test("handles rejected tool execution", async () => {
  const c = ctx({
    callLLM: resolvesNext([
      createMockLLMResponse(null, [{
        id: "c1",
        name: "failing",
        arguments: "{}",
      }]),
      createMockLLMResponse("Handled."),
    ]),
    executeTool: () => Promise.reject(new Error("tool boom")),
  });
  const result = await run(c, "Go");
  expect(result).toBe("Handled.");
  expect(
    c.messages.find((m) => m.role === "tool" && m.content?.includes("Error:")),
  ).toBeDefined();
});

Deno.test("executes multiple tool calls in parallel", async () => {
  const c = ctx({
    callLLM: resolvesNext([
      createMockLLMResponse(null, [
        { id: "c1", name: "tool_a", arguments: '{"a":1}' },
        { id: "c2", name: "tool_b", arguments: '{"b":2}' },
      ]),
      createMockLLMResponse("Both done."),
    ]),
  });
  const result = await run(c, "Go");
  expect(result).toBe("Both done.");
  assertSpyCalls(c.executeTool, 2);
  const toolMsgs = c.messages.filter((m) => m.role === "tool");
  expect(toolMsgs[0].tool_call_id).toBe("c1");
  expect(toolMsgs[1].tool_call_id).toBe("c2");
});

Deno.test("forces final_answer after MAX_TOOL_ITERATIONS", async () => {
  const toolResp = createMockLLMResponse(null, [
    { id: "c1", name: "loop_tool", arguments: "{}" },
  ]);
  const forcedResp = createMockLLMResponse(null, [
    {
      id: "c2",
      name: "final_answer",
      arguments: '{"answer":"Here are the results."}',
    },
  ]);
  const schemas: ToolSchema[] = [
    {
      name: "loop_tool",
      description: "loops",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "final_answer",
      description: "deliver answer",
      parameters: { type: "object", properties: {} },
    },
  ];

  const callLLM = spy((opts: TurnCallLLMOptions) => {
    if (opts.tools.length === 1 && opts.tools[0].name === "final_answer") {
      return Promise.resolve(forcedResp);
    }
    return Promise.resolve(toolResp);
  });
  const c = ctx({ toolSchemas: schemas, callLLM });
  const result = await run(c, "Go");
  expect(result).toBe("Here are the results.");
  assertSpyCalls(c.executeTool, 5);
  assertSpyCalls(callLLM, 6);
});

Deno.test("skips truncated tool calls on max_tokens and retries", async () => {
  const truncatedResp: LLMResponse = {
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "c1",
          type: "function" as const,
          function: { name: "run_code", arguments: "{}" },
        }],
      },
      finish_reason: "max_tokens",
    }],
  };
  const c = ctx({
    callLLM: resolvesNext([
      truncatedResp,
      createMockLLMResponse(null, [{
        id: "c2",
        name: "final_answer",
        arguments: '{"answer":"Here you go."}',
      }]),
    ]),
  });
  const result = await run(c, "Run code");
  expect(result).toBe("Here you go.");
  assertSpyCalls(c.executeTool, 0);
});

// --- final_answer and user_input ---

for (
  const [toolName, field, input, expected] of [
    ["final_answer", "answer", "Why blue?", "The sky is blue."],
    ["user_input", "question", "Help me", "What color do you prefer?"],
  ] as const
) {
  Deno.test(`${toolName} short-circuits the loop`, async () => {
    const callLLM = spy(() =>
      Promise.resolve(
        createMockLLMResponse(null, [{
          id: "c1",
          name: toolName,
          arguments: JSON.stringify({ [field]: expected }),
        }]),
      )
    );
    const c = ctx({ callLLM });
    const result = await run(c, input);
    expect(result).toBe(expected);
    assertSpyCalls(c.executeTool, 0);
    assertSpyCalls(callLLM, 1);
  });

  Deno.test(`${toolName} wins over other tool calls`, async () => {
    const c = ctx({
      callLLM: resolvesNext([
        createMockLLMResponse(null, [
          { id: "c1", name: "web_search", arguments: '{"query":"test"}' },
          {
            id: "c2",
            name: toolName,
            arguments: JSON.stringify({ [field]: expected }),
          },
        ]),
      ]),
    });
    const result = await run(c, "Search");
    expect(result).toBe(expected);
    assertSpyCalls(c.executeTool, 0);
  });

  Deno.test(`${toolName} returns empty string for malformed arguments`, async () => {
    const c = ctx({
      callLLM: resolvesNext([
        createMockLLMResponse(null, [{
          id: "c1",
          name: toolName,
          arguments: "not json",
        }]),
      ]),
    });
    const result = await run(c, "Hi");
    expect(result).toBe("");
  });
}

Deno.test("final_answer works after other tools execute first", async () => {
  const c = ctx({
    callLLM: resolvesNext([
      createMockLLMResponse(null, [{
        id: "c1",
        name: "web_search",
        arguments: '{"query":"weather"}',
      }]),
      createMockLLMResponse(null, [{
        id: "c2",
        name: "final_answer",
        arguments: '{"answer":"It is sunny."}',
      }]),
    ]),
  });
  const result = await run(c, "Weather?");
  expect(result).toBe("It is sunny.");
});

Deno.test("user_input adds question to messages as assistant content", async () => {
  const c = ctx({
    callLLM: resolvesNext([
      createMockLLMResponse(null, [{
        id: "c1",
        name: "user_input",
        arguments: '{"question":"How many?"}',
      }]),
    ]),
  });
  await run(c, "Count things");
  const lastMsg = c.messages[c.messages.length - 1];
  expect(lastMsg.role).toBe("assistant");
  expect(lastMsg.content).toBe("How many?");
});

Deno.test("stops tool loop when signal is aborted mid-iteration", async () => {
  const abort = new AbortController();
  const c = ctx({
    callLLM: resolvesNext([
      createMockLLMResponse(null, [{
        id: "c1",
        name: "slow",
        arguments: "{}",
      }]),
    ]),
    executeTool: () => {
      abort.abort();
      return Promise.resolve("done");
    },
  });
  const result = await run(c, "Go", abort.signal);
  expect(result).toBe("");
});
