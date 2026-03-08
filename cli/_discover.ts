import { parse as parseDotenv } from "@std/dotenv/parse";
import { exists } from "@std/fs/exists";
import { basename, join, resolve } from "@std/path";
function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
import { step } from "./_output.ts";
import { AAI_ROOT, importTempModule } from "./_bundler.ts";
import {
  type AgentConfig,
  type AgentDef,
  agentToolsToSchemas,
  type ToolSchema,
} from "@aai/sdk/types";

const CONFIG_DIR = join(
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".",
  ".config",
  "aai",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

type AgentLink = {
  namespace: string;
  slug: string;
  apiKey: string;
};

type CliConfig = {
  assemblyai_api_key?: string;
  rime_api_key?: string;
  brave_api_key?: string;
  namespace?: string;
  agents?: Record<string, AgentLink>;
};

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

export async function getApiKey(): Promise<string> {
  const config = await readConfig();
  if (config.assemblyai_api_key) {
    Deno.env.set("ASSEMBLYAI_API_KEY", config.assemblyai_api_key);
    return config.assemblyai_api_key;
  }

  step("Setup", "AssemblyAI API key required for speech-to-text");
  console.log("Get one at https://www.assemblyai.com/dashboard/signup\n");
  const key = prompt("Enter your ASSEMBLYAI_API_KEY:")?.trim();
  if (!key) {
    throw new Error("ASSEMBLYAI_API_KEY is required");
  }

  config.assemblyai_api_key = key;
  Deno.env.set("ASSEMBLYAI_API_KEY", key);
  await writeConfig(config);
  step("Saved", CONFIG_FILE);
  return key;
}

export async function getNamespace(): Promise<string> {
  const config = await readConfig();
  if (config.namespace) return config.namespace;

  console.log(
    "\nChoose a namespace for your agents.\n" +
      "Agents deploy to https://aai-agent.fly.dev/<namespace>/\n",
  );

  const ns = prompt("Namespace:")?.trim();
  if (!ns) {
    throw new Error("Namespace is required");
  }

  const slug = slugify(ns);
  if (!slug) {
    throw new Error("Invalid namespace — must contain alphanumeric characters");
  }

  config.namespace = slug;
  await writeConfig(config);
  step("Saved", `namespace: ${slug}`);
  return slug;
}

export async function saveNamespace(namespace: string): Promise<void> {
  const config = await readConfig();
  config.namespace = namespace;
  await writeConfig(config);
  step("Saved", `namespace: ${namespace}`);
}

export function slugFromDir(dir: string): string {
  const dirName = basename(resolve(dir));
  const slug = slugify(dirName);
  return slug || "agent";
}

export function incrementName(name: string): string {
  const match = name.match(/^(.+)-(\d+)$/);
  if (match) {
    return `${match[1]}-${Number(match[2]) + 1}`;
  }
  return `${name}-1`;
}

export async function resolveSlug(
  dir: string,
  namespace: string,
  baseSlug: string,
): Promise<string> {
  const config = await readConfig();
  const agents = config.agents ?? {};
  const resolvedDir = resolve(dir);

  const existing = agents[resolvedDir];
  if (existing && existing.namespace === namespace) {
    return existing.slug;
  }

  let slug = baseSlug;
  for (let i = 0; i < 100; i++) {
    const taken = Object.entries(agents).some(
      ([agentDir, link]) =>
        agentDir !== resolvedDir &&
        link.namespace === namespace &&
        link.slug === slug,
    );
    if (!taken) return slug;
    slug = incrementName(slug);
  }

  return slug;
}

export async function saveAgentLink(
  dir: string,
  link: AgentLink,
): Promise<void> {
  const config = await readConfig();
  if (!config.agents) config.agents = {};
  config.agents[resolve(dir)] = link;
  await writeConfig(config);
}

export type AgentEntry = {
  slug: string;
  dir: string;
  entryPoint: string;
  env: Record<string, string>;
  clientEntry: string;
  transport: ("websocket" | "twilio")[];
  config?: AgentConfig;
  toolSchemas?: ToolSchema[];
};

export const DEFAULT_SERVER = "https://aai-agent.fly.dev";

const WORKSPACE_IMPORTS = new Set(["@aai/sdk", "@aai/ui", "zod"]);

export async function hasExternalImports(dir: string): Promise<boolean> {
  try {
    const raw = JSON.parse(
      await Deno.readTextFile(join(dir, "deno.json")),
    );
    const imports = raw.imports ?? {};
    if (Object.keys(imports).some((k) => !WORKSPACE_IMPORTS.has(k))) {
      return true;
    }
  } catch { /* no deno.json */ }

  try {
    const raw = JSON.parse(
      await Deno.readTextFile(join(dir, "package.json")),
    );
    const deps = raw.dependencies ?? {};
    if (Object.keys(deps).length > 0) return true;
  } catch { /* no package.json */ }

  return false;
}

async function importAgentDef(dir: string): Promise<AgentDef | null> {
  if (await hasExternalImports(dir)) return null;
  const mod = await importTempModule(join(dir, "agent.ts"), {
    rewriteSdkImports: true,
  });
  return mod.default as AgentDef;
}

export async function loadAgent(dir: string): Promise<AgentEntry | null> {
  const hasAgentTs = await exists(join(dir, "agent.ts"));
  if (!hasAgentTs) return null;

  const def = await importAgentDef(dir);

  const slug = slugFromDir(dir);
  const declared: readonly string[] = def?.env ?? ["ASSEMBLYAI_API_KEY"];
  const transport: ("websocket" | "twilio")[] = def?.transport
    ? [...def.transport]
    : ["websocket"];

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
    const hasEnvFile = await exists(join(dir, ".env"));
    const hint = hasEnvFile
      ? `Add them to .env:\n\n${missing.map((k) => `  ${k}=`).join("\n")}\n`
      : `Create a .env file:\n\n${missing.map((k) => `  ${k}=`).join("\n")}\n`;
    throw new Error(
      `missing env vars required by agent: ${missing.join(", ")}\n\n${hint}`,
    );
  }

  const clientEntry = await exists(join(dir, "client.tsx"))
    ? join(dir, "client.tsx")
    : resolve(AAI_ROOT, "ui/client.tsx");

  const config: AgentConfig | undefined = def
    ? {
      name: def.name,
      instructions: def.instructions,
      greeting: def.greeting,
      voice: def.voice,
      prompt: def.prompt,
      builtinTools: def.builtinTools ? [...def.builtinTools] : undefined,
    }
    : undefined;

  const toolSchemas: ToolSchema[] | undefined = def
    ? agentToolsToSchemas(def.tools)
    : undefined;

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env,
    clientEntry,
    transport,
    config,
    toolSchemas,
  };
}

export async function ensureClaudeMd(targetDir: string): Promise<void> {
  const claudePath = join(targetDir, "CLAUDE.md");
  if (!await exists(claudePath)) {
    const srcClaude = join(AAI_ROOT, "cli", "claude.md");
    await Deno.copyFile(srcClaude, claudePath);
    step("Wrote", "CLAUDE.md — read this file for the aai agent API reference");
  }
}
