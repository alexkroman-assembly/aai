import { resolve } from "@std/path";
import { toFileUrl } from "@std/path/to-file-url";
import type { AgentEntry } from "./_discover.ts";

interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  name?: string;
  tools?: string[];
  builtinTools?: string[];
}

/**
 * Validate an agent by dynamically importing agent.ts.
 * defineAgent() already validates fields — we just check that
 * the module loads and produces a valid default export.
 */
export async function validateAgent(
  agent: AgentEntry,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  // Temporarily inject the globals that agent.ts expects
  const saved = {
    defineAgent: (globalThis as Record<string, unknown>).defineAgent,
    fetchJSON: (globalThis as Record<string, unknown>).fetchJSON,
    z: (globalThis as Record<string, unknown>).z,
  };

  let mod: Record<string, unknown>;
  try {
    const { defineAgent } = await import("../server/agent.ts");
    const { fetchJSON } = await import("../server/fetch_json.ts");
    const { z } = await import("zod");
    Object.assign(globalThis, { defineAgent, fetchJSON, z });

    mod = await import(toFileUrl(resolve(agent.entryPoint)).href);
  } catch (err) {
    errors.push({
      field: "agent.ts",
      message: `failed to import: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return { errors };
  } finally {
    // Restore previous global state
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete (globalThis as Record<string, unknown>)[k];
      } else {
        (globalThis as Record<string, unknown>)[k] = v;
      }
    }
  }

  if (!mod.default) {
    errors.push({
      field: "agent.ts",
      message:
        "missing default export — use `export default defineAgent({...})`",
    });
    return { errors };
  }

  const def = mod.default as Record<string, unknown>;

  // defineAgent() freezes the object and sets defaults — just extract metadata
  const name = typeof def.name === "string" ? def.name : undefined;
  if (!name) {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  const tools = def.tools && typeof def.tools === "object"
    ? Object.keys(def.tools as Record<string, unknown>)
    : [];

  const builtinTools = Array.isArray(def.builtinTools)
    ? (def.builtinTools as string[])
    : [];

  return { errors, name, tools, builtinTools };
}
