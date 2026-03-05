import {
  type ChatMessage,
  type LLMResponse,
  LLMResponseSchema,
  type ToolSchema,
} from "./types.ts";
import { getLogger } from "./logger.ts";

const log = getLogger("llm");

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string" && !msg.content.trim()) {
      return { ...msg, content: "..." };
    }
    return msg;
  });
}

export interface CallLLMOptions {
  messages: ChatMessage[];
  tools: ToolSchema[];
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  gatewayBase?: string;
  fetch?: typeof globalThis.fetch;
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  maxTokens?: number;
}

export async function callLLM(opts: CallLLMOptions): Promise<LLMResponse> {
  const base = opts.gatewayBase ?? "https://llm-gateway.assemblyai.com/v1";
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: sanitizeMessages(opts.messages),
    max_tokens: opts.maxTokens ?? 8000,
  };

  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = opts.toolChoice ?? "auto";
  }

  log.debug("LLM request", {
    model: opts.model,
    messageCount: opts.messages.length,
    toolCount: opts.tools.length,
    toolChoice: body.tool_choice,
    toolNames: opts.tools.map((t) => t.name),
  });

  const resp = await fetchFn(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    log.error("LLM request failed", {
      status: resp.status,
      body: text.slice(0, 500),
      model: opts.model,
      messageCount: opts.messages.length,
    });
    throw new Error(`LLM request failed: ${resp.status} ${text}`);
  }

  const json = await resp.json();
  log.debug("LLM raw response", {
    hasChoices: Array.isArray(json.choices),
    finishReason: json.choices?.[0]?.finish_reason,
    hasToolCalls: !!json.choices?.[0]?.message?.tool_calls?.length,
    contentPreview: typeof json.choices?.[0]?.message?.content === "string"
      ? json.choices[0].message.content.slice(0, 200)
      : typeof json.choices?.[0]?.message?.content,
  });
  const parsed = LLMResponseSchema.safeParse(json);
  if (!parsed.success) {
    log.error("LLM response validation failed", {
      error: parsed.error.message,
      raw: JSON.stringify(json).slice(0, 500),
    });
    throw new Error(`Invalid LLM response: ${parsed.error.message}`);
  }
  return parsed.data;
}
