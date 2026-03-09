import { expect } from "@std/expect";
import { handleInstall } from "./install.ts";

Deno.test("handleInstall", async (t) => {
  await t.step("returns a Response", () => {
    const resp = handleInstall(new Request("https://example.com/install"));
    expect(resp).toBeInstanceOf(Response);
  });

  await t.step("response body is a shell script", async () => {
    const resp = handleInstall(new Request("https://example.com/install"));
    const body = await resp.text();
    expect(body).toContain("#!/bin/sh");
    expect(body).toContain("set -e");
  });

  await t.step("script references the correct repo", async () => {
    const resp = handleInstall(new Request("https://example.com/install"));
    const body = await resp.text();
    expect(body).toContain("alexkroman/aai");
  });

  await t.step("script handles darwin and linux", async () => {
    const resp = handleInstall(new Request("https://example.com/install"));
    const body = await resp.text();
    expect(body).toContain("Darwin");
    expect(body).toContain("Linux");
  });
});
