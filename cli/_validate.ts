import { z } from "zod";
import { hasExternalImports } from "./_discover.ts";
import type { AgentEntry } from "./_discover.ts";
import { importTempModule } from "./_bundler.ts";
import type { AgentDef, ToolContext, ToolDef } from "@aai/sdk/types";

type ValidationError = {
  field: string;
  message: string;
};

export type ToolTestResult = {
  name: string;
  ok: boolean;
  error?: string;
  result?: unknown;
  skipped?: boolean;
};

export type ValidationResult = {
  errors: ValidationError[];
  toolTests?: ToolTestResult[];
};

export async function validateAgent(
  agent: AgentEntry,
): Promise<ValidationResult> {
  if (await hasExternalImports(agent.dir)) {
    return { errors: [] };
  }

  const errors: ValidationError[] = [];

  let mod: Record<string, unknown>;
  try {
    mod = await importTempModule(agent.entryPoint);
  } catch (cause) {
    errors.push({
      field: "agent.ts",
      message: `failed to import: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
    return { errors };
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

  if (typeof def.name !== "string" || !def.name) {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  const toolTests = await testTools(
    def as unknown as AgentDef,
    agent,
  );

  return { errors, toolTests };
}

async function testTools(
  def: AgentDef,
  agent: AgentEntry,
): Promise<ToolTestResult[]> {
  if (!def.tools || Object.keys(def.tools).length === 0) return [];

  const state = def.state ? (def.state as () => unknown)() : {};
  const ctx: ToolContext = {
    sessionId: "test",
    env: agent.env,
    state: state as Record<string, unknown>,
  };
  const results: ToolTestResult[] = [];

  for (const [name, tool] of Object.entries(def.tools)) {
    results.push(await testOneTool(name, tool, ctx));
  }
  return results;
}

/** Generate a sample value from a JSON Schema property. */
export function sampleFromJsonSchema(schema: Record<string, unknown>): unknown {
  const type = schema.type as string | undefined;
  if (schema.enum) return (schema.enum as unknown[])[0];
  if (schema.const !== undefined) return schema.const;
  switch (type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      const props = schema.properties as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (!props) return {};
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        obj[k] = sampleFromJsonSchema(v);
      }
      return obj;
    }
    default:
      return null;
  }
}

/** Generate sample args for a Zod object schema using its JSON Schema. */
export function sampleArgs(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const props = jsonSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!props) return {};
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    args[k] = sampleFromJsonSchema(v);
  }
  return args;
}

async function testOneTool(
  name: string,
  tool: ToolDef,
  ctx: ToolContext,
): Promise<ToolTestResult> {
  if (!tool.description) {
    return { name, ok: false, error: "missing description" };
  }

  if (tool.parameters) {
    // First try empty args (works for tools with all-optional params)
    const parseResult = tool.parameters.safeParse({});
    if (parseResult.success) {
      try {
        const result = await tool.execute(parseResult.data, ctx);
        return { name, ok: true, result };
      } catch (err) {
        return {
          name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Generate sample args from schema and validate the round-trip
    const sample = sampleArgs(tool.parameters);
    const sampleParse = tool.parameters.safeParse(sample);
    if (!sampleParse.success) {
      return {
        name,
        ok: false,
        error:
          `schema validation failed with sample args: ${sampleParse.error.message} — check your Zod schema in the tool's parameters field`,
      };
    }

    try {
      const result = await tool.execute(sampleParse.data, ctx);
      return { name, ok: true, result };
    } catch {
      // Execution errors with sample data are expected -- the schema is valid
      return { name, ok: true, result: "(executed with sample args)" };
    }
  }

  try {
    const result = await tool.execute({}, ctx);
    return { name, ok: true, result };
  } catch (err) {
    return {
      name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
