import { expect } from "@std/expect";
import { executeTurn, type TurnCallLLMOptions } from "./turn_handler.ts";
import { createMockLLMResponse, responses } from "./_test_utils.ts";
import type { ChatMessage, LLMResponse, ToolSchema } from "./types.ts";
import { getLogger } from "./logger.ts";

const logger = getLogger("test-turn");

function ctx(overrides?: {
  messages?: ChatMessage[];
  toolSchemas?: ToolSchema[];
  callLLM?: (opts: TurnCallLLMOptions) => Promise<LLMResponse>;
  executeTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;
}) {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    messages: overrides?.messages ??
      [{ role: "system" as const, content: "You are helpful." }],
    toolSchemas: overrides?.toolSchemas ?? [] as ToolSchema[],
    callLLM: overrides?.callLLM ??
      (() => Promise.resolve(createMockLLMResponse("Hello from LLM"))),
    executeTool: overrides?.executeTool ??
      ((name: string, args: Record<string, unknown>) => {
        toolCalls.push({ name, args });
        return Promise.resolve('"tool result"');
      }),
    toolCalls,
  };
}

const signal = () => new AbortController().signal;

Deno.test("executeTurn", async (t) => {
  await t.step("pushes user message and returns LLM text", async () => {
    const c = ctx();
    const result = await executeTurn("Hello", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });

    expect(result).toBe("Hello from LLM");
    expect(c.messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(c.messages[2]).toEqual({
      role: "assistant",
      content: "Hello from LLM",
    });
  });

  await t.step("passes signal to callLLM", async () => {
    const abort = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const c = ctx({
      callLLM: (opts: TurnCallLLMOptions) => {
        receivedSignal = opts.signal;
        return Promise.resolve(createMockLLMResponse("ok"));
      },
    });

    await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: abort.signal,
      logger,
    });
    expect(receivedSignal).toBe(abort.signal);
  });

  await t.step("returns fallback text when LLM content is null", async () => {
    const c = ctx({ callLLM: responses(createMockLLMResponse(null)) });
    const result = await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });
    expect(result).toBe("Sorry, I couldn't generate a response.");
  });

  await t.step("returns empty text when choices array is empty", async () => {
    const c = ctx({ callLLM: () => Promise.resolve({ choices: [] }) });
    const result = await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });
    expect(result).toBe("");
  });

  await t.step("mutates the messages array in-place", async () => {
    const messages: ChatMessage[] = [{
      role: "system",
      content: "System prompt",
    }];
    const c = ctx({ messages });
    await executeTurn("Hi", {
      messages: c.messages,
      toolSchemas: c.toolSchemas,
      callLLM: c.callLLM,
      executeTool: c.executeTool,
      signal: signal(),
      logger,
    });

    expect(messages.length).toBe(3);
    expect(messages[1].role).toBe("user");
    expect(messages[2].role).toBe("assistant");
  });

  await t.step("tool calls", async (t) => {
    await t.step("executes tool and re-calls LLM with results", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [{
            id: "c1",
            name: "get_weather",
            arguments: '{"city":"NYC"}',
          }]),
          createMockLLMResponse("Sunny in NYC."),
        ),
      });

      const result = await executeTurn("Weather?", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Sunny in NYC.");
      expect(c.toolCalls).toEqual([{
        name: "get_weather",
        args: { city: "NYC" },
      }]);
      expect(c.messages.length).toBe(5); // system, user, assistant(tool_calls), tool, assistant
      expect(c.messages[3].role).toBe("tool");
      expect(c.messages[3].content).toBe('"tool result"');
    });

    await t.step("handles invalid JSON tool arguments gracefully", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [{
            id: "c1",
            name: "bad_tool",
            arguments: "not json",
          }]),
          createMockLLMResponse("Recovered."),
        ),
      });

      const result = await executeTurn("Test", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Recovered.");
      expect(
        c.messages.find((m) =>
          m.role === "tool" && m.content?.includes("Invalid JSON")
        ),
      ).toBeDefined();
    });

    await t.step("handles rejected tool execution", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [{
            id: "c1",
            name: "failing",
            arguments: "{}",
          }]),
          createMockLLMResponse("Handled."),
        ),
        executeTool: () => Promise.reject(new Error("tool boom")),
      });

      const result = await executeTurn("Go", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Handled.");
      expect(
        c.messages.find((m) =>
          m.role === "tool" && m.content?.includes("Error:")
        ),
      ).toBeDefined();
    });

    await t.step("executes multiple tool calls in parallel", async () => {
      const c = ctx({
        callLLM: responses(
          createMockLLMResponse(null, [
            { id: "c1", name: "tool_a", arguments: '{"a":1}' },
            { id: "c2", name: "tool_b", arguments: '{"b":2}' },
          ]),
          createMockLLMResponse("Both done."),
        ),
      });

      const result = await executeTurn("Go", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Both done.");
      expect(c.toolCalls.length).toBe(2);
      const toolMsgs = c.messages.filter((m) => m.role === "tool");
      expect(toolMsgs.length).toBe(2);
      expect(toolMsgs[0].tool_call_id).toBe("c1");
      expect(toolMsgs[1].tool_call_id).toBe("c2");
    });

    await t.step("forces final_answer after MAX_TOOL_ITERATIONS", async () => {
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
        { name: "loop_tool", description: "loops", parameters: {} },
        { name: "final_answer", description: "deliver answer", parameters: {} },
      ];

      let callCount = 0;
      const c = ctx({
        toolSchemas: schemas,
        callLLM: (opts: TurnCallLLMOptions) => {
          callCount++;
          if (
            opts.tools.length === 1 && opts.tools[0].name === "final_answer"
          ) {
            return Promise.resolve(forcedResp);
          }
          return Promise.resolve(toolResp);
        },
      });

      const result = await executeTurn("Go", {
        messages: c.messages,
        toolSchemas: c.toolSchemas,
        callLLM: c.callLLM,
        executeTool: c.executeTool,
        signal: signal(),
        logger,
      });

      expect(result).toBe("Here are the results.");
      expect(c.toolCalls.length).toBe(5);
      expect(callCount).toBe(6); // 1 initial + 4 re-calls + 1 forced
    });

    await t.step(
      "skips truncated tool calls on max_tokens and retries",
      async () => {
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
          callLLM: responses(
            truncatedResp,
            createMockLLMResponse(null, [{
              id: "c2",
              name: "final_answer",
              arguments: '{"answer":"Here you go."}',
            }]),
          ),
        });

        const result = await executeTurn("Run code", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: signal(),
          logger,
        });

        expect(result).toBe("Here you go.");
        expect(c.toolCalls.length).toBe(0);
      },
    );
  });

  await t.step("final_answer and user_input", async (t) => {
    for (
      const [toolName, field, input, expected] of [
        ["final_answer", "answer", "Why blue?", "The sky is blue."],
        ["user_input", "question", "Help me", "What color do you prefer?"],
      ] as const
    ) {
      await t.step(`${toolName} short-circuits the loop`, async () => {
        let callCount = 0;
        const c = ctx({
          callLLM: () => {
            callCount++;
            return Promise.resolve(
              createMockLLMResponse(null, [
                {
                  id: "c1",
                  name: toolName,
                  arguments: JSON.stringify({ [field]: expected }),
                },
              ]),
            );
          },
        });

        const result = await executeTurn(input, {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: signal(),
          logger,
        });

        expect(result).toBe(expected);
        expect(c.toolCalls.length).toBe(0);
        expect(callCount).toBe(1);
      });

      await t.step(`${toolName} wins over other tool calls`, async () => {
        const c = ctx({
          callLLM: responses(
            createMockLLMResponse(null, [
              { id: "c1", name: "web_search", arguments: '{"query":"test"}' },
              {
                id: "c2",
                name: toolName,
                arguments: JSON.stringify({ [field]: expected }),
              },
            ]),
          ),
        });

        const result = await executeTurn("Search", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: signal(),
          logger,
        });

        expect(result).toBe(expected);
        expect(c.toolCalls.length).toBe(0);
      });

      await t.step(
        `${toolName} returns empty string for malformed arguments`,
        async () => {
          const c = ctx({
            callLLM: responses(
              createMockLLMResponse(null, [{
                id: "c1",
                name: toolName,
                arguments: "not json",
              }]),
            ),
          });

          const result = await executeTurn("Hi", {
            messages: c.messages,
            toolSchemas: c.toolSchemas,
            callLLM: c.callLLM,
            executeTool: c.executeTool,
            signal: signal(),
            logger,
          });
          expect(result).toBe("");
        },
      );
    }

    await t.step(
      "final_answer works after other tools execute first",
      async () => {
        const c = ctx({
          callLLM: responses(
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
          ),
        });

        const result = await executeTurn("Weather?", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: signal(),
          logger,
        });
        expect(result).toBe("It is sunny.");
      },
    );

    await t.step(
      "user_input adds question to messages as assistant content",
      async () => {
        const c = ctx({
          callLLM: responses(
            createMockLLMResponse(null, [{
              id: "c1",
              name: "user_input",
              arguments: '{"question":"How many?"}',
            }]),
          ),
        });

        await executeTurn("Count things", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: signal(),
          logger,
        });

        const lastMsg = c.messages[c.messages.length - 1];
        expect(lastMsg.role).toBe("assistant");
        expect(lastMsg.content).toBe("How many?");
      },
    );
  });

  await t.step("abort signal", async (t) => {
    await t.step(
      "stops tool loop when signal is aborted mid-iteration",
      async () => {
        const abort = new AbortController();
        const c = ctx({
          callLLM: responses(
            createMockLLMResponse(null, [{
              id: "c1",
              name: "slow",
              arguments: "{}",
            }]),
          ),
          executeTool: () => {
            abort.abort();
            return Promise.resolve("done");
          },
        });

        const result = await executeTurn("Go", {
          messages: c.messages,
          toolSchemas: c.toolSchemas,
          callLLM: c.callLLM,
          executeTool: c.executeTool,
          signal: abort.signal,
          logger,
        });
        expect(result).toBe("");
      },
    );
  });
});
