import { z } from "zod";
import { getLogger } from "./logger.ts";
import { createSandboxRpc } from "./rpc.ts";
import type { ToolSchema } from "./types.ts";
import { htmlToMarkdown } from "./html.ts";

const log = getLogger("builtin-tools");

const BraveSearchResponseSchema = z.object({
  web: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      description: z.string(),
    })),
  }).optional(),
});

interface BuiltinTool {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (
    args: Record<string, unknown>,
    env: Record<string, string | undefined>,
    fetch: typeof globalThis.fetch,
  ) => string | Promise<string>;
}

const webSearchParams = z.object({
  query: z.string().describe("The search query"),
  max_results: z.number().describe(
    "Maximum number of results to return (default 5)",
  ).optional(),
});

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

const webSearch: BuiltinTool = {
  name: "web_search",
  description:
    "Search the web using Brave Search. Returns a list of results with title, URL, and description.",
  parameters: webSearchParams,
  execute: async (args, env, fetchFn) => {
    const query = args.query as string;
    const maxResults = (args.max_results as number | undefined) ?? 5;

    log.info("web_search", { query, maxResults });

    const apiKey = env.BRAVE_API_KEY;
    if (!apiKey) {
      log.error("BRAVE_API_KEY not set");
      return JSON.stringify({
        results: [],
        note:
          "No search results available. Answer the user's question to the best of your ability.",
      });
    }

    const url = `${BRAVE_SEARCH_URL}?${new URLSearchParams({
      q: query,
      count: String(maxResults),
    })}`;

    const resp = await fetchFn(url, {
      headers: { "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      log.error("Brave Search request failed", {
        status: resp.status,
        statusText: resp.statusText,
      });
      return JSON.stringify({
        results: [],
        note:
          "No search results available. Answer the user's question to the best of your ability.",
      });
    }

    const raw = await resp.json();
    const data = BraveSearchResponseSchema.safeParse(raw);
    if (!data.success) {
      log.error("Unexpected Brave Search response", {
        error: data.error.message,
      });
      return JSON.stringify({
        results: [],
        note:
          "No search results available. Answer the user's question to the best of your ability.",
      });
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
};

const MAX_PAGE_CHARS = 10_000;
const MAX_HTML_BYTES = 200_000;

const visitWebpageParams = z.object({
  url: z.string().describe(
    "The full URL to fetch (e.g., 'https://example.com/page')",
  ),
});

const visitWebpage: BuiltinTool = {
  name: "visit_webpage",
  description:
    "Fetch a webpage URL and return its content as clean Markdown. Useful for reading articles, documentation, or any web page found via search.",
  parameters: visitWebpageParams,
  execute: async (args, _env, fetchFn) => {
    const url = args.url as string;

    log.info("visit_webpage", { url });

    const resp = await fetchFn(url, {
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
};

const runCodeParams = z.object({
  code: z.string().describe(
    "JavaScript code to execute. Use console.log() for output.",
  ),
});

const TIMEOUT_MS = 5_000;

const SANDBOX_WORKER_URL = import.meta.resolve("./sandbox_worker.ts");

const runCode: BuiltinTool = {
  name: "run_code",
  description:
    "Execute JavaScript in a sandboxed Deno Worker with no permissions. Use console.log() for output. No network or filesystem access.",
  parameters: runCodeParams,
  execute: async (args, _env, _fetchFn) => {
    const code = args.code as string;

    log.info("run_code", { codeLength: code.length });

    // deno-lint-ignore no-explicit-any
    const worker = new (Worker as any)(SANDBOX_WORKER_URL, {
      type: "module",
      name: "sandbox",
      deno: {
        permissions: {
          net: false,
          read: false,
          write: false,
          env: false,
          sys: false,
          run: false,
          ffi: false,
        },
      },
    });

    try {
      const sandbox = createSandboxRpc(worker);
      const result = await sandbox.execute(code, TIMEOUT_MS);

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
};

const fetchJsonParams = z.object({
  url: z.string().describe("The URL to fetch JSON from"),
  headers: z.record(z.string(), z.string()).describe(
    "Optional HTTP headers to include in the request",
  ).optional(),
});

const fetchJson: BuiltinTool = {
  name: "fetch_json",
  description:
    "Fetch a URL via HTTP GET and return the JSON response. Useful for calling REST APIs that return JSON data.",
  parameters: fetchJsonParams,
  execute: async (args, _env, fetchFn) => {
    const url = args.url as string;
    const headers = args.headers as Record<string, string> | undefined;

    log.info("fetch_json", { url });

    const resp = await fetchFn(url, {
      headers,
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
};

const userInputParams = z.object({
  question: z.string().describe("The question to ask the user"),
});

const userInput: BuiltinTool = {
  name: "user_input",
  description:
    "Ask the user a follow-up question and wait for their spoken response. Use this when you need clarification, a preference, or any additional input from the user before proceeding.",
  parameters: userInputParams,
  // Intercepted by the turn handler before execute is called (like final_answer).
  execute: (_args, _env, _fetchFn) => {
    throw new Error("user_input is handled by the turn handler");
  },
};

const finalAnswerParams = z.object({
  answer: z.string().describe(
    "Your final response to the user. This will be spoken aloud.",
  ),
});

const finalAnswer: BuiltinTool = {
  name: "final_answer",
  description:
    "Provide your final answer to the user. You MUST call this tool to deliver every response — it is the only way to complete the task, otherwise you will be stuck in a loop.",
  parameters: finalAnswerParams,
  execute: (args, _env, _fetchFn) => {
    return args.answer as string;
  },
};

export const FINAL_ANSWER_TOOL = "final_answer";
export const USER_INPUT_TOOL = "user_input";

const REQUIRED_BUILTIN_TOOLS = [FINAL_ANSWER_TOOL, USER_INPUT_TOOL];

const BUILTIN_TOOLS: Record<string, BuiltinTool> = {
  web_search: webSearch,
  visit_webpage: visitWebpage,
  run_code: runCode,
  fetch_json: fetchJson,
  user_input: userInput,
  final_answer: finalAnswer,
};

export function getBuiltinToolSchemas(names: readonly string[]): ToolSchema[] {
  const allNames = [...new Set([...REQUIRED_BUILTIN_TOOLS, ...names])];
  return allNames.flatMap((name) => {
    const tool = BUILTIN_TOOLS[name];
    if (!tool) return [];
    return [{
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters),
    }];
  });
}

export async function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>,
  env: Record<string, string | undefined> = {},
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<string | null> {
  const tool = BUILTIN_TOOLS[name];
  if (!tool) return null;

  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) {
    // deno-lint-ignore no-explicit-any
    const issues = ((parsed as any).error?.issues ?? [])
      .map((i: { path: (string | number)[]; message: string }) =>
        `${i.path.join(".")}: ${i.message}`
      ).join(", ");
    return `Error: Invalid arguments for tool "${name}": ${issues}`;
  }

  try {
    return await tool.execute(
      parsed.data as Record<string, unknown>,
      env,
      fetchFn,
    );
  } catch (err: unknown) {
    log.error("Built-in tool execution failed", { err, tool: name });
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
