import { join } from "@std/path";
import { log } from "./_output.ts";
import { generateTypes } from "./types.ts";

export interface NewOptions {
  slug: string;
  targetDir: string;
  template: string;
  templatesDir: string;
}

async function listTemplates(dir: string): Promise<string[]> {
  const templates: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) templates.push(entry.name);
  }
  return templates.sort();
}

async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

export async function runNew(opts: NewOptions): Promise<string> {
  const { slug, targetDir, template, templatesDir } = opts;
  const available = await listTemplates(templatesDir);

  if (!available.includes(template)) {
    throw new Error(
      `unknown template '${template}' — available: ${available.join(", ")}`,
    );
  }

  const src = join(templatesDir, template);

  log.step("Create", `${slug} from template '${template}'`);

  // Copy template files into target directory (skip node_modules)
  for await (const entry of Deno.readDir(src)) {
    if (entry.name === "node_modules") continue;
    const srcPath = join(src, entry.name);
    const destPath = join(targetDir, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }

  // Update slug in agent.json
  const agentJsonPath = join(targetDir, "agent.json");
  try {
    const raw = await Deno.readTextFile(agentJsonPath);
    const config = JSON.parse(raw);
    config.slug = slug;
    await Deno.writeTextFile(
      agentJsonPath,
      JSON.stringify(config, null, 2) + "\n",
    );
  } catch {
    // No agent.json to update — that's fine
  }

  // Install npm dependencies if agent.json declares them
  const agentRaw = await Deno.readTextFile(agentJsonPath).catch(() => "{}");
  const agentConfig = JSON.parse(agentRaw);
  if (agentConfig.npm && Object.keys(agentConfig.npm).length > 0) {
    const pkgJson = {
      private: true,
      dependencies: agentConfig.npm,
    };
    await Deno.writeTextFile(
      join(targetDir, "package.json"),
      JSON.stringify(pkgJson, null, 2) + "\n",
    );
    log.step("Install", "npm dependencies");
    const npm = new Deno.Command("npm", {
      args: ["install", "--silent"],
      cwd: targetDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stderr } = await npm.output();
    if (!success) {
      const err = new TextDecoder().decode(stderr).trim();
      throw new Error(`npm install failed: ${err}`);
    }
  }

  // Generate ambient type declarations for editor autocomplete
  // (after npm install so deno.json can detect package.json)
  await generateTypes(targetDir);

  // Copy .env.example as .env
  const envExamplePath = join(targetDir, ".env.example");
  try {
    await Deno.copyFile(envExamplePath, join(targetDir, ".env"));
  } catch {
    // No .env.example in template — skip
  }

  log.step("Done", targetDir);
  return targetDir;
}
