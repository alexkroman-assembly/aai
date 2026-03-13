// Copyright 2025 the AAI authors. MIT license.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  type CoreMessage,
  jsonSchema,
  type LanguageModelV1,
  tool as vercelTool,
  type ToolSet,
} from "ai";
import { MockLanguageModelV1 } from "ai/test";
import { executeTurn } from "./turn_handler.ts";

function makeModel(
  responses: {
    text?: string;
    toolCalls?: { toolName: string; args: Record<string, unknown> }[];
  }[],
): LanguageModelV1 {
  let callIndex = 0;
  return new MockLanguageModelV1({
    doGenerate: () => {
      const resp = responses[callIndex++] ??
        { text: "Sorry, I couldn't generate a response." };
      return Promise.resolve({
        rawCall: { rawPrompt: "", rawSettings: {} },
        finishReason: resp.toolCalls?.length
          ? ("tool-calls" as const)
          : ("stop" as const),
        usage: { promptTokens: 10, completionTokens: 10 },
        ...(resp.text !== undefined ? { text: resp.text } : {}),
        ...(resp.toolCalls
          ? {
            toolCalls: resp.toolCalls.map((tc) => ({
              toolCallType: "function" as const,
              toolCallId: `call_${callIndex}_${tc.toolName}`,
              toolName: tc.toolName,
              args: JSON.stringify(tc.args),
            })),
          }
          : {}),
      });
    },
  }) as LanguageModelV1;
}

function makeTools(): ToolSet {
  return {
    final_answer: vercelTool({
      description: "Deliver answer",
      parameters: jsonSchema({
        type: "object",
        properties: { answer: { type: "string" } },
      }),
    }) as unknown as ToolSet[string],
    user_input: vercelTool({
      description: "Ask user",
      parameters: jsonSchema({
        type: "object",
        properties: { question: { type: "string" } },
      }),
    }) as unknown as ToolSet[string],
  };
}

Deno.test("returns text response when no tools called", async () => {
  const model = makeModel([{ text: "Hello from LLM" }]);
  const messages: CoreMessage[] = [];
  const result = await executeTurn("Hello", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages,
    tools: {},
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "Hello from LLM");
  // User message + response messages appended
  assertEquals(messages[0], { role: "user", content: "Hello" });
  assert(messages.length >= 2);
});

Deno.test("extracts answer from final_answer tool call", async () => {
  const model = makeModel([{
    toolCalls: [{
      toolName: "final_answer",
      args: { answer: "The sky is blue." },
    }],
  }]);
  const messages: CoreMessage[] = [];
  const result = await executeTurn("Why blue?", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages,
    tools: makeTools(),
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "The sky is blue.");
});

Deno.test("extracts question from user_input tool call", async () => {
  const model = makeModel([{
    toolCalls: [{
      toolName: "user_input",
      args: { question: "What color?" },
    }],
  }]);
  const messages: CoreMessage[] = [];
  const result = await executeTurn("Help me", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages,
    tools: makeTools(),
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "What color?");
});

Deno.test("returns fallback text when LLM content is null", async () => {
  const model = makeModel([{}]);
  const result = await executeTurn("Hi", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages: [],
    tools: {},
    signal: new AbortController().signal,
  });
  assertStrictEquals(result, "Sorry, I couldn't generate a response.");
});
