import { expect } from "@std/expect";
import { fetchJSON, httpError } from "./fetch_json.ts";

function mockFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        statusText: status === 200 ? "OK" : "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof globalThis.fetch;
}

function throwingFetch(): typeof globalThis.fetch {
  return (() =>
    Promise.reject(new Error("network error"))) as typeof globalThis.fetch;
}

Deno.test("httpError", async (t) => {
  await t.step("creates error with status", () => {
    const err = httpError(404, "Not Found") as Error & { status: number };
    expect(err.message).toBe("404 Not Found");
    expect(err.name).toBe("HttpError");
    expect(err.status).toBe(404);
  });
});

Deno.test("fetchJSON", async (t) => {
  await t.step("returns parsed JSON on success", async () => {
    const data = await fetchJSON("https://example.com/api", {
      fetch: mockFetch({ hello: "world" }),
    });
    expect(data).toEqual({ hello: "world" });
  });

  await t.step("throws HttpError on non-ok response", async () => {
    await expect(
      fetchJSON("https://example.com/api", {
        fetch: mockFetch({ error: "nope" }, 404),
      }),
    ).rejects.toThrow("404");
  });

  await t.step("returns fallback on non-ok response", async () => {
    const data = await fetchJSON("https://example.com/api", {
      fetch: mockFetch({ error: "nope" }, 500),
      fallback: { default: true },
    });
    expect(data).toEqual({ default: true });
  });

  await t.step("returns fallback on network error", async () => {
    const data = await fetchJSON("https://example.com/api", {
      fetch: throwingFetch(),
      fallback: { offline: true },
    });
    expect(data).toEqual({ offline: true });
  });

  await t.step("throws on network error without fallback", async () => {
    await expect(
      fetchJSON("https://example.com/api", {
        fetch: throwingFetch(),
      }),
    ).rejects.toThrow("network error");
  });
});
