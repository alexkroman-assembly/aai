import { expect } from "@std/expect";
import {
  type CoreMessage,
  jsonSchema,
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
) {
  let callIndex = 0;
  return new MockLanguageModelV1({
    // deno-lint-ignore require-await
    doGenerate: async () => {
      const resp = responses[callIndex++] ??
        { text: "Sorry, I couldn't generate a response." };
      return {
        rawCall: { rawPrompt: "", rawSettings: {} },
        finishReason: resp.toolCalls?.length ? "tool-calls" : "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
        text: resp.text,
        toolCalls: resp.toolCalls?.map((tc) => ({
          toolCallType: "function" as const,
          toolCallId: `call_${callIndex}_${tc.toolName}`,
          toolName: tc.toolName,
          args: JSON.stringify(tc.args),
        })),
      };
    },
  });
}

function makeTools(): ToolSet {
  return {
    final_answer: vercelTool({
      description: "Deliver answer",
      parameters: jsonSchema({
        type: "object",
        properties: { answer: { type: "string" } },
      }),
    }),
    user_input: vercelTool({
      description: "Ask user",
      parameters: jsonSchema({
        type: "object",
        properties: { question: { type: "string" } },
      }),
    }),
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
  expect(result).toBe("Hello from LLM");
  // User message + response messages appended
  expect(messages[0]).toEqual({ role: "user", content: "Hello" });
  expect(messages.length).toBeGreaterThanOrEqual(2);
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
  expect(result).toBe("The sky is blue.");
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
  expect(result).toBe("What color?");
});

Deno.test("returns fallback text when LLM content is null", async () => {
  const model = makeModel([{ text: undefined }]);
  const result = await executeTurn("Hi", {
    agent: "test/agent",
    model,
    system: "You are helpful.",
    messages: [],
    tools: {},
    signal: new AbortController().signal,
  });
  expect(result).toBe("Sorry, I couldn't generate a response.");
});
