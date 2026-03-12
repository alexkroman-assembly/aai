import { z } from "zod";
import { expect } from "@std/expect";
import { agentToolsToSchemas, type ToolDef } from "./types.ts";

Deno.test("agentToolsToSchemas - converts tool definitions to OpenAI schema", () => {
  const tools: Record<string, ToolDef> = {
    get_weather: {
      description: "Get weather",
      parameters: z.object({
        city: z.string().describe("City"),
      }),
      execute: async () => {},
    },
    set_alarm: {
      description: "Set alarm",
      parameters: z.object({
        time: z.string(),
        label: z.string().optional(),
      }),
      execute: async () => {},
    },
  };
  const schemas = agentToolsToSchemas(tools);
  expect(schemas.length).toBe(2);
  expect(schemas[0].name).toBe("get_weather");
  expect(schemas[0].description).toBe("Get weather");
  expect(schemas[1].name).toBe("set_alarm");
});
