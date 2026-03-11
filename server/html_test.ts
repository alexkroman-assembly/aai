import { expect } from "@std/expect";
import { renderAgentPage } from "./html.ts";

Deno.test("renderAgentPage escapes HTML in agent name", () => {
  const html = renderAgentPage('<script>alert("xss")</script>');
  expect(html).not.toContain("<script>alert");
});

Deno.test("renderAgentPage includes basePath in script src", () => {
  const html = renderAgentPage("Test", "/ns/agent");
  expect(html).toContain('src="/ns/agent/client.js"');
});
