import { dirname, join, resolve } from "@std/path";
import { toFileUrl } from "@std/path/to-file-url";
import type { AgentEntry } from "./_discover.ts";
import { stripTypes } from "./_bundler.ts";

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
 * defineAgent() already validates fields -- we just check that
 * the module loads and produces a valid default export.
 *
 * Uses esbuild to strip types before importing because compiled
 * Deno binaries cannot dynamically import TypeScript files.
 *
 * Agents with npm deps skip validation here -- esbuild catches errors during bundling.
 */
export async function validateAgent(
  agent: AgentEntry,
): Promise<ValidationResult> {
  if (agent.hasNpmDeps) {
    return { errors: [] };
  }

  const errors: ValidationError[] = [];

  const saved = {
    defineAgent: (globalThis as Record<string, unknown>).defineAgent,
    fetchJSON: (globalThis as Record<string, unknown>).fetchJSON,
    z: (globalThis as Record<string, unknown>).z,
  };

  let mod: Record<string, unknown>;
  const tmpPath = join(
    dirname(resolve(agent.entryPoint)),
    `.aai-validate-${Date.now()}.js`,
  );
  try {
    const { defineAgent } = await import("../sdk/define_agent.ts");
    const { fetchJSON } = await import("../sdk/fetch_json.ts");
    const { z } = await import("zod");
    Object.assign(globalThis, { defineAgent, fetchJSON, z });

    const source = await Deno.readTextFile(resolve(agent.entryPoint));
    const js = await stripTypes(source);
    await Deno.writeTextFile(tmpPath, js);
    mod = await import(toFileUrl(tmpPath).href);
  } catch (cause) {
    errors.push({
      field: "agent.ts",
      message: `failed to import: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
    return { errors };
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
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
        "missing default export -- use `export default defineAgent({...})`",
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
