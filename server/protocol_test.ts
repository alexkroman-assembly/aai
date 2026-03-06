import { expect } from "@std/expect";
import {
  agentToolsToSchemas,
  normalizeParameters,
  type ToolDef,
} from "../sdk/types.ts";

Deno.test("agentToolsToSchemas - converts tool definitions to OpenAI schema", () => {
  const tools: Record<string, ToolDef> = {
    get_weather: {
      description: "Get weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "City" } },
        required: ["city"],
      },
      execute: async () => {},
    },
    set_alarm: {
      description: "Set alarm",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string" },
          label: { type: "string" },
        },
        required: ["time"],
      },
      execute: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  expect(schemas.length).toBe(2);
  expect(schemas[0].name).toBe("get_weather");
  expect(schemas[0].description).toBe("Get weather");
  expect(
    (schemas[0].parameters as Record<string, unknown>).type,
  ).toBe("object");
  expect(schemas[1].name).toBe("set_alarm");
});

Deno.test("agentToolsToSchemas - normalizes shorthand parameters", () => {
  const tools: Record<string, ToolDef> = {
    lookup: {
      description: "Look up a thing",
      parameters: {
        name: "The name to look up",
      },
      execute: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  expect(schemas[0].parameters.type).toBe("object");
  expect(schemas[0].parameters.properties.name).toEqual({
    type: "string",
    description: "The name to look up",
  });
  expect(schemas[0].parameters.required).toEqual(["name"]);
});

Deno.test("normalizeParameters", async (t) => {
  await t.step("passes through full ToolParameters unchanged", () => {
    const full = {
      type: "object" as const,
      properties: { x: { type: "string" } },
      required: ["x"],
    };
    expect(normalizeParameters(full)).toBe(full);
  });

  await t.step("expands bare strings to string params", () => {
    const result = normalizeParameters({ query: "Search term" });
    expect(result).toEqual({
      type: "object",
      properties: { query: { type: "string", description: "Search term" } },
      required: ["query"],
    });
  });

  await t.step("marks all params required by default", () => {
    const result = normalizeParameters({
      a: "First",
      b: { type: "number", description: "Second" },
    });
    expect(result.required).toEqual(["a", "b"]);
  });

  await t.step("respects optional: true", () => {
    const result = normalizeParameters({
      phrase: "The phrase",
      mode: { type: "string", enum: ["a", "b"], optional: true },
    });
    expect(result.required).toEqual(["phrase"]);
    expect(result.properties.mode).toEqual({
      type: "string",
      enum: ["a", "b"],
    });
  });

  await t.step("handles empty params", () => {
    const result = normalizeParameters({});
    expect(result).toEqual({ type: "object", properties: {} });
  });
});
