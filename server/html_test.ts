import { expect } from "@std/expect";
import { htmlToMarkdown, renderAgentPage } from "./html.ts";

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
  ["converts list items", "<ul><li>one</li><li>two</li></ul>", "* one\n* two"],
  ["decodes HTML entities", "&amp; &lt; &gt; &quot;", '& < > "'],
  ["decodes numeric entities", "&#65;", "A"],
  ["decodes hex entities", "&#x41;", "A"],
  ["strips remaining tags", "<div><span>text</span></div>", "text"],
  ["collapses multiple blank lines", "a\n\n\n\nb", "a\n\nb"],
  [
    "strips head section",
    "<head><title>T</title></head><body>content</body>",
    "content",
  ],
];

for (const [name, input, expected] of HTML_TO_MD_CASES) {
  Deno.test(`htmlToMarkdown: ${name}`, () => {
    expect(htmlToMarkdown(input)).toContain(expected);
  });
}

Deno.test("renderAgentPage escapes HTML in agent name", () => {
  const html = renderAgentPage('<script>alert("xss")</script>');
  expect(html).not.toContain("<script>alert");
});

Deno.test("renderAgentPage includes basePath in script src", () => {
  const html = renderAgentPage("Test", "/ns/agent");
  expect(html).toContain('src="/ns/agent/client.js"');
});
