import { expect } from "@std/expect";
import { fetchJSON, HttpError } from "./fetch_json.ts";

const fakeFetch = (resp: Response): typeof globalThis.fetch => () =>
  Promise.resolve(resp);

Deno.test("fetchJSON - returns parsed JSON", async () => {
  const data = await fetchJSON(
    "https://example.com",
    { fetch: fakeFetch(Response.json({ name: "test" })) },
  );
  expect(data).toEqual({ name: "test" });
});

Deno.test("fetchJSON - throws HttpError on 404", async () => {
  const fetch = fakeFetch(
    new Response(null, { status: 404, statusText: "Not Found" }),
  );
  await expect(
    fetchJSON("https://example.com", { fetch }),
  ).rejects.toThrow(HttpError);
});

Deno.test("fetchJSON - throws on invalid JSON", async () => {
  await expect(
    fetchJSON("https://example.com", {
      fetch: fakeFetch(new Response("not json")),
    }),
  ).rejects.toThrow(SyntaxError);
});

Deno.test("fetchJSON - passes RequestInit through", async () => {
  let captured: RequestInit | undefined;
  const fetch: typeof globalThis.fetch = (_input, init?) => {
    captured = init;
    return Promise.resolve(Response.json({}));
  };
  await fetchJSON(
    "https://example.com",
    { headers: { "X-Custom": "val" }, fetch },
  );
  expect(
    (captured!.headers as Record<string, string>)["X-Custom"],
  ).toBe("val");
});
