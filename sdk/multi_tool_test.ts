import { expect } from "@std/expect";
import { z } from "zod";
import { multiTool } from "./multi_tool.ts";
import type { ToolContext } from "./types.ts";

function makeCtx(): ToolContext {
  return {
    sessionId: "test",
    env: {},
    state: {},
  };
}

Deno.test("multiTool", async (t) => {
  await t.step("creates tool with description", () => {
    const tool = multiTool({
      description: "Game actions",
      actions: {
        look: { execute: () => "around" },
      },
    });
    expect(tool.description).toBe("Game actions");
  });

  await t.step("generates action enum parameter", () => {
    const tool = multiTool({
      description: "test",
      actions: {
        get: { execute: () => "got" },
        set: { execute: () => "set" },
      },
    });
    const result = tool.parameters!.safeParse({ action: "get" });
    expect(result.success).toBe(true);
  });

  await t.step("rejects unknown action in schema", () => {
    const tool = multiTool({
      description: "test",
      actions: {
        get: { execute: () => "got" },
      },
    });
    const result = tool.parameters!.safeParse({ action: "delete" });
    expect(result.success).toBe(false);
  });

  await t.step("dispatches to correct action", async () => {
    const tool = multiTool({
      description: "test",
      actions: {
        add: { execute: () => "added" },
        remove: { execute: () => "removed" },
      },
    });
    expect(await tool.execute({ action: "add" }, makeCtx())).toBe("added");
    expect(await tool.execute({ action: "remove" }, makeCtx())).toBe("removed");
  });

  await t.step("returns error for unknown action", async () => {
    const tool = multiTool({
      description: "test",
      actions: {
        get: { execute: () => "got" },
      },
    });
    const result = await tool.execute({ action: "bad" }, makeCtx());
    expect(result).toEqual({ error: "Unknown action: bad" });
  });

  await t.step("merges action schemas as optional fields", () => {
    const tool = multiTool({
      description: "test",
      actions: {
        move: {
          schema: z.object({ room: z.string() }),
          execute: () => "moved",
        },
        take: {
          schema: z.object({ item: z.string() }),
          execute: () => "taken",
        },
      },
    });
    // action + room + item should all be in the schema
    const result = tool.parameters!.safeParse({ action: "move" });
    expect(result.success).toBe(true);
  });

  await t.step("validates action-specific schema", async () => {
    const tool = multiTool({
      description: "test",
      actions: {
        move: {
          schema: z.object({ room: z.string() }),
          execute: (args) => `moved to ${args.room}`,
        },
      },
    });
    const result = await tool.execute(
      { action: "move", room: "kitchen" },
      makeCtx(),
    );
    expect(result).toBe("moved to kitchen");
  });

  await t.step(
    "returns error when action schema validation fails",
    async () => {
      const tool = multiTool({
        description: "test",
        actions: {
          move: {
            schema: z.object({ room: z.string() }),
            execute: (args) => `moved to ${args.room}`,
          },
        },
      });
      const result = await tool.execute(
        { action: "move", room: 42 },
        makeCtx(),
      );
      expect(result).toHaveProperty("error");
    },
  );

  await t.step("passes ctx to action execute", async () => {
    let capturedCtx: ToolContext | undefined;
    const tool = multiTool({
      description: "test",
      actions: {
        check: {
          execute: (_args, ctx) => {
            capturedCtx = ctx;
            return "ok";
          },
        },
      },
    });
    const ctx = makeCtx();
    ctx.sessionId = "sess-42";
    await tool.execute({ action: "check" }, ctx);
    expect(capturedCtx?.sessionId).toBe("sess-42");
  });
});
