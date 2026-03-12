import { Input, Secret } from "@cliffy/prompt";
import { parse as parseDotenv } from "@std/dotenv/parse";
import { exists } from "@std/fs/exists";
import { basename, join, resolve } from "@std/path";
import { z } from "zod";
export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
import { step } from "./_output.ts";
import { AAI_ROOT } from "./_bundler.ts";

const CONFIG_DIR = join(
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".",
  ".config",
  "aai",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const AgentLinkSchema = z.object({
  namespace: z.string(),
  slug: z.string(),
  apiKey: z.string(),
});

type AgentLink = z.infer<typeof AgentLinkSchema>;

const CliConfigSchema = z.object({
  assemblyai_api_key: z.string().optional(),
  namespace: z.string().optional(),
  agents: z.record(z.string(), AgentLinkSchema).optional(),
});

type CliConfig = z.infer<typeof CliConfigSchema>;

async function readConfig(): Promise<CliConfig> {
  try {
    return CliConfigSchema.parse(
      JSON.parse(await Deno.readTextFile(CONFIG_FILE)),
    );
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
  // Restrict to owner-only read/write (like ~/.fly/config.yml)
  if (Deno.build.os !== "windows") {
    await Deno.chmod(CONFIG_FILE, 0o600);
  }
}

export async function getApiKey(): Promise<string> {
  const config = await readConfig();
  if (config.assemblyai_api_key) {
    Deno.env.set("ASSEMBLYAI_API_KEY", config.assemblyai_api_key);
    return config.assemblyai_api_key;
  }

  step("Setup", "AssemblyAI API key required for speech-to-text");
  console.log("Get one at https://www.assemblyai.com/dashboard/signup\n");
  const key = await Secret.prompt({
    message: "ASSEMBLYAI_API_KEY",
    minLength: 1,
  });

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

  const ns = await Input.prompt({
    message: "Namespace",
    minLength: 1,
    transform: (v) => slugify(v),
    validate: (v) => slugify(v) ? true : "Must contain alphanumeric characters",
  });
  const slug = slugify(ns);

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
};

export const DEFAULT_SERVER = "https://aai-agent.fly.dev";

export async function loadAgent(dir: string): Promise<AgentEntry | null> {
  const hasAgentTs = await exists(join(dir, "agent.ts"));
  if (!hasAgentTs) return null;

  const slug = slugFromDir(dir);

  // Load all .env vars — the server extracts declared env from the worker at runtime
  const dotenvText = await Deno.readTextFile(join(dir, ".env")).catch(() => "");
  const env = parseDotenv(dotenvText);

  if (!env.ASSEMBLYAI_API_KEY && !Deno.env.get("ASSEMBLYAI_API_KEY")) {
    env.ASSEMBLYAI_API_KEY = await getApiKey();
  } else if (!env.ASSEMBLYAI_API_KEY) {
    env.ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY")!;
  }

  const clientEntry = await exists(join(dir, "client.ts"))
    ? join(dir, "client.ts")
    : await exists(join(dir, "client.tsx"))
    ? join(dir, "client.tsx")
    : resolve(AAI_ROOT, "ui/client.ts");

  return {
    slug,
    dir,
    entryPoint: join(dir, "agent.ts"),
    env,
    clientEntry,
    transport: ["websocket"],
  };
}

export async function ensureClaudeMd(targetDir: string): Promise<void> {
  const claudePath = join(targetDir, "CLAUDE.md");
  const srcClaude = join(AAI_ROOT, "cli", "claude.md");
  const srcContent = await Deno.readTextFile(srcClaude);
  let existing = "";
  try {
    existing = await Deno.readTextFile(claudePath);
  } catch { /* file doesn't exist */ }
  if (existing !== srcContent) {
    await Deno.copyFile(srcClaude, claudePath);
    step(
      existing ? "Updated" : "Wrote",
      "CLAUDE.md — aai agent API reference",
    );
  }
}

/**
 * Ensure package.json, tsconfig.json, and .npmrc exist in the agent directory
 * so editors can provide TypeScript autocomplete for @aai/sdk and @aai/ui.
 */
export async function ensureTypescriptSetup(
  targetDir: string,
): Promise<void> {
  const gitignorePath = join(targetDir, ".gitignore");
  if (!await exists(gitignorePath)) {
    await Deno.writeTextFile(gitignorePath, "node_modules/\n.env\n");
    step("Wrote", ".gitignore");
  }

  const npmrcPath = join(targetDir, ".npmrc");
  if (!await exists(npmrcPath)) {
    await Deno.writeTextFile(
      npmrcPath,
      "@jsr:registry=https://npm.jsr.io\n",
    );
    step("Wrote", ".npmrc");
  }

  const pkgPath = join(targetDir, "package.json");
  let needsInstall = false;
  if (!await exists(pkgPath)) {
    const dirName = basename(resolve(targetDir));
    const hasClient = await exists(join(targetDir, "client.ts")) ||
      await exists(join(targetDir, "client.tsx"));
    const pkg: Record<string, unknown> = {
      private: true,
      name: slugify(dirName) || "agent",
      scripts: {
        typecheck: "tsc --noEmit 2>&1 | grep -v 'node_modules/' || true",
      },
      dependencies: {
        "@jsr/aai__sdk": "*",
        ...(hasClient ? { "@jsr/aai__ui": "*" } : {}),
      },
      devDependencies: {
        typescript: "^5",
        ...(hasClient ? { preact: "^10" } : {}),
      },
    };
    await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    step("Wrote", "package.json");
    needsInstall = true;
  }

  const tsconfigPath = join(targetDir, "tsconfig.json");
  if (!await exists(tsconfigPath)) {
    const hasClient = await exists(join(targetDir, "client.ts")) ||
      await exists(join(targetDir, "client.tsx"));
    const tsconfig: Record<string, unknown> = {
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        noEmit: true,
        skipLibCheck: true,
        paths: {
          "@aai/sdk": ["./node_modules/@jsr/aai__sdk/_dist/mod.d.ts"],
          ...(hasClient
            ? {
              "@aai/ui": ["./node_modules/@jsr/aai__ui/_dist/mod.d.ts"],
            }
            : {}),
        },
        ...(hasClient ? { jsx: "react-jsx", jsxImportSource: "preact" } : {}),
      },
      include: hasClient
        ? ["agent.ts", "client.ts", "client.tsx"]
        : ["agent.ts"],
      exclude: ["node_modules"],
    };
    await Deno.writeTextFile(
      tsconfigPath,
      JSON.stringify(tsconfig, null, 2) + "\n",
    );
    step("Wrote", "tsconfig.json");
  }

  if (!needsInstall && await exists(pkgPath)) {
    needsInstall = !await exists(join(targetDir, "node_modules"));
  }

  if (needsInstall) {
    try {
      step("Install", "npm dependencies...");
      const cmd = new Deno.Command("npm", {
        args: ["install"],
        cwd: targetDir,
        stdout: "null",
        stderr: "null",
      });
      const { code } = await cmd.output();
      if (code !== 0) {
        step("Skip", "npm install");
      }
    } catch {
      // npm not found — skip silently
    }
  }
}
