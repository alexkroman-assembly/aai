#!/usr/bin/env -S deno run --allow-all --unstable-worker-options
/**
 * Scaffolds every template into a temp directory and runs `aai --dry-run`
 * to verify type-checking, validation, and bundling all pass.
 */

import { bold, green, red } from "@std/fmt/colors";

const CLI_ENTRY = new URL("./cli.ts", import.meta.url).pathname;
const TEMPLATES_DIR = new URL("../templates", import.meta.url).pathname;

// Discover all templates
const templates: string[] = [];
for await (const entry of Deno.readDir(TEMPLATES_DIR)) {
  if (entry.isDirectory) templates.push(entry.name);
}
templates.sort();

console.log(`Testing ${templates.length} templates...\n`);

const results: { name: string; ok: boolean; error?: string }[] = [];

for (const template of templates) {
  const tmpDir = await Deno.makeTempDir({ prefix: `aai-test-${template}-` });

  try {
    // Scaffold the template
    const scaffold = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        "--unstable-worker-options",
        CLI_ENTRY,
        "--yes",
        "--template",
        template,
        "--dry-run",
      ],
      env: {
        ...Object.fromEntries(
          Object.entries(Deno.env.toObject()),
        ),
        INIT_CWD: tmpDir,
        ASSEMBLYAI_API_KEY: "dry-run",
      },
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stdout, stderr } = await scaffold.output();
    const out = new TextDecoder().decode(stdout);
    const err = new TextDecoder().decode(stderr);

    if (success) {
      console.log(`  ${green("✓")} ${template}`);
      results.push({ name: template, ok: true });
    } else {
      console.log(`  ${red("✗")} ${template}`);
      const output = (err + "\n" + out).trim();
      if (output) {
        for (const line of output.split("\n")) {
          console.log(`    ${line}`);
        }
      }
      results.push({ name: template, ok: false, error: output });
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

console.log();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

if (failed === 0) {
  console.log(bold(green(`All ${passed} templates passed.`)));
} else {
  console.log(bold(red(`${failed} of ${results.length} templates failed.`)));
  Deno.exit(1);
}
