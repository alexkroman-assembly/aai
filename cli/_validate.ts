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
  voice?: string;
  tools?: string[];
  builtinTools?: string[];
}

/**
 * Validate an agent by dynamically importing agent.ts.
 * defineAgent() already validates fields — we just check that
 * the module loads and produces a valid default export.
 *
 * Agents with npm deps skip validation here — esbuild catches errors during bundling.
 */
export async function validateAgent(
  agent: AgentEntry,
): Promise<ValidationResult> {
  if (agent.hasNpmDeps) {
    return { errors: [] };
  }

  const errors: ValidationError[] = [];

  // Temporarily inject the globals that agent.ts expects
  const saved = {
    defineAgent: (globalThis as Record<string, unknown>).defineAgent,
    fetchJSON: (globalThis as Record<string, unknown>).fetchJSON,
  };

  let mod: Record<string, unknown>;
  try {
    const { defineAgent } = await import("../server/agent.ts");
    const { fetchJSON } = await import("../server/fetch_json.ts");
    Object.assign(globalThis, { defineAgent, fetchJSON });

    mod = await import(
      `${toFileUrl(resolve(agent.entryPoint)).href}?t=${Date.now()}`
    );
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

  const name = typeof def.name === "string" ? def.name : undefined;
  if (!name) {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  const tools = def.tools && typeof def.tools === "object"
    ? Object.keys(def.tools as Record<string, unknown>)
    : [];

  const voice = typeof def.voice === "string" ? def.voice : "luna";

  const builtinTools = Array.isArray(def.builtinTools)
    ? (def.builtinTools as string[])
    : [];

  return { errors, name, voice, tools, builtinTools };
}
