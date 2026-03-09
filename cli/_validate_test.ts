import { expect } from "@std/expect";
import { z } from "zod";
import { sampleArgs, sampleFromJsonSchema } from "./_validate.ts";

Deno.test("sampleFromJsonSchema", async (t) => {
  await t.step("returns empty string for string type", () => {
    expect(sampleFromJsonSchema({ type: "string" })).toBe("");
  });

  await t.step("returns 0 for number type", () => {
    expect(sampleFromJsonSchema({ type: "number" })).toBe(0);
  });

  await t.step("returns 0 for integer type", () => {
    expect(sampleFromJsonSchema({ type: "integer" })).toBe(0);
  });

  await t.step("returns false for boolean type", () => {
    expect(sampleFromJsonSchema({ type: "boolean" })).toBe(false);
  });

  await t.step("returns [] for array type", () => {
    expect(sampleFromJsonSchema({ type: "array" })).toEqual([]);
  });

  await t.step("returns {} for object without properties", () => {
    expect(sampleFromJsonSchema({ type: "object" })).toEqual({});
  });

  await t.step("returns populated object for object with properties", () => {
    const result = sampleFromJsonSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
    });
    expect(result).toEqual({ name: "", count: 0 });
  });

  await t.step("returns first enum value", () => {
    expect(sampleFromJsonSchema({ enum: ["a", "b", "c"] })).toBe("a");
  });

  await t.step("returns const value", () => {
    expect(sampleFromJsonSchema({ const: 42 })).toBe(42);
  });

  await t.step("returns null for unknown type", () => {
    expect(sampleFromJsonSchema({})).toBeNull();
  });
});

Deno.test("sampleArgs", async (t) => {
  await t.step("generates sample args from Zod schema", () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
    });
    const args = sampleArgs(schema);
    expect(args).toHaveProperty("name");
    expect(args).toHaveProperty("count");
    expect(typeof args.name).toBe("string");
    expect(typeof args.count).toBe("number");
  });

  await t.step("returns empty object for empty schema", () => {
    const schema = z.object({});
    const args = sampleArgs(schema);
    expect(args).toEqual({});
  });
});
