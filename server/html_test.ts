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

Deno.test("renderAgentPage injects __AAI_BASE__ with basePath", () => {
  const html = renderAgentPage("Test", "/ns/agent");
  expect(html).toContain('window.__AAI_BASE__="/ns/agent"');
});

Deno.test("renderAgentPage escapes basePath in __AAI_BASE__", () => {
  const html = renderAgentPage("Test", '/ns/"><script>xss');
  expect(html).not.toContain("<script>xss");
});

Deno.test("renderAgentPage injects __AAI_WS__ path", () => {
  const html = renderAgentPage("Test", "/ns/agent");
  expect(html).toContain('window.__AAI_WS__="/ns/agent/websocket"');
});
