import { expect } from "@std/expect";
import { executeBuiltinTool, getBuiltinToolSchemas } from "./builtin_tools.ts";
import { htmlToMarkdown } from "./html.ts";

Deno.test("htmlToMarkdown", async (t) => {
  await t.step("strips script tags", () => {
    const result = htmlToMarkdown('<p>Hello</p><script>alert("x")</script>');
    expect(result).toContain("Hello");
    expect(result).not.toContain("alert");
  });

  await t.step("strips style tags", () => {
    const result = htmlToMarkdown(
      "<style>body{color:red}</style><p>Content</p>",
    );
    expect(result).toContain("Content");
    expect(result).not.toContain("color:red");
  });

  await t.step("converts headings to markdown", () => {
    const result = htmlToMarkdown("<h1>Title</h1><h2>Subtitle</h2>");
    expect(result).toContain("# Title");
    expect(result).toContain("## Subtitle");
  });

  await t.step("converts paragraphs", () => {
    const result = htmlToMarkdown("<p>Para 1</p><p>Para 2</p>");
    expect(result).toContain("Para 1");
    expect(result).toContain("Para 2");
  });

  await t.step("converts links to markdown", () => {
    const result = htmlToMarkdown(
      '<a href="https://example.com">Click here</a>',
    );
    expect(result).toContain("[Click here](https://example.com)");
  });

  await t.step("converts bold and italic", () => {
    const result = htmlToMarkdown("<b>Bold</b> and <i>Italic</i>");
    expect(result).toContain("**Bold**");
    expect(result).toContain("_Italic_");
  });

  await t.step("converts unordered lists", () => {
    const result = htmlToMarkdown("<ul><li>A</li><li>B</li></ul>");
    expect(result).toContain("* A");
    expect(result).toContain("* B");
  });

  await t.step("decodes HTML entities", () => {
    const result = htmlToMarkdown("&amp; &lt; &gt; &quot;");
    expect(result).toContain("&");
    expect(result).toContain("<");
    expect(result).toContain(">");
    expect(result).toContain('"');
  });

  await t.step("collapses excessive newlines", () => {
    const result = htmlToMarkdown("<p>A</p>\n\n\n\n<p>B</p>");
    expect(result).not.toMatch(/\n{3,}/);
  });

  await t.step("trims result", () => {
    const result = htmlToMarkdown("  <p>Hello</p>  ");
    expect(result).toBe(result.trim());
  });
});

Deno.test("getBuiltinToolSchemas", async (t) => {
  await t.step("returns schemas for known tools plus required tools", () => {
    const schemas = getBuiltinToolSchemas([
      "web_search",
      "visit_webpage",
      "run_code",
      "fetch_json",
    ]);
    // 4 requested + final_answer + user_input (auto-included)
    expect(schemas).toHaveLength(6);
    const names = schemas.map((s) => s.name);
    expect(names).toContain("final_answer");
    expect(names).toContain("user_input");
    expect(names).toContain("web_search");
    expect(names).toContain("visit_webpage");
    expect(names).toContain("run_code");
    expect(names).toContain("fetch_json");
  });

  await t.step("ignores unknown tool names", () => {
    const schemas = getBuiltinToolSchemas(["unknown_tool", "web_search"]);
    // web_search + final_answer + user_input
    expect(schemas).toHaveLength(3);
    const names = schemas.map((s) => s.name);
    expect(names).toContain("web_search");
    expect(names).toContain("final_answer");
    expect(names).toContain("user_input");
  });

  await t.step("always includes required tools even with empty input", () => {
    const schemas = getBuiltinToolSchemas([]);
    expect(schemas).toHaveLength(2);
    const names = schemas.map((s) => s.name);
    expect(names).toContain("final_answer");
    expect(names).toContain("user_input");
  });

  await t.step(
    "does not duplicate final_answer when explicitly requested",
    () => {
      const schemas = getBuiltinToolSchemas(["final_answer", "web_search"]);
      const names = schemas.map((s) => s.name);
      expect(names.filter((n) => n === "final_answer")).toHaveLength(1);
    },
  );

  await t.step("returns schemas with correct shape", () => {
    const schemas = getBuiltinToolSchemas(["web_search"]);
    const webSearch = schemas.find((s) => s.name === "web_search")!;
    expect(webSearch.name).toBe("web_search");
    expect(typeof webSearch.description).toBe("string");
    expect(webSearch.parameters).toBeDefined();
  });

  await t.step("includes user_input when requested", () => {
    const schemas = getBuiltinToolSchemas(["user_input"]);
    const names = schemas.map((s) => s.name);
    expect(names).toContain("user_input");
    expect(names).toContain("final_answer");
    const ui = schemas.find((s) => s.name === "user_input")!;
    expect(typeof ui.description).toBe("string");
    expect(ui.parameters).toBeDefined();
  });
});

Deno.test("executeBuiltinTool", async (t) => {
  await t.step("returns null for unknown tool", async () => {
    const result = await executeBuiltinTool("nonexistent", {});
    expect(result).toBeNull();
  });

  await t.step("returns error for invalid args", async () => {
    const result = await executeBuiltinTool("web_search", {});
    expect(result).not.toBeNull();
    expect(result!).toContain("Error");
  });

  await t.step("passes Zod-parsed data (not raw args) to execute", async () => {
    const mockFetch = (() =>
      Promise.resolve(
        new Response("<html><body>OK</body></html>", {
          status: 200,
        }),
      )) as typeof globalThis.fetch;

    const result = await executeBuiltinTool(
      "visit_webpage",
      { url: "https://example.com" },
      {},
      mockFetch,
    );
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.url).toBe("https://example.com");
  });

  await t.step("visit_webpage", async (t) => {
    await t.step("fetches and converts HTML", async () => {
      const mockFetch = (() =>
        Promise.resolve(
          new Response(
            "<html><body><p>Hello World</p></body></html>",
            { status: 200 },
          ),
        )) as typeof globalThis.fetch;

      const result = await executeBuiltinTool(
        "visit_webpage",
        { url: "https://example.com" },
        {},
        mockFetch,
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.content).toContain("Hello World");
      expect(parsed.url).toBe("https://example.com");
    });

    await t.step("handles non-OK response", async () => {
      const mockFetch = (() =>
        Promise.resolve(
          new Response("Not Found", {
            status: 404,
            statusText: "Not Found",
          }),
        )) as typeof globalThis.fetch;

      const result = await executeBuiltinTool(
        "visit_webpage",
        { url: "https://example.com/missing" },
        {},
        mockFetch,
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.error).toContain("404");
    });
  });

  await t.step("run_code", async (t) => {
    await t.step("executes code and returns stdout", async () => {
      const result = await executeBuiltinTool("run_code", {
        code: 'console.log("hello")',
      });
      expect(result).toBe("hello");
    });

    await t.step("returns error for syntax errors", async () => {
      const result = await executeBuiltinTool("run_code", {
        code: "this is not valid javascript %%%",
      });
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.error).toBeDefined();
    });

    await t.step("returns no-output message for silent code", async () => {
      const result = await executeBuiltinTool("run_code", {
        code: "const x = 1 + 1;",
      });
      expect(result).toBe("Code ran successfully (no output)");
    });
  });

  await t.step("user_input", async (t) => {
    await t.step(
      "throws because it is handled by the turn handler",
      async () => {
        const result = await executeBuiltinTool("user_input", {
          question: "What color?",
        });
        expect(result).not.toBeNull();
        expect(result!).toContain("Error");
        expect(result!).toContain("handled by the turn handler");
      },
    );

    await t.step("returns error for missing question arg", async () => {
      const result = await executeBuiltinTool("user_input", {});
      expect(result).not.toBeNull();
      expect(result!).toContain("Error");
    });
  });

  await t.step("fetch_json", async (t) => {
    await t.step("fetches and returns JSON", async () => {
      const mockFetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ name: "test", value: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof globalThis.fetch;

      const result = await executeBuiltinTool(
        "fetch_json",
        { url: "https://api.example.com/data" },
        {},
        mockFetch,
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.name).toBe("test");
      expect(parsed.value).toBe(42);
    });

    await t.step("handles non-OK response", async () => {
      const mockFetch = (() =>
        Promise.resolve(
          new Response("Server Error", {
            status: 500,
            statusText: "Internal Server Error",
          }),
        )) as typeof globalThis.fetch;

      const result = await executeBuiltinTool(
        "fetch_json",
        { url: "https://api.example.com/fail" },
        {},
        mockFetch,
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.error).toContain("500");
    });

    await t.step("handles non-JSON response", async () => {
      const mockFetch = (() =>
        Promise.resolve(
          new Response("this is not json", {
            status: 200,
          }),
        )) as typeof globalThis.fetch;

      const result = await executeBuiltinTool(
        "fetch_json",
        { url: "https://api.example.com/text" },
        {},
        mockFetch,
      );
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.error).toContain("not valid JSON");
    });
  });
});
