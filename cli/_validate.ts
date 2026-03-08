import { hasExternalImports } from "./_discover.ts";
import type { AgentEntry } from "./_discover.ts";
import { importTempModule } from "./_bundler.ts";
import type { AgentDef, ToolContext, ToolDef } from "../sdk/types.ts";

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

  const ctx: ToolContext = { sessionId: "test", env: agent.env };
  const results: ToolTestResult[] = [];

  for (const [name, tool] of Object.entries(def.tools)) {
    results.push(await testOneTool(name, tool, ctx));
  }
  return results;
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
    const parseResult = tool.parameters.safeParse({});
    if (!parseResult.success) {
      return { name, ok: true, skipped: true };
    }
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
