import { join } from "@std/path";
import { step } from "./_output.ts";

export type NewOptions = {
  targetDir: string;
  template: string;
  templatesDir: string;
};

export async function listTemplates(dir: string): Promise<string[]> {
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
  const { targetDir, template, templatesDir } = opts;
  const available = await listTemplates(templatesDir);

  if (!available.includes(template)) {
    throw new Error(
      `unknown template '${template}' -- available: ${available.join(", ")}`,
    );
  }

  const src = join(templatesDir, template);

  step("Create", `from template '${template}'`);

  for await (const entry of Deno.readDir(src)) {
    if (entry.name === "node_modules") continue;
    const srcPath = join(src, entry.name);
    // _deno.json/_package.json stored with underscore to avoid workspace conflicts
    const destName = entry.name === "_deno.json" ? "deno.json" : entry.name;
    const destPath = join(targetDir, destName);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }

  try {
    await Deno.copyFile(
      join(targetDir, ".env.example"),
      join(targetDir, ".env"),
    );
  } catch { /* no .env.example in template */ }

  step("Done", targetDir);
  return targetDir;
}
