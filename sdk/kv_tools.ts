import { z } from "zod";
import { tool, type ToolDef } from "./types.ts";

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
      "List all saved memory keys, optionally filtered by a prefix (e.g. 'user:').",
    forget: "Delete a previously saved memory by its key.",
  },
};

export function kvTools(
  options?: KvToolsOptions,
): Record<string, ToolDef> {
  const names = { ...DEFAULTS.names, ...options?.names };
  const desc = { ...DEFAULTS.descriptions, ...options?.descriptions };

  return {
    [names.save]: tool({
      description: desc.save,
      parameters: z.object({
        key: z.string().describe(
          "A descriptive key for this memory (e.g. 'user:name', 'preference:color')",
        ),
        value: z.string().describe("The information to remember"),
      }),
      execute: async ({ key, value }, ctx) => {
        await ctx.kv.set(key, value);
        return { saved: key };
      },
    }),
    [names.recall]: tool({
      description: desc.recall,
      parameters: z.object({
        key: z.string().describe("The key to look up"),
      }),
      execute: async ({ key }, ctx) => {
        const value = await ctx.kv.get(key);
        if (value === null) return { found: false, key };
        return { found: true, key, value };
      },
    }),
    [names.list]: tool({
      description: desc.list,
      parameters: z.object({
        prefix: z.string().describe(
          "Prefix to filter keys (e.g. 'user:'). Use empty string for all.",
        ).optional(),
      }),
      execute: async ({ prefix }, ctx) => {
        const entries = await ctx.kv.list(prefix ?? "");
        return { count: entries.length, keys: entries.map((e) => e.key) };
      },
    }),
    [names.forget]: tool({
      description: desc.forget,
      parameters: z.object({
        key: z.string().describe("The key to delete"),
      }),
      execute: async ({ key }, ctx) => {
        await ctx.kv.delete(key);
        return { deleted: key };
      },
    }),
  };
}
