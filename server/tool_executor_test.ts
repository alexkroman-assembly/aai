import { z } from "zod";
import { expect } from "@std/expect";
import { executeToolCall } from "../core/_worker_entry.ts";
import type { ToolDef } from "../sdk/types.ts";

function makeTool(
  parameters: z.ZodObject<z.ZodRawShape>,
  fn: ToolDef["execute"],
): ToolDef {
  return { description: "test", parameters, execute: fn };
}

const EMPTY = z.object({});

Deno.test("executeToolCall - validates and runs handler", async () => {
  const t = makeTool(
    z.object({ name: z.string() }),
    ({ name }) => `Hi ${name}`,
  );
  expect(
    await executeToolCall("greet", { name: "Deno" }, t, {}),
  ).toBe("Hi Deno");
});

Deno.test("executeToolCall - returns validation error for bad args", async () => {
  const t = makeTool(
    z.object({ name: z.string() }),
    () => "ok",
  );
  const result = await executeToolCall("greet", { name: 123 }, t, {});
  expect(result).toContain("Error");
  expect(result).toContain("Invalid arguments");
});

Deno.test("executeToolCall - passes args through to handler", async () => {
  const t = makeTool(
    z.object({ n: z.number() }),
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

Deno.test("executeToolCall - passes env in context", async () => {
  let captured: Record<string, unknown> = {};
  const t = makeTool(EMPTY, (_args, ctx) => {
    captured = { env: ctx.env };
    return "ok";
  });
  await executeToolCall("x", {}, t, { KEY: "val" });
  expect(captured.env).toEqual({ KEY: "val" });
});
