import { expect } from "@std/expect";
import { z } from "zod";
import type { ToolDef } from "./agent_types.ts";
import { startWorker } from "./worker_entry.ts";
import { createWorkerRpc } from "./worker_pool.ts";

function createHarness(
  agent: {
    name: string;
    instructions: string;
    greeting: string;
    voice: string;
    prompt?: string;
    builtinTools?: readonly string[];
    tools: Record<string, ToolDef>;
  },
  secrets: Record<string, string> = {},
) {
  const channel = new MessageChannel();
  startWorker(agent, secrets, undefined, channel.port1);
  const workerApi = createWorkerRpc(channel.port2);

  return {
    workerApi,
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

const BASE_AGENT = {
  name: "TestBot",
  instructions: "Test instructions",
  greeting: "Hi!",
  voice: "jess",
  tools: {},
};

Deno.test("getConfig returns agent config and tool schemas", async () => {
  const h = createHarness({
    ...BASE_AGENT,
    tools: {
      greet: {
        description: "Greet someone",
        parameters: z.object({ name: z.string() }),
        execute: ({ name }) => `Hi ${name}`,
      },
    },
  });
  try {
    const { config, toolSchemas } = await h.workerApi.getConfig();
    expect(config.name).toBe("TestBot");
    expect(config.instructions).toBe("Test instructions");
    expect(config.greeting).toBe("Hi!");
    expect(config.voice).toBe("jess");
    expect(toolSchemas.length).toBe(1);
    expect(toolSchemas[0].name).toBe("greet");
  } finally {
    h.close();
  }
});

Deno.test("executeTool runs handler through worker RPC", async () => {
  const h = createHarness({
    ...BASE_AGENT,
    tools: {
      greet: {
        description: "Greet",
        parameters: z.object({ name: z.string() }),
        execute: ({ name }) => `Hello, ${name}!`,
      },
    },
  });
  try {
    expect(
      await h.workerApi.executeTool("greet", { name: "World" }),
    ).toBe("Hello, World!");
  } finally {
    h.close();
  }
});

Deno.test("executeTool returns error string for unknown tool", async () => {
  const h = createHarness(BASE_AGENT);
  try {
    expect(
      await h.workerApi.executeTool("nope", {}),
    ).toContain("Unknown tool");
  } finally {
    h.close();
  }
});
