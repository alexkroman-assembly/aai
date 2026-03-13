// Copyright 2025 the AAI authors. MIT license.
/**
 * Pre-built KV memory tools for agents.
 *
 * @module
 */

import { z } from "zod";
import type { ToolDef } from "./types.ts";

/**
 * Options to customize tool names and descriptions for {@linkcode kvTools}.
 *
 * Use this to rename the generated tools or provide custom descriptions
 * that better fit your agent's persona.
 */
export type KvToolsOptions = {
  /** Override default tool names. */
  names?: {
    save?: string;
    recall?: string;
    list?: string;
    forget?: string;
  };
  /** Override default tool descriptions. */
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

/**
 * Create a set of save/recall/list/forget tools backed by the session KV store.
 *
 * Returns four tools that let the LLM persist and retrieve information
 * across turns using the agent's {@linkcode Kv} store. Tool names and
 * descriptions can be customized via `options`.
 *
 * Default tool names: `save_memory`, `recall_memory`, `list_memories`,
 * `forget_memory`.
 *
 * @param options Optional overrides for tool names and descriptions.
 * @returns A record of tool name to {@linkcode ToolDef} mappings, ready
 *   to spread into your agent's `tools` config.
 *
 * @example
 * ```ts
 * import { defineAgent, kvTools } from "@aai/sdk";
 *
 * export default defineAgent({
 *   name: "memory-bot",
 *   instructions: "You remember things for the user.",
 *   tools: {
 *     ...kvTools(),
 *   },
 * });
 * ```
 *
 * @example With custom names
 * ```ts
 * import { defineAgent, kvTools } from "@aai/sdk";
 *
 * export default defineAgent({
 *   name: "notes-bot",
 *   instructions: "You take notes for the user.",
 *   tools: {
 *     ...kvTools({
 *       names: { save: "take_note", recall: "read_note" },
 *     }),
 *   },
 * });
 * ```
 */
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
      execute: async (
        { key, value }: { key: string; value: string },
        ctx,
      ) => {
        await ctx.kv.set(key, value);
        return { saved: key };
      },
    },
    [names.recall]: {
      description: desc.recall,
      parameters: z.object({
        key: z.string().describe("The key to look up"),
      }),
      execute: async ({ key }: { key: string }, ctx) => {
        const value = await ctx.kv.get(key);
        if (value === null) return { found: false, key };
        return { found: true, key, value };
      },
    },
    [names.list]: {
      description: desc.list,
      parameters: z.object({
        prefix: z.string().describe(
          "Prefix to filter keys (e.g. 'user:'). Use empty string for all.",
        ).optional(),
      }),
      execute: async ({ prefix }: { prefix?: string }, ctx) => {
        const entries = await ctx.kv.list(prefix ?? "");
        return { count: entries.length, keys: entries.map((e) => e.key) };
      },
    },
    [names.forget]: {
      description: desc.forget,
      parameters: z.object({
        key: z.string().describe("The key to delete"),
      }),
      execute: async ({ key }: { key: string }, ctx) => {
        await ctx.kv.delete(key);
        return { deleted: key };
      },
    },
  };
}
