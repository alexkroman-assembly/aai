import { join } from "@std/path";
import { log } from "./_output.ts";
import { generateTypes } from "./types.ts";

export interface NewOptions {
  projectName: string;
  template: string;
  templatesDir: string;
  outDir: string;
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

export async function runNew(opts: NewOptions): Promise<void> {
  const { projectName, template, templatesDir, outDir } = opts;
  const available = await listTemplates(templatesDir);

  if (!available.includes(template)) {
    throw new Error(
      `unknown template '${template}' — available: ${available.join(", ")}`,
    );
  }

  const src = join(templatesDir, template);
  const dest = join(outDir, projectName);

  try {
    await Deno.stat(dest);
    throw new Error(`directory '${dest}' already exists`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  log.step("Create", `${projectName} from template '${template}'`);

  await copyDir(src, dest);

  // Update slug in agent.json
  const agentJsonPath = join(dest, "agent.json");
  try {
    const raw = await Deno.readTextFile(agentJsonPath);
    const config = JSON.parse(raw);
    config.slug = projectName;
    await Deno.writeTextFile(
      agentJsonPath,
      JSON.stringify(config, null, 2) + "\n",
    );
  } catch {
    // No agent.json to update — that's fine
  }

  // Generate ambient type declarations for editor autocomplete
  await generateTypes(dest);
  log.step("Generated", "types.d.ts");

  // Copy .env.example as .env
  const envExamplePath = join(dest, ".env.example");
  try {
    await Deno.copyFile(envExamplePath, join(dest, ".env"));
    log.warn("created .env from .env.example — fill in your keys");
  } catch {
    // No .env.example in template — skip
  }

  log.step("Done", dest);
  console.log(`\nNext steps:`);
  console.log(`    cd ${projectName}`);
  console.log(`    ${log.cyan("aai dev")}`);
}
