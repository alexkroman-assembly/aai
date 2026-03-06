import { z } from "zod";
import { expect } from "@std/expect";
import { defineAgent } from "../sdk/define_agent.ts";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "../sdk/types.ts";

Deno.test("defineAgent - fills defaults", () => {
  const agent = defineAgent({ name: "Minimal" });
  expect(agent.name).toBe("Minimal");
  expect(agent.voice).toBe("luna");
  expect(agent.instructions).toBe(DEFAULT_INSTRUCTIONS);
  expect(agent.greeting).toBe(DEFAULT_GREETING);
  expect(Object.keys(agent.tools).length).toBe(0);
});

Deno.test("defineAgent - preserves explicit config", () => {
  const agent = defineAgent({
    name: "TestAgent",
    instructions: "Custom instructions.",
    greeting: "Hi!",
    voice: "dan",
  });
  expect(agent.name).toBe("TestAgent");
  expect(agent.instructions).toBe("Custom instructions.");
  expect(agent.greeting).toBe("Hi!");
  expect(agent.voice).toBe("dan");
});

Deno.test("defineAgent - stores optional fields", () => {
  const agent = defineAgent({
    name: "Test",
    prompt: "Transcribe accurately",
    builtinTools: ["web_search"],
  });
  expect(agent.prompt).toBe("Transcribe accurately");
  expect(agent.builtinTools).toEqual(["web_search"]);
});

Deno.test("defineAgent - preserves tools and hooks", () => {
  const handler = () => {};
  const agent = defineAgent({
    name: "Test",
    tools: {
      greet: {
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        execute: ({ name }) => `Hello, ${name}!`,
      },
    },
    onConnect: handler,
  });
  expect("greet" in agent.tools).toBe(true);
  expect(agent.onConnect).toBe(handler);
});

Deno.test("defineAgent - tools are accessible for testing", async () => {
  const agent = defineAgent({
    name: "TestBot",
    tools: {
      echo: {
        description: "Echo input",
        parameters: z.object({ text: z.string() }),
        execute: ({ text }) => text,
      },
    },
  });
  const result = await agent.tools.echo.execute(
    { text: "hello" },
    { secrets: {}, fetch: globalThis.fetch },
  );
  expect(result).toBe("hello");
});

Deno.test("defineAgent - returns frozen object", () => {
  const agent = defineAgent({ name: "Frozen" });
  expect(Object.isFrozen(agent)).toBe(true);
});
