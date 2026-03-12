import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import {
  _internals,
  getBuiltinToolSchemas,
  getBuiltinVercelTools,
} from "./builtin_tools.ts";

// --- htmlToMarkdown ---

const HTML_TO_MD_CASES: [string, string, string][] = [
  [
    "strips script and style tags",
    '<p>Hello</p><script>alert("x")</script><style>.a{}</style><p>World</p>',
    "Hello",
  ],
  ["converts headings", "<h1>Title</h1>", "# Title"],
  ["converts h2", "<h2>Sub</h2>", "## Sub"],
  ["converts h3", "<h3>Deep</h3>", "### Deep"],
  ["converts bold", "<b>bold</b>", "**bold**"],
  ["converts strong", "<strong>bold</strong>", "**bold**"],
  ["converts italic", "<i>italic</i>", "_italic_"],
  ["converts em", "<em>italic</em>", "_italic_"],
  [
    "converts links",
    '<a href="https://example.com">click</a>',
    "[click](https://example.com)",
  ],
  ["converts list items", "<ul><li>one</li><li>two</li></ul>", "*   one"],
  ["decodes HTML entities", "<p>&amp; &lt; &gt; &quot;</p>", '& < > "'],
  ["strips remaining tags", "<div><span>text</span></div>", "text"],
  [
    "strips head section",
    "<head><title>T</title></head><body>content</body>",
    "content",
  ],
];

for (const [name, input, expected] of HTML_TO_MD_CASES) {
  Deno.test(`htmlToMarkdown: ${name}`, () => {
    expect(_internals.htmlToMarkdown(input)).toContain(expected);
  });
}

// --- helpers ---

function mockFetch(body: string, status = 200, statusText = "OK") {
  return (() =>
    Promise.resolve(
      new Response(body, { status, statusText }),
    )) as typeof globalThis.fetch;
}

// --- getBuiltinToolSchemas ---

Deno.test("getBuiltinToolSchemas returns requested + required tools", () => {
  const schemas = getBuiltinToolSchemas([
    "web_search",
    "visit_webpage",
    "run_code",
    "fetch_json",
  ]);
  expect(schemas).toHaveLength(6);
  const names = schemas.map((s) => s.name);
  expect(names).toContain("final_answer");
  expect(names).toContain("user_input");
  expect(names).toContain("web_search");
});

Deno.test("getBuiltinToolSchemas always includes required tools", () => {
  const schemas = getBuiltinToolSchemas([]);
  expect(schemas).toHaveLength(2);
  const names = schemas.map((s) => s.name);
  expect(names).toContain("final_answer");
  expect(names).toContain("user_input");
});

Deno.test("getBuiltinToolSchemas does not duplicate final_answer", () => {
  const schemas = getBuiltinToolSchemas(["final_answer", "web_search"]);
  const names = schemas.map((s) => s.name);
  expect(names.filter((n) => n === "final_answer")).toHaveLength(1);
});

// --- getBuiltinVercelTools ---

Deno.test("visit_webpage fetches and converts HTML", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("<html><body><p>Hello World</p></body></html>"),
  );
  const tools = getBuiltinVercelTools(["visit_webpage"]);
  const result = await tools.visit_webpage.execute!(
    { url: "https://example.com" },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  const parsed = JSON.parse(result as string);
  expect(parsed.content).toContain("Hello World");
});

Deno.test("visit_webpage handles non-OK response", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("Not Found", 404, "Not Found"),
  );
  const tools = getBuiltinVercelTools(["visit_webpage"]);
  const result = await tools.visit_webpage.execute!(
    { url: "https://example.com/missing" },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  const parsed = JSON.parse(result as string);
  expect(parsed.error).toContain("404");
});

Deno.test("run_code executes and returns stdout", async () => {
  const tools = getBuiltinVercelTools(["run_code"]);
  const result = await tools.run_code.execute!(
    { code: 'console.log("hello")' },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  expect(result).toBe("hello");
});

Deno.test("run_code returns error for syntax errors", async () => {
  const tools = getBuiltinVercelTools(["run_code"]);
  const result = await tools.run_code.execute!(
    { code: "this is not valid javascript %%%" },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  const parsed = JSON.parse(result as string);
  expect(parsed.error).toBeDefined();
});

Deno.test("run_code returns no-output message for silent code", async () => {
  const tools = getBuiltinVercelTools(["run_code"]);
  const result = await tools.run_code.execute!(
    { code: "const x = 1 + 1;" },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  expect(result).toBe("Code ran successfully (no output)");
});

Deno.test("fetch_json fetches and returns JSON", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch(JSON.stringify({ name: "test", value: 42 })),
  );
  const tools = getBuiltinVercelTools(["fetch_json"]);
  const result = await tools.fetch_json.execute!(
    { url: "https://api.example.com/data" },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  const parsed = JSON.parse(result as string);
  expect(parsed.name).toBe("test");
  expect(parsed.value).toBe(42);
});

Deno.test("fetch_json handles non-OK response", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("Server Error", 500, "ISE"),
  );
  const tools = getBuiltinVercelTools(["fetch_json"]);
  const result = await tools.fetch_json.execute!(
    { url: "https://api.example.com/fail" },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  const parsed = JSON.parse(result as string);
  expect(parsed.error).toContain("500");
});

Deno.test("fetch_json handles non-JSON response", async () => {
  using _ = stub(
    _internals,
    "fetch",
    mockFetch("this is not json"),
  );
  const tools = getBuiltinVercelTools(["fetch_json"]);
  const result = await tools.fetch_json.execute!(
    { url: "https://api.example.com/text" },
    {
      toolCallId: "test",
      messages: [],
      abortSignal: AbortSignal.timeout(5000),
    },
  );
  const parsed = JSON.parse(result as string);
  expect(parsed.error).toContain("not valid JSON");
});
