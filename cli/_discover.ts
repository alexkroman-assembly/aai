import { parse as parseDotenv } from "@std/dotenv/parse";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { z } from "zod";

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

export interface AgentEntry {
  slug: string;
  dir: string;
  entryPoint: string;
  env: Record<string, string>;
  clientEntry: string;
  transport: ("websocket" | "twilio")[];
}

const TransportEnum = z.enum(["websocket", "twilio"]);

const AgentJsonSchema = z.object({
  slug: z.string(),
  env: z.record(z.string(), z.union([z.string(), z.null()])),
  transport: z.union([TransportEnum, z.array(TransportEnum)]).optional(),
});

export async function loadAgent(dir: string): Promise<AgentEntry | null> {
  try {
    await Deno.stat(join(dir, "agent.ts"));
  } catch {
    return null;
  }

  let raw: string;
  try {
    raw = await Deno.readTextFile(join(dir, "agent.json"));
  } catch {
    return null;
  }

  const parsed = AgentJsonSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return null;
  const { slug, env: declared } = parsed.data;
  const transport: ("websocket" | "twilio")[] =
    parsed.data.transport === undefined
      ? ["websocket"]
      : typeof parsed.data.transport === "string"
      ? [parsed.data.transport]
      : parsed.data.transport;

  const dotenvText = await Deno.readTextFile(join(dir, ".env")).catch(() => "");
  const dotenv = parseDotenv(dotenvText);

  const env: Record<string, string> = {};
  const missing: string[] = [];

  for (const [key, defaultVal] of Object.entries(declared)) {
    const resolved = dotenv[key] ?? Deno.env.get(key) ?? defaultVal;
    if (resolved === null || resolved === undefined) {
      missing.push(key);
    } else {
      env[key] = resolved;
    }
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

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env,
    clientEntry,
    transport,
  };
}
