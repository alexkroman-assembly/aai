// Copyright 2025 the AAI authors. MIT license.
import { copy } from "@std/fs/copy";
import { exists } from "@std/fs/exists";
import { walk } from "@std/fs/walk";
import { basename, dirname, join, relative, resolve } from "@std/path";
import { step } from "./_output.ts";

export const _internals = {
  step,
};

export type NewOptions = {
  targetDir: string;
  template: string;
  templatesDir: string;
};

export async function listTemplates(dir: string): Promise<string[]> {
  const templates: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory && !entry.name.startsWith("_")) {
      templates.push(entry.name);
    }
  }
  return templates.sort();
}

/**
 * Copy all files from `src` into `dest`, skipping files that already exist
 * in `dest` so that template-specific files take precedence over shared ones.
 */
async function copyDirNoOverwrite(src: string, dest: string): Promise<void> {
  for await (const entry of walk(src, { includeDirs: false })) {
    const destPath = join(dest, relative(src, entry.path));
    if (!await exists(destPath)) {
      await Deno.mkdir(dirname(destPath), { recursive: true });
      await Deno.copyFile(entry.path, destPath);
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

  _internals.step("Create", `from template '${template}'`);

  // 1. Copy template-specific files first
  await copy(join(templatesDir, template), targetDir, { overwrite: true });

  // 2. Layer shared files underneath (don't overwrite template files)
  await copyDirNoOverwrite(join(templatesDir, "_shared"), targetDir);

  try {
    await Deno.copyFile(
      join(targetDir, ".env.example"),
      join(targetDir, ".env"),
    );
  } catch { /* no .env.example in template */ }

  // Generate README.md with getting-started instructions
  const slug = basename(resolve(targetDir));
  const readme = `# ${slug}

A voice agent built with [aai](https://github.com/anthropics/aai).

## Getting started

\`\`\`sh
deno install       # Install dependencies
deno task dev      # Run locally (opens browser)
deno task deploy   # Deploy to production
\`\`\`

## Environment variables

Secrets are managed on the server, not in local files:

\`\`\`sh
aai env add MY_KEY # Set a secret (prompts for value)
aai env ls         # List secret names
aai env pull       # Pull names into .env for reference
aai env rm MY_KEY  # Remove a secret
\`\`\`

Access secrets in your agent via \`ctx.env.MY_KEY\`.

## Learn more

See \`CLAUDE.md\` for the full agent API reference.
`;
  await Deno.writeTextFile(join(targetDir, "README.md"), readme);

  _internals.step("Done", targetDir);
  return targetDir;
}
