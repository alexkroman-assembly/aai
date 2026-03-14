// Copyright 2025 the AAI authors. MIT license.
import { promptSecret } from "@std/cli/prompt-secret";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join } from "@std/path";
import { humanId } from "human-id";
import { step } from "./_output.ts";

/**
 * Returns the path to the `deno` executable. When running as a compiled
 * binary, `Deno.execPath()` returns the binary itself (e.g. `aai`), so
 * we fall back to `"deno"` which must be on PATH.
 */
export function denoExec(): string {
  const p = Deno.execPath();
  return p.endsWith("deno") ? p : "deno";
}

/**
 * Generates a human-readable slug using human-id.
 */
export function generateSlug(): string {
  return humanId({ separator: "-", capitalize: false });
}

// --- Global auth config (~/.config/aai/config.json) ---
// Only stores the AssemblyAI API key, like Vercel stores auth in ~/.vercel/auth.json

const CONFIG_DIR = join(
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".",
  ".config",
  "aai",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

type AuthConfig = {
  "assemblyai_api_key"?: string;
};

async function readAuthConfig(): Promise<AuthConfig> {
  try {
    return JSON.parse(await Deno.readTextFile(CONFIG_FILE));
  } catch {
    return {};
  }
}

async function writeAuthConfig(config: AuthConfig): Promise<void> {
  await Deno.mkdir(CONFIG_DIR, { recursive: true });
  await Deno.writeTextFile(
    CONFIG_FILE,
    JSON.stringify(config, null, 2) + "\n",
  );
  if (Deno.build.os !== "windows") {
    await Deno.chmod(CONFIG_FILE, 0o600);
  }
}

/**
 * Retrieves the AssemblyAI API key from `~/.config/aai/config.json`.
 * If not found, interactively prompts the user and persists it.
 */
export async function getApiKey(): Promise<string> {
  const config = await readAuthConfig();
  if (config.assemblyai_api_key) {
    Deno.env.set("ASSEMBLYAI_API_KEY", config.assemblyai_api_key);
    return config.assemblyai_api_key;
  }

  step("Setup", "AssemblyAI API key required for speech-to-text");
  console.log("Get one at https://www.assemblyai.com/dashboard/signup\n");
  let key: string | null = null;
  while (!key) {
    key = promptSecret("ASSEMBLYAI_API_KEY");
  }

  config.assemblyai_api_key = key;
  Deno.env.set("ASSEMBLYAI_API_KEY", key);
  await writeAuthConfig(config);
  step("Saved", CONFIG_FILE);
  return key;
}

// --- Project-local config (.aai/project.json) ---
// Like .vercel/project.json — stores slug, server URL

/** Project-level deployment metadata stored in `.aai/project.json`. */
export type ProjectConfig = {
  slug: string;
  serverUrl: string;
};

/**
 * Reads `.aai/project.json` from an agent directory.
 * Returns null if the file doesn't exist.
 */
export async function readProjectConfig(
  agentDir: string,
): Promise<ProjectConfig | null> {
  try {
    return JSON.parse(
      await Deno.readTextFile(join(agentDir, ".aai", "project.json")),
    );
  } catch {
    return null;
  }
}

/**
 * Writes `.aai/project.json` to an agent directory.
 */
export async function writeProjectConfig(
  agentDir: string,
  data: ProjectConfig,
): Promise<void> {
  const aaiDir = join(agentDir, ".aai");
  await Deno.mkdir(aaiDir, { recursive: true });
  await Deno.writeTextFile(
    join(aaiDir, "project.json"),
    JSON.stringify(data, null, 2) + "\n",
  );
}

// --- Agent discovery ---

/** Discovered agent metadata extracted from an agent directory. */
export type AgentEntry = {
  /** URL-safe identifier from project config or generated. */
  slug: string;
  /** Absolute path to the agent directory. */
  dir: string;
  /** Absolute path to the `agent.ts` entry point. */
  entryPoint: string;
  /** Environment variables loaded from `.env` (includes `ASSEMBLYAI_API_KEY`). */
  env: Record<string, string>;
  /** Absolute path to the client entry point (`client.ts` or empty). */
  clientEntry: string;
  /** Transport protocols the agent supports. */
  transport: readonly ("websocket" | "twilio")[];
};

/** Default production server URL for agent deployments. */
export const DEFAULT_SERVER = "https://aai-agent.fly.dev";

/**
 * Loads agent metadata from a directory by checking for `agent.ts` and
 * resolving the client entry point.
 *
 * Env vars are NOT read from `.env` — they're managed on the server
 * via `aai env add` (like `vercel env add`).
 */
export async function loadAgent(dir: string): Promise<AgentEntry | null> {
  const hasAgentTs = await exists(join(dir, "agent.ts"));
  if (!hasAgentTs) return null;

  const config = await readProjectConfig(dir);
  const slug = config?.slug ?? generateSlug();

  const clientEntry = await exists(join(dir, "client.tsx"))
    ? join(dir, "client.tsx")
    : "";

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env: {},
    clientEntry,
    transport: ["websocket"],
  };
}

/**
 * Copies `templates/_shared/CLAUDE.md` into the agent directory as `CLAUDE.md`.
 * Creates the file if missing or updates it if the content has changed.
 */
export async function ensureClaudeMd(targetDir: string): Promise<void> {
  const claudePath = join(targetDir, "CLAUDE.md");
  const cliDir = dirname(fromFileUrl(import.meta.url));
  const srcPath = join(cliDir, "..", "templates", "_shared", "CLAUDE.md");
  const srcContent = await Deno.readTextFile(srcPath);
  let existing = "";
  try {
    existing = await Deno.readTextFile(claudePath);
  } catch { /* file doesn't exist */ }
  if (existing !== srcContent) {
    await Deno.writeTextFile(claudePath, srcContent);
    step(
      existing ? "Updated" : "Wrote",
      "CLAUDE.md — aai agent API reference",
    );
  }
}

/**
 * Install dependencies if `node_modules/` doesn't exist.
 * Uses `deno install` which reads package.json and installs from npm.
 */
export async function ensureDependencies(
  targetDir: string,
): Promise<void> {
  if (!await exists(join(targetDir, "node_modules"))) {
    step("Install", "dependencies");
    const cmd = new Deno.Command(denoExec(), {
      args: ["install"],
      cwd: targetDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    const { code } = await cmd.output();
    if (code !== 0) {
      step("Skip", "deno install failed");
    }
  }
}
