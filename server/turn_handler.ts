import { FINAL_ANSWER_TOOL, USER_INPUT_TOOL } from "./builtin_tools.ts";
import { getLogger, type Logger } from "./logger.ts";
import type { ChatMessage, LLMResponse, ToolSchema } from "./types.ts";

const MAX_TOOL_ITERATIONS = 5;

export type ToolChoiceParam =
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } }
  | undefined;

export interface TurnCallLLMOptions {
  messages: ChatMessage[];
  tools: ToolSchema[];
  toolChoice?: ToolChoiceParam;
  signal?: AbortSignal;
}

export interface ExecuteTurnOptions {
  messages: ChatMessage[];
  toolSchemas: ToolSchema[];
  callLLM: (opts: TurnCallLLMOptions) => Promise<LLMResponse>;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  signal: AbortSignal;
  logger?: Logger;
}

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
    logger = getLogger("turn"),
  } = opts;
  messages.push({ role: "user", content: text });

  const toolChoice: ToolChoiceParam = toolSchemas.length > 0
    ? "required"
    : undefined;
  const finalAnswerSchema = toolSchemas.find(
    (t) => t.name === FINAL_ANSWER_TOOL,
  );

  let callNum = 0;
  callNum++;
  logger.debug("LLM call", {
    callNum,
    messageCount: messages.length,
    toolChoice: toolChoice ?? "auto",
    tools: toolSchemas.length,
  });
  let response = await callLLM({
    messages,
    tools: toolSchemas,
    toolChoice,
    signal,
  });
  logger.debug("LLM response", {
    callNum,
    finishReason: response.choices[0]?.finish_reason,
  });

  let iterations = 0;
  while (iterations <= MAX_TOOL_ITERATIONS) {
    const choice = response.choices[0];
    if (!choice) break;
    const msg = choice.message;

    // final_answer — return immediately
    const answerTc = msg.tool_calls?.find((c) =>
      c.function.name === FINAL_ANSWER_TOOL
    );
    if (answerTc) {
      let answer: string;
      try {
        answer =
          (JSON.parse(answerTc.function.arguments) as Record<string, unknown>)[
            "answer"
          ] as string ?? "";
      } catch {
        answer = "";
      }
      messages.push({ role: "assistant", content: answer });
      logger.info("turn complete (final_answer)", {
        responseLength: answer.length,
      });
      return answer;
    }

    // user_input — speak the question, end the turn
    const questionTc = msg.tool_calls?.find((c) =>
      c.function.name === USER_INPUT_TOOL
    );
    if (questionTc) {
      let question: string;
      try {
        question = (JSON.parse(questionTc.function.arguments) as Record<
          string,
          unknown
        >)["question"] as string ?? "";
      } catch {
        question = "";
      }
      messages.push({ role: "assistant", content: question });
      logger.info("turn complete (user_input)", {
        questionLength: question.length,
      });
      return question;
    }

    // Out of iterations — return whatever text we have
    if (iterations === MAX_TOOL_ITERATIONS) {
      const fallback = msg.content ?? "Sorry, I couldn't generate a response.";
      messages.push({ role: "assistant", content: fallback });
      return fallback;
    }

    // Truncated tool calls — LLM ran out of tokens mid-generation, retry
    if (choice.finish_reason === "max_tokens" && msg.tool_calls?.length) {
      logger.warn("tool call truncated by max_tokens, retrying", {
        tools: msg.tool_calls.map((tc) => tc.function.name),
        iteration: iterations + 1,
      });
      if (msg.content) {
        messages.push({ role: "assistant", content: msg.content });
      }
    } else if (msg.tool_calls?.length) {
      // Execute tool calls — sanitize tool_calls so the gateway can
      // round-trip them (arguments must always be valid JSON).
      messages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || "{}",
          },
        })),
      });
      logger.info("executing tools", {
        tools: msg.tool_calls.map((tc) => tc.function.name),
        iteration: iterations + 1,
      });

      const results = await Promise.allSettled(
        msg.tool_calls.map(async (tc) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch (err: unknown) {
            logger.error("Failed to parse tool arguments", {
              err,
              tool: tc.function.name,
            });
            return `Error: Invalid JSON arguments for tool "${tc.function.name}"`;
          }
          logger.debug("tool call", { tool: tc.function.name, args });
          const result = await executeTool(tc.function.name, args);
          logger.debug("tool result", {
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
      choice.finish_reason === "tool_use" ||
      choice.finish_reason === "tool_calls"
    ) {
      logger.warn(
        "finish_reason indicates tool use but no tool_calls present, retrying",
        { finishReason: choice.finish_reason },
      );
      if (msg.content) {
        messages.push({ role: "assistant", content: msg.content });
      }
    } else {
      // Plain text response (shouldn't happen with tool_choice=required)
      const responseText = msg.content ??
        "Sorry, I couldn't generate a response.";
      messages.push({ role: "assistant", content: responseText });
      logger.info("turn complete", { responseLength: responseText.length });
      return responseText;
    }

    if (signal.aborted) break;

    iterations++;

    // Force final_answer on last iteration
    const nextTools = iterations >= MAX_TOOL_ITERATIONS && finalAnswerSchema
      ? [finalAnswerSchema]
      : toolSchemas;
    const nextChoice: ToolChoiceParam =
      iterations >= MAX_TOOL_ITERATIONS && finalAnswerSchema
        ? { type: "function" as const, function: { name: FINAL_ANSWER_TOOL } }
        : toolChoice;

    callNum++;
    logger.debug("LLM call", {
      callNum,
      messageCount: messages.length,
      toolChoice: nextChoice ?? "auto",
      tools: nextTools.length,
    });
    response = await callLLM({
      messages,
      tools: nextTools,
      toolChoice: nextChoice,
      signal,
    });
    logger.debug("LLM response", {
      callNum,
      finishReason: response.choices[0]?.finish_reason,
    });
  }

  return "";
}
