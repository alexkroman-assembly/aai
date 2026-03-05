import { expect } from "@std/expect";
import { z } from "zod";
import { executeToolCall } from "./tool_executor.ts";
import type { ToolDef } from "./agent_types.ts";

function makeTool(
  schema: z.ZodObject<z.ZodRawShape>,
  fn: ToolDef["execute"],
): ToolDef {
  return { description: "test", parameters: schema, execute: fn };
}

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
  const t = makeTool(z.object({ name: z.string() }), () => "ok");
  const result = await executeToolCall("greet", { name: 123 }, t, {});
  expect(result).toContain("Error");
  expect(result).toContain("Invalid arguments");
});

Deno.test("executeToolCall - applies zod defaults", async () => {
  const t = makeTool(
    z.object({ n: z.number().default(5) }),
    ({ n }) => `n=${n}`,
  );
  expect(await executeToolCall("x", {}, t, {})).toBe("n=5");
});

Deno.test("executeToolCall - serializes objects to JSON", async () => {
  const t = makeTool(z.object({}), () => ({ a: 1 }));
  expect(JSON.parse(await executeToolCall("x", {}, t, {}))).toEqual({ a: 1 });
});

Deno.test("executeToolCall - null/undefined result becomes 'null'", async () => {
  const nullTool = makeTool(z.object({}), () => null);
  const undefTool = makeTool(z.object({}), () => undefined);
  expect(await executeToolCall("x", {}, nullTool, {})).toBe("null");
  expect(await executeToolCall("x", {}, undefTool, {})).toBe("null");
});

Deno.test("executeToolCall - catches handler errors", async () => {
  const t = makeTool(z.object({}), () => {
    throw new Error("boom");
  });
  expect(await executeToolCall("x", {}, t, {})).toContain("boom");
});

Deno.test("executeToolCall - passes secrets and fetch in context", async () => {
  let captured: Record<string, unknown> = {};
  const t = makeTool(z.object({}), (_args, ctx) => {
    captured = { secrets: ctx.secrets, hasFetch: !!ctx.fetch };
    return "ok";
  });
  await executeToolCall("x", {}, t, { KEY: "val" });
  expect(captured.secrets).toEqual({ KEY: "val" });
  expect(captured.hasFetch).toBe(true);
});
