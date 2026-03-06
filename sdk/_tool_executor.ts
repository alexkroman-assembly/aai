import { z } from "zod";
import {
  normalizeParameters,
  type ToolContext,
  type ToolDef,
} from "./types.ts";

export const TOOL_HANDLER_TIMEOUT = 30_000;

type JSONSchemaParam = Parameters<typeof z.fromJSONSchema>[0];

export type ExecuteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  tool: ToolDef,
  secrets: Record<string, string>,
): Promise<string> {
  const params = normalizeParameters(tool.parameters);
  const validator = z.fromJSONSchema(params as JSONSchemaParam);
  const parsed = validator.safeParse(args);
  if (!parsed.success) {
    const issues = (parsed.error?.issues ?? [])
      .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join(", ");
    return `Error: Invalid arguments for tool "${name}": ${issues}`;
  }

  try {
    const signal = AbortSignal.timeout(TOOL_HANDLER_TIMEOUT);
    const ctx: ToolContext = {
      secrets: { ...secrets },
      fetch: globalThis.fetch,
      signal,
    };
    const result = await Promise.resolve(
      tool.execute(parsed.data as Record<string, unknown>, ctx),
    );
    if (result == null) return "null";
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      console.warn(`[tool-executor] Tool execution timed out: ${name}`);
      return `Error: Tool "${name}" timed out after ${TOOL_HANDLER_TIMEOUT}ms`;
    }
    console.warn(`[tool-executor] Tool execution failed: ${name}`, err);
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
