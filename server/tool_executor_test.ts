import { expect } from "@std/expect";
import { executeToolCall } from "../sdk/_tool_executor.ts";
import type { ToolDef, ToolParameters } from "../sdk/types.ts";

function makeTool(
  parameters: ToolParameters,
  fn: ToolDef["execute"],
): ToolDef {
  return { description: "test", parameters, execute: fn };
}

const EMPTY: ToolParameters = { type: "object", properties: {} };

Deno.test("executeToolCall - validates and runs handler", async () => {
  const t = makeTool(
    {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    ({ name }) => `Hi ${name}`,
  );
  expect(
    await executeToolCall("greet", { name: "Deno" }, t, {}),
  ).toBe("Hi Deno");
});

Deno.test("executeToolCall - returns validation error for bad args", async () => {
  const t = makeTool(
    {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    () => "ok",
  );
  const result = await executeToolCall("greet", { name: 123 }, t, {});
  expect(result).toContain("Error");
  expect(result).toContain("Invalid arguments");
});

Deno.test("executeToolCall - passes args through to handler", async () => {
  const t = makeTool(
    {
      type: "object",
      properties: { n: { type: "number" } },
    },
    ({ n }) => `n=${n}`,
  );
  expect(await executeToolCall("x", { n: 5 }, t, {})).toBe("n=5");
});

Deno.test("executeToolCall - serializes objects to JSON", async () => {
  const t = makeTool(EMPTY, () => ({ a: 1 }));
  expect(JSON.parse(await executeToolCall("x", {}, t, {}))).toEqual({ a: 1 });
});

Deno.test("executeToolCall - null/undefined result becomes 'null'", async () => {
  const nullTool = makeTool(EMPTY, () => null);
  const undefTool = makeTool(EMPTY, () => undefined);
  expect(await executeToolCall("x", {}, nullTool, {})).toBe("null");
  expect(await executeToolCall("x", {}, undefTool, {})).toBe("null");
});

Deno.test("executeToolCall - catches handler errors", async () => {
  const t = makeTool(EMPTY, () => {
    throw new Error("boom");
  });
  expect(await executeToolCall("x", {}, t, {})).toContain("boom");
});

Deno.test("executeToolCall - passes secrets and fetch in context", async () => {
  let captured: Record<string, unknown> = {};
  const t = makeTool(EMPTY, (_args, ctx) => {
    captured = { secrets: ctx.secrets, hasFetch: !!ctx.fetch };
    return "ok";
  });
  await executeToolCall("x", {}, t, { KEY: "val" });
  expect(captured.secrets).toEqual({ KEY: "val" });
  expect(captured.hasFetch).toBe(true);
});
