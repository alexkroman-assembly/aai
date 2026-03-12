import {
  type CoreMessage,
  type CoreUserMessage,
  generateText,
  type GenerateTextResult,
  type LanguageModelV1,
  type StepResult,
  type ToolCallUnion,
  type ToolSet,
} from "ai";
import type { ToolChoice } from "@aai/sdk/schema";
import { FINAL_ANSWER_TOOL, USER_INPUT_TOOL } from "./builtin_tools.ts";
import * as metrics from "./metrics.ts";

const DEFAULT_STOP_WHEN = 5;

export type ExecuteTurnOptions = {
  agent: string;
  model: LanguageModelV1;
  system: string;
  messages: CoreMessage[];
  tools: ToolSet;
  signal: AbortSignal;
  maxSteps?: number;
  toolChoice?: ToolChoice;
  onStep?: (step: StepResult<ToolSet>) => void | Promise<void>;
  resolveBeforeStep?: (
    stepNumber: number,
  ) => Promise<{ activeTools?: string[] } | null>;
};

export async function executeTurn(
  text: string,
  opts: ExecuteTurnOptions,
): Promise<string> {
  const {
    agent,
    model,
    system,
    messages,
    tools,
    signal,
  } = opts;
  const maxSteps = opts.maxSteps ?? DEFAULT_STOP_WHEN;
  const toolChoice = opts.toolChoice ?? "auto";

  const userMessage: CoreUserMessage = { role: "user", content: text };

  const result: GenerateTextResult<ToolSet, string> = await generateText({
    model,
    system,
    messages: [...messages, userMessage],
    tools,
    toolChoice,
    maxSteps,
    abortSignal: signal,
    experimental_prepareStep: async ({ stepNumber }) => {
      // On the last step, force final_answer so we don't get stuck
      if (stepNumber === maxSteps - 1) {
        return {
          toolChoice: { type: "tool", toolName: FINAL_ANSWER_TOOL },
        };
      }
      // Let the agent's onBeforeStep filter active tools
      if (opts.resolveBeforeStep) {
        const result = await opts.resolveBeforeStep(stepNumber);
        if (result?.activeTools) {
          return {
            toolChoice,
            experimental_activeTools: result.activeTools,
          };
        }
      }
      return undefined;
    },
    onStepFinish: async (step: StepResult<ToolSet>) => {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          console.info("tool call", { tool: tc.toolName, agent });
          metrics.toolDuration.observe(0, { agent, tool: tc.toolName });
        }
      }
      if (opts.onStep) {
        await opts.onStep(step);
      }
    },
  });

  // Append the user message + all response messages to conversation history
  messages.push(userMessage);
  messages.push(...result.response.messages);

  // Check if the last step called final_answer or user_input
  // These tools have no execute, so they stop the loop
  const lastToolCalls = result.toolCalls;
  if (lastToolCalls?.length) {
    const answerCall = lastToolCalls.find(
      (tc: ToolCallUnion<ToolSet>) => tc.toolName === FINAL_ANSWER_TOOL,
    );
    if (answerCall) {
      const answer = (answerCall.args as { answer?: string }).answer ?? "";
      console.info("turn complete (final_answer)", {
        responseLength: answer.length,
      });
      return answer;
    }

    const questionCall = lastToolCalls.find(
      (tc: ToolCallUnion<ToolSet>) => tc.toolName === USER_INPUT_TOOL,
    );
    if (questionCall) {
      const question = (questionCall.args as { question?: string }).question ??
        "";
      console.info("turn complete (user_input)", {
        questionLength: question.length,
      });
      return question;
    }
  }

  // Fallback: use the text response
  const responseText = result.text ||
    "Sorry, I couldn't generate a response.";
  console.info("turn complete", { responseLength: responseText.length });
  return responseText;
}
