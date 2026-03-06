import { parse as parseDotenv } from "@std/dotenv/parse";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { step } from "./_output.ts";
import { AgentJsonSchema, normalizeTransport } from "../sdk/_schema.ts";

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

// -- API key config -----------------------------------------------------------

const CONFIG_DIR = join(
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".",
  ".config",
  "aai",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface CliConfig {
  assemblyai_api_key?: string;
}

async function readConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await Deno.readTextFile(CONFIG_FILE));
  } catch {
    return {};
  }
}

async function writeConfig(config: CliConfig): Promise<void> {
  await Deno.mkdir(CONFIG_DIR, { recursive: true });
  await Deno.writeTextFile(
    CONFIG_FILE,
    JSON.stringify(config, null, 2) + "\n",
  );
}

/** Get the stored API key, prompting the user if not set. */
export async function getApiKey(): Promise<string> {
  const envKey = Deno.env.get("ASSEMBLYAI_API_KEY");
  if (envKey) return envKey;

  const config = await readConfig();
  if (config.assemblyai_api_key) return config.assemblyai_api_key;

  step("Setup", "AssemblyAI API key required for speech-to-text");
  console.log("Get one at https://www.assemblyai.com/dashboard/signup\n");
  const key = prompt("Enter your ASSEMBLYAI_API_KEY:")?.trim();
  if (!key) {
    throw new Error("ASSEMBLYAI_API_KEY is required");
  }

  config.assemblyai_api_key = key;
  await writeConfig(config);
  step("Saved", CONFIG_FILE);
  return key;
}

// -- Agent discovery ----------------------------------------------------------

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
  const hasAgentTs = await exists(join(dir, "agent.ts"));
  const hasAgentJson = await exists(join(dir, "agent.json"));

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
      .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`invalid agent.json: ${issues}`);
  }
  const { slug, env: declared } = parsed.data;
  const transport = normalizeTransport(parsed.data.transport);

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

  const clientEntry = await exists(join(dir, "client.tsx"))
    ? join(dir, "client.tsx")
    : resolve(AAI_ROOT, "ui/client.tsx");

  const hasNpmDeps = await exists(join(dir, "node_modules"));

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
