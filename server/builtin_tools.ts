// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { z } from "zod";
import {
  jsonSchema,
  tool as vercelTool,
  type ToolExecutionOptions,
  type ToolSet,
} from "ai";
import { createRpcClient, isRpcMessage } from "@aai/sdk/rpc";
import type {
  BuiltinTool as BuiltinToolName,
  ToolSchema,
} from "@aai/sdk/types";
import TurndownService from "turndown";
import { createDenoWorker, LOCKED_PERMISSIONS } from "./_deno_worker.ts";
import { matchSubnets } from "@std/net/unstable-ip";

const turndown = new TurndownService({ headingStyle: "atx" });
turndown.remove(["script", "style", "head"]);

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

export const _internals = {
  fetch: globalThis.fetch,
  htmlToMarkdown,
};

const BLOCKED_CIDRS = [
  // IPv4
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
  // IPv6
  "::1/128",
  "::/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
];

/**
 * Validates that a URL resolves to a public (non-private) IP address.
 *
 * Used as an SSRF guard for the fetch proxy. Resolves the hostname via DNS
 * and checks all addresses against blocked CIDR ranges (private, loopback,
 * link-local, multicast).
 *
 * @param url - The URL to validate.
 * @throws If the URL's hostname resolves to a private or blocked IP address.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const { resolve } = await import("node:dns/promises");
  const addresses = await resolve(hostname).catch(() => [hostname]);
  for (const addr of addresses) {
    if (matchSubnets(addr, BLOCKED_CIDRS)) {
      throw new Error(`Blocked request to private address: ${hostname}`);
    }
  }
}

const BraveSearchResponseSchema = z.object({
  web: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      description: z.string(),
    })),
  }).optional(),
});

type BuiltinTool = {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (
    args: Record<string, unknown>,
    env: Record<string, string | undefined>,
  ) => string | Promise<string>;
};

function defineTool<T extends z.ZodObject<z.ZodRawShape>>(tool: {
  name: string;
  description: string;
  parameters: T;
  execute: (
    args: z.infer<T>,
    env: Record<string, string | undefined>,
  ) => string | Promise<string>;
}): BuiltinTool {
  return tool as unknown as BuiltinTool;
}

const webSearchParams = z.object({
  query: z.string().describe("The search query"),
  max_results: z.number().describe(
    "Maximum number of results to return (default 5)",
  ).optional(),
});

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const NO_RESULTS = "[]";

const webSearch = defineTool({
  name: "web_search",
  description:
    "Search the web using Brave Search. Returns a list of results with title, URL, and description.",
  parameters: webSearchParams,
  execute: async (args, env) => {
    const { query, max_results: maxResults = 5 } = args;

    log.info("web_search", { query, maxResults });

    const apiKey = env.BRAVE_API_KEY;
    if (!apiKey) {
      return JSON.stringify({
        error: "BRAVE_API_KEY is not set — web search unavailable",
      });
    }

    const url = `${BRAVE_SEARCH_URL}?${new URLSearchParams({
      q: query,
      count: String(maxResults),
    })}`;

    const resp = await _internals.fetch(url, {
      headers: { "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      log.error("Brave Search request failed", {
        status: resp.status,
        statusText: resp.statusText,
      });
      return NO_RESULTS;
    }

    const raw = await resp.json();
    const data = BraveSearchResponseSchema.safeParse(raw);
    if (!data.success) {
      log.error("Unexpected Brave Search response", {
        error: data.error.message,
      });
      return NO_RESULTS;
    }

    const results = (data.data.web?.results ?? []).slice(0, maxResults).map(
      (r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
      }),
    );

    return JSON.stringify(results);
  },
});

const MAX_PAGE_CHARS = 10_000;
const MAX_HTML_BYTES = 200_000;

const visitWebpageParams = z.object({
  url: z.string().describe(
    "The full URL to fetch (e.g., 'https://example.com/page')",
  ),
});

const visitWebpage = defineTool({
  name: "visit_webpage",
  description:
    "Fetch a webpage URL and return its content as clean Markdown. Useful for reading articles, documentation, or any web page found via search.",
  parameters: visitWebpageParams,
  execute: async (args) => {
    const { url } = args;

    log.info("visit_webpage", { url });
    await assertPublicUrl(url);

    const resp = await _internals.fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; VoiceAgent/1.0; +https://github.com/AssemblyAI/aai)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      return JSON.stringify({
        error: `Failed to fetch: ${resp.status} ${resp.statusText}`,
        url,
      });
    }

    const htmlContent = await resp.text();
    const trimmedHtml = htmlContent.length > MAX_HTML_BYTES
      ? htmlContent.slice(0, MAX_HTML_BYTES)
      : htmlContent;
    const markdown = htmlToMarkdown(trimmedHtml);

    const truncated = markdown.length > MAX_PAGE_CHARS;
    const content = truncated ? markdown.slice(0, MAX_PAGE_CHARS) : markdown;

    return JSON.stringify({
      url,
      content,
      ...(truncated ? { truncated: true, totalChars: markdown.length } : {}),
    });
  },
});

const runCodeParams = z.object({
  code: z.string().describe(
    "JavaScript code to execute. Use console.log() for output.",
  ),
});

const SANDBOX_WORKER_URL = import.meta.resolve("./_sandbox_worker.ts");

const runCode = defineTool({
  name: "run_code",
  description:
    "Execute JavaScript in a sandboxed Deno Worker with no permissions. Use console.log() for output. No network or filesystem access.",
  parameters: runCodeParams,
  execute: async (args) => {
    const { code } = args;

    log.info("run_code", { codeLength: code.length });

    const worker = createDenoWorker(
      SANDBOX_WORKER_URL,
      "sandbox",
      LOCKED_PERMISSIONS,
    );

    try {
      const rpcClient = createRpcClient((msg) => worker.postMessage(msg));
      worker.onmessage = (e: MessageEvent) => {
        if (isRpcMessage(e.data) && e.data.type === "rpc-response") {
          rpcClient.handleResponse(e.data);
        }
      };
      const result = await rpcClient.call("execute", code) as {
        output: string;
        error?: string;
      };

      if (result.error) {
        return JSON.stringify({ error: result.error });
      }
      return result.output.trim() || "Code ran successfully (no output)";
    } catch {
      return JSON.stringify({ error: "Execution timed out" });
    } finally {
      worker.terminate();
    }
  },
});

const fetchJsonParams = z.object({
  url: z.string().describe("The URL to fetch JSON from"),
  headers: z.record(z.string(), z.string()).describe(
    "Optional HTTP headers to include in the request",
  ).optional(),
});

const fetchJson = defineTool({
  name: "fetch_json",
  description:
    "Fetch a URL via HTTP GET and return the JSON response. Useful for calling REST APIs that return JSON data.",
  parameters: fetchJsonParams,
  execute: async (args) => {
    const { url, headers } = args;

    log.info("fetch_json", { url });
    await assertPublicUrl(url);

    const resp = await _internals.fetch(url, {
      ...(headers && { headers }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      return JSON.stringify({
        error: `HTTP ${resp.status} ${resp.statusText}`,
        url,
      });
    }

    try {
      const data = await resp.json();
      return JSON.stringify(data);
    } catch {
      return JSON.stringify({
        error: "Response was not valid JSON",
        url,
      });
    }
  },
});

const userInputParams = z.object({
  question: z.string().describe("The question to ask the user"),
});

const userInput = defineTool({
  name: "user_input",
  description:
    "Ask the user a follow-up question and wait for their spoken response. Use this when you need clarification, a preference, or any additional input from the user before proceeding.",
  parameters: userInputParams,
  execute: () => {
    throw new Error("Tool user_input is handled by the turn handler");
  },
});

const finalAnswerParams = z.object({
  answer: z.string().describe(
    "Your final response to the user. This will be spoken aloud.",
  ),
});

const finalAnswer = defineTool({
  name: "final_answer",
  description:
    "Provide your final answer to the user. You MUST call this tool to deliver every response — it is the only way to complete the task, otherwise you will be stuck in a loop.",
  parameters: finalAnswerParams,
  execute: (args) => {
    return args.answer;
  },
});

/** Name of the built-in tool that terminates the agentic loop with a response. */
export const FINAL_ANSWER_TOOL: BuiltinToolName = "final_answer";

/** Name of the built-in tool that asks the user a follow-up question. */
export const USER_INPUT_TOOL: BuiltinToolName = "user_input";

const REQUIRED_BUILTIN_TOOLS: readonly BuiltinToolName[] = [
  FINAL_ANSWER_TOOL,
  USER_INPUT_TOOL,
];

const BUILTIN_TOOLS: Record<BuiltinToolName, BuiltinTool> = {
  "web_search": webSearch,
  "visit_webpage": visitWebpage,
  "run_code": runCode,
  "fetch_json": fetchJson,
  "user_input": userInput,
  "final_answer": finalAnswer,
};

/**
 * Returns JSON tool schemas for the specified builtin tools.
 *
 * Always includes `final_answer` and `user_input` in addition to any
 * tools explicitly requested by the agent.
 *
 * @param names - Builtin tool names requested by the agent configuration.
 * @returns An array of {@linkcode ToolSchema} objects for use in LLM calls.
 */
export function getBuiltinToolSchemas(
  names: readonly BuiltinToolName[],
): ToolSchema[] {
  const allNames = [...new Set([...REQUIRED_BUILTIN_TOOLS, ...names])];
  return allNames.flatMap((name) => {
    const tool = BUILTIN_TOOLS[name];
    if (!tool) return [];
    return [{
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters) as ToolSchema["parameters"],
    }];
  });
}

/**
 * Build Vercel AI SDK tool objects for builtin tools.
 * `final_answer` and `user_input` have no `execute` — this makes
 * `generateText` stop the loop when the LLM calls them.
 * Other builtins have `execute` and run on the host.
 */
export function getBuiltinVercelTools(
  names: readonly BuiltinToolName[],
  env: Record<string, string | undefined> = {},
): ToolSet {
  const allNames = [...new Set([...REQUIRED_BUILTIN_TOOLS, ...names])];
  const tools: ToolSet = {};
  for (const name of allNames) {
    const bt = BUILTIN_TOOLS[name];
    if (!bt) continue;
    const params = jsonSchema(
      z.toJSONSchema(bt.parameters) as ToolSchema["parameters"],
    );
    if (name === FINAL_ANSWER_TOOL || name === USER_INPUT_TOOL) {
      // No execute → generateText stops the loop when LLM calls these
      tools[name] = vercelTool({
        description: bt.description,
        parameters: params,
      }) as unknown as ToolSet[string];
    } else {
      tools[name] = vercelTool({
        description: bt.description,
        parameters: params,
        execute: async (args: unknown, _options: ToolExecutionOptions) => {
          const result = await bt.execute(args as Record<string, unknown>, env);
          return result;
        },
      });
    }
  }
  return tools;
}
