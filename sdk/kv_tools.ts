import { z } from "zod";
import { createKv } from "./kv.ts";
import type { ToolDef } from "./types.ts";

export type KvToolsOptions = {
  names?: {
    save?: string;
    recall?: string;
    list?: string;
    forget?: string;
  };
  descriptions?: {
    save?: string;
    recall?: string;
    list?: string;
    forget?: string;
  };
};

const DEFAULTS = {
  names: {
    save: "save_memory",
    recall: "recall_memory",
    list: "list_memories",
    forget: "forget_memory",
  },
  descriptions: {
    save:
      "Save a piece of information to persistent memory. Use a descriptive key like 'user:name' or 'project:status'.",
    recall: "Retrieve a previously saved memory by its key.",
    list:
      "List all saved memory keys, optionally filtered by a pattern (e.g. 'user:*').",
    forget: "Delete a previously saved memory by its key.",
  },
};

export function kvTools(
  options?: KvToolsOptions,
): Record<string, ToolDef> {
  const names = { ...DEFAULTS.names, ...options?.names };
  const desc = { ...DEFAULTS.descriptions, ...options?.descriptions };

  return {
    [names.save]: {
      description: desc.save,
      parameters: z.object({
        key: z.string().describe(
          "A descriptive key for this memory (e.g. 'user:name', 'preference:color')",
        ),
        value: z.string().describe("The information to remember"),
      }),
      execute: async ({ key, value }, ctx) => {
        const kv = createKv(ctx);
        await kv.set(key as string, value as string);
        return { saved: key };
      },
    },
    [names.recall]: {
      description: desc.recall,
      parameters: z.object({
        key: z.string().describe("The key to look up"),
      }),
      execute: async ({ key }, ctx) => {
        const kv = createKv(ctx);
        const value = await kv.get(key as string);
        if (value === null) return { found: false, key };
        return { found: true, key, value };
      },
    },
    [names.list]: {
      description: desc.list,
      parameters: z.object({
        pattern: z.string().describe(
          "Glob pattern to filter keys (e.g. 'user:*'). Use '*' for all.",
        ).optional(),
      }),
      execute: async ({ pattern }, ctx) => {
        const kv = createKv(ctx);
        const keys = await kv.keys((pattern as string) ?? "*");
        return { count: keys.length, keys };
      },
    },
    [names.forget]: {
      description: desc.forget,
      parameters: z.object({
        key: z.string().describe("The key to delete"),
      }),
      execute: async ({ key }, ctx) => {
        const kv = createKv(ctx);
        await kv.del(key as string);
        return { deleted: key };
      },
    },
  };
}
