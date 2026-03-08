import { expect } from "@std/expect";
import { z } from "zod";
import { defineAgent } from "./define_agent.ts";
import { DEFAULT_GREETING, DEFAULT_INSTRUCTIONS } from "./types.ts";

Deno.test("defineAgent", async (t) => {
  await t.step("returns frozen object", () => {
    const agent = defineAgent({ name: "Test" });
    expect(Object.isFrozen(agent)).toBe(true);
  });

  await t.step("applies defaults", () => {
    const agent = defineAgent({ name: "Test" });
    expect(agent.name).toBe("Test");
    expect(agent.voice).toBe("luna");
    expect(agent.instructions).toBe(DEFAULT_INSTRUCTIONS);
    expect(agent.greeting).toBe(DEFAULT_GREETING);
    expect(agent.transport).toEqual(["websocket"]);
    expect(agent.env).toEqual(["ASSEMBLYAI_API_KEY"]);
    expect(agent.tools).toEqual({});
  });

  await t.step("preserves custom values", () => {
    const agent = defineAgent({
      name: "Custom",
      voice: "orion",
      instructions: "Be a pirate",
      greeting: "Ahoy",
      transport: "twilio",
      env: ["MY_KEY"],
    });
    expect(agent.voice).toBe("orion");
    expect(agent.instructions).toBe("Be a pirate");
    expect(agent.greeting).toBe("Ahoy");
    expect(agent.transport).toEqual(["twilio"]);
    expect(agent.env).toEqual(["MY_KEY"]);
  });

  await t.step("normalizes transport array", () => {
    const agent = defineAgent({
      name: "Multi",
      transport: ["websocket", "twilio"],
    });
    expect(agent.transport).toEqual(["websocket", "twilio"]);
  });

  await t.step("freezes env and transport arrays", () => {
    const agent = defineAgent({ name: "Test", env: ["A", "B"] });
    expect(Object.isFrozen(agent.env)).toBe(true);
    expect(Object.isFrozen(agent.transport)).toBe(true);
  });

  await t.step("preserves tools", () => {
    const tools = {
      greet: {
        description: "Say hello",
        parameters: z.object({ name: z.string() }),
        execute: ({ name }: Record<string, unknown>) => `Hello ${name}`,
      },
    };
    const agent = defineAgent({ name: "Test", tools });
    expect(Object.keys(agent.tools)).toEqual(["greet"]);
    expect(agent.tools.greet.description).toBe("Say hello");
  });

  await t.step("preserves lifecycle hooks", () => {
    const onConnect = () => {};
    const onDisconnect = () => {};
    const onError = () => {};
    const onTurn = () => {};
    const agent = defineAgent({
      name: "Test",
      onConnect,
      onDisconnect,
      onError,
      onTurn,
    });
    expect(agent.onConnect).toBe(onConnect);
    expect(agent.onDisconnect).toBe(onDisconnect);
    expect(agent.onError).toBe(onError);
    expect(agent.onTurn).toBe(onTurn);
  });

  await t.step("preserves prompt and builtinTools", () => {
    const agent = defineAgent({
      name: "Test",
      prompt: "Speak slowly",
      builtinTools: ["web_search", "run_code"],
    });
    expect(agent.prompt).toBe("Speak slowly");
    expect(agent.builtinTools).toEqual(["web_search", "run_code"]);
  });
});
