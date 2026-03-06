import { parse as parseDotenv } from "@std/dotenv/parse";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { getApiKey } from "./_config.ts";
import { AgentJsonSchema, normalizeTransport } from "../shared/schema.ts";

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

export interface AgentEntry {
  slug: string;
  dir: string;
  entryPoint: string;
  env: Record<string, string>;
  clientEntry: string;
  transport: ("websocket" | "twilio")[];
  hasNpmDeps: boolean;
}

export async function loadAgent(dir: string): Promise<AgentEntry | null> {
  let hasAgentTs = false;
  try {
    await Deno.stat(join(dir, "agent.ts"));
    hasAgentTs = true;
  } catch { /* missing */ }

  let hasAgentJson = false;
  try {
    await Deno.stat(join(dir, "agent.json"));
    hasAgentJson = true;
  } catch { /* missing */ }

  if (!hasAgentTs && !hasAgentJson) return null;
  if (!hasAgentTs) {
    throw new Error(`found agent.json but no agent.ts in ${dir}`);
  }
  if (!hasAgentJson) {
    throw new Error(`found agent.ts but no agent.json in ${dir}`);
  }

  const raw = await Deno.readTextFile(join(dir, "agent.json"));
  const parsed = AgentJsonSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`invalid agent.json: ${issues}`);
  }
  const { slug } = parsed.data;

  const declared = parsed.data.env as string[];
  const transport = normalizeTransport(
    parsed.data.transport as
      | "websocket"
      | "twilio"
      | ("websocket" | "twilio")[]
      | undefined,
  );

  const dotenvText = await Deno.readTextFile(join(dir, ".env")).catch(() => "");
  const dotenv = parseDotenv(dotenvText);

  const env: Record<string, string> = {};
  const missing: string[] = [];

  for (const key of declared) {
    const resolved = dotenv[key] ?? Deno.env.get(key);
    if (resolved === undefined) {
      missing.push(key);
    } else {
      env[key] = resolved;
    }
  }

  // Resolve missing ASSEMBLYAI_API_KEY from global config (prompts on first use)
  if (missing.includes("ASSEMBLYAI_API_KEY")) {
    env.ASSEMBLYAI_API_KEY = await getApiKey();
    missing.splice(missing.indexOf("ASSEMBLYAI_API_KEY"), 1);
  }

  if (missing.length > 0) {
    throw new Error(
      `agent.json requires env vars not found in .env or process env: ${
        missing.join(", ")
      }`,
    );
  }

  let clientEntry = resolve(AAI_ROOT, "ui/client.tsx");
  try {
    await Deno.stat(join(dir, "client.tsx"));
    clientEntry = join(dir, "client.tsx");
  } catch { /* use default */ }

  let hasNpmDeps = false;
  try {
    await Deno.stat(join(dir, "node_modules"));
    hasNpmDeps = true;
  } catch { /* no node_modules */ }

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env,
    clientEntry,
    transport,
    hasNpmDeps,
  };
}
