import { FINAL_ANSWER_TOOL, USER_INPUT_TOOL } from "./builtin_tools.ts";
import type { ChatMessage, LLMResponse } from "./types.ts";
import type { ToolSchema } from "../sdk/types.ts";

const MAX_TOOL_ITERATIONS = 5;

function parseToolArg(
  tc: { function: { arguments: string } },
  field: string,
): string {
  try {
    return (JSON.parse(tc.function.arguments) as Record<string, unknown>)[
      field
    ] as string ?? "";
  } catch {
    return "";
  }
}

export type ToolChoiceParam =
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } }
  | undefined;

export type TurnCallLLMOptions = {
  messages: ChatMessage[];
  tools: ToolSchema[];
  toolChoice?: ToolChoiceParam;
  signal?: AbortSignal;
};

export type ExecuteTurnOptions = {
  messages: ChatMessage[];
  toolSchemas: ToolSchema[];
  callLLM: (opts: TurnCallLLMOptions) => Promise<LLMResponse>;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  signal: AbortSignal;
};

export async function executeTurn(
  text: string,
  opts: ExecuteTurnOptions,
): Promise<string> {
  const {
    messages,
    toolSchemas,
    callLLM,
    executeTool,
    signal,
  } = opts;
  messages.push({ role: "user", content: text });

  const toolChoice: ToolChoiceParam = toolSchemas.length > 0
    ? "required"
    : undefined;
  const finalAnswerSchema = toolSchemas.find(
    (t) => t.name === FINAL_ANSWER_TOOL,
  );

  let tools = toolSchemas;
  let choice: ToolChoiceParam = toolChoice;

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    if (signal.aborted) break;

    console.debug("LLM call", {
      callNum: iteration + 1,
      messageCount: messages.length,
      toolChoice: choice ?? "auto",
      tools: tools.length,
    });
    const response = await callLLM({
      messages,
      tools,
      toolChoice: choice,
      signal,
    });
    console.debug("LLM response", {
      callNum: iteration + 1,
      finishReason: response.choices[0]?.finish_reason,
    });

    const res = response.choices[0];
    if (!res) break;
    const msg = res.message;

    const answerTc = msg.tool_calls?.find((c) =>
      c.function.name === FINAL_ANSWER_TOOL
    );
    if (answerTc) {
      const answer = parseToolArg(answerTc, "answer");
      messages.push({ role: "assistant", content: answer });
      console.info("turn complete (final_answer)", {
        responseLength: answer.length,
      });
      return answer;
    }

    const questionTc = msg.tool_calls?.find((c) =>
      c.function.name === USER_INPUT_TOOL
    );
    if (questionTc) {
      const question = parseToolArg(questionTc, "question");
      messages.push({ role: "assistant", content: question });
      console.info("turn complete (user_input)", {
        questionLength: question.length,
      });
      return question;
    }

    if (iteration === MAX_TOOL_ITERATIONS) {
      const fallback = msg.content ?? "Sorry, I couldn't generate a response.";
      messages.push({ role: "assistant", content: fallback });
      return fallback;
    }

    if (res.finish_reason === "max_tokens" && msg.tool_calls?.length) {
      console.warn("tool call truncated by max_tokens, retrying", {
        tools: msg.tool_calls.map((tc) => tc.function.name),
        iteration: iteration + 1,
      });
      if (msg.content) {
        messages.push({ role: "assistant", content: msg.content });
      }
    } else if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls,
      });
      console.info("executing tools", {
        tools: msg.tool_calls.map((tc) => tc.function.name),
        iteration: iteration + 1,
      });

      const results = await Promise.allSettled(
        msg.tool_calls.map(async (tc) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch (err: unknown) {
            console.error("Failed to parse tool arguments", {
              err,
              tool: tc.function.name,
            });
            return `Error: Invalid JSON arguments for tool "${tc.function.name}"`;
          }
          console.debug("tool call", { tool: tc.function.name, args });
          const result = await executeTool(tc.function.name, args);
          console.debug("tool result", {
            tool: tc.function.name,
            resultLength: result.length,
          });
          return result;
        }),
      );

      for (let j = 0; j < msg.tool_calls.length; j++) {
        const r = results[j];
        messages.push({
          role: "tool",
          content: r.status === "fulfilled" ? r.value : `Error: ${r.reason}`,
          tool_call_id: msg.tool_calls[j].id,
        });
      }
    } else if (
      res.finish_reason === "tool_use" ||
      res.finish_reason === "tool_calls"
    ) {
      console.warn(
        "finish_reason indicates tool use but no tool_calls present, retrying",
        { finishReason: res.finish_reason },
      );
      if (msg.content) {
        messages.push({ role: "assistant", content: msg.content });
      }
    } else {
      const responseText = msg.content ??
        "Sorry, I couldn't generate a response.";
      messages.push({ role: "assistant", content: responseText });
      console.info("turn complete", { responseLength: responseText.length });
      return responseText;
    }

    const nextIteration = iteration + 1;
    if (nextIteration >= MAX_TOOL_ITERATIONS && finalAnswerSchema) {
      tools = [finalAnswerSchema];
      choice = {
        type: "function",
        function: { name: FINAL_ANSWER_TOOL },
      };
    }
  }

  return "";
}
