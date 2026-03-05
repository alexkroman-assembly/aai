import { DEFAULT_INSTRUCTIONS } from "./agent_types.ts";
import type { AgentConfig, ToolSchema } from "./types.ts";

const VOICE_RULES =
  "\n\nCRITICAL OUTPUT RULES — you MUST follow these for EVERY response:\n" +
  "Your response will be spoken aloud by a TTS system and displayed as plain text.\n" +
  "- NEVER use markdown: no **, no *, no _, no #, no `, no [](), no ---\n" +
  "- NEVER use bullet points (-, *, •) or numbered lists (1., 2.)\n" +
  "- NEVER use code blocks or inline code\n" +
  "- NEVER mention tools, search, APIs, or technical failures to the user. " +
  "If a tool returns no results, just answer naturally without explaining why.\n" +
  "- Write exactly as you would say it out loud to a friend\n" +
  '- Use short conversational sentences. To list things, say "First," "Next," "Finally,"\n' +
  "- Keep responses concise — a few sentences max";

export function buildSystemPrompt(
  config: AgentConfig,
  toolSchemas: ToolSchema[],
  opts?: { voice?: boolean },
): string {
  const agentInstructions = config.instructions
    ? `\n\nAgent-Specific Instructions:\n${config.instructions}`
    : "";
  const toolReminder = toolSchemas.length > 0
    ? "\n\nAnswer the user's request using the tool calling API provided to you. " +
      "NEVER write tool calls as text, XML, or code in your response — always use the structured tool calling mechanism. " +
      "Before calling a tool, do some analysis. " +
      "First, think about which of the provided tools is the relevant tool to answer the user's request. " +
      "Second, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. " +
      "When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. " +
      "If all of the required parameters are present or can be reasonably inferred, proceed with the tool call. " +
      "BUT, if one of the values for a required parameter is missing, DO NOT invoke the function (not even with fillers for the missing params) and instead, ask the user to provide the missing parameters. " +
      "DO NOT ask for more information on optional parameters if it is not provided. " +
      "Do not answer from memory alone when a tool can provide accurate, up-to-date information." +
      "\n\nIMPORTANT: You MUST call the final_answer tool to deliver every response. " +
      "Put your complete spoken response in the answer parameter. " +
      "It is the only way to complete the task — otherwise you will be stuck in a loop."
    : "";

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return DEFAULT_INSTRUCTIONS + `\n\nToday's date is ${today}.` +
    agentInstructions + toolReminder +
    (opts?.voice ? VOICE_RULES : "");
}
