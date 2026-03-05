import { join } from "@std/path";
import { log } from "./_output.ts";

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
  await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

/** Get the stored API key, prompting the user if not set. */
export async function getApiKey(): Promise<string> {
  // Check environment first
  const envKey = Deno.env.get("ASSEMBLYAI_API_KEY");
  if (envKey) return envKey;

  // Check stored config
  const config = await readConfig();
  if (config.assemblyai_api_key) return config.assemblyai_api_key;

  // Prompt the user
  log.step("Setup", "AssemblyAI API key required for speech-to-text");
  console.log("  Get one at https://www.assemblyai.com/dashboard/signup\n");
  const key = prompt("  Enter your ASSEMBLYAI_API_KEY:")?.trim();
  if (!key) {
    throw new Error("ASSEMBLYAI_API_KEY is required");
  }

  config.assemblyai_api_key = key;
  await writeConfig(config);
  log.step("Saved", CONFIG_FILE);
  return key;
}
