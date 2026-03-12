#!/usr/bin/env -S deno run --allow-all --unstable-worker-options
/**
 * Scaffolds every template into a temp directory and runs a build
 * to verify type-checking, validation, and bundling all pass.
 */

import { bold, brightMagenta, red } from "@std/fmt/colors";
import { runBuild } from "./build.ts";
import { runNew } from "./_new.ts";
import { dirname, fromFileUrl, join } from "@std/path";

const TEMPLATES_DIR = new URL("../templates", import.meta.url).pathname;

// Discover all templates
const templates: string[] = [];
for await (const entry of Deno.readDir(TEMPLATES_DIR)) {
  if (entry.isDirectory) templates.push(entry.name);
}
templates.sort();

console.log(`Testing ${templates.length} templates...\n`);

const results: { name: string; ok: boolean; error?: string }[] = [];

// Ensure ASSEMBLYAI_API_KEY is set for build
if (!Deno.env.get("ASSEMBLYAI_API_KEY")) {
  Deno.env.set("ASSEMBLYAI_API_KEY", "test");
}

for (const template of templates) {
  const tmpDir = await Deno.makeTempDir({ prefix: `aai-test-${template}-` });

  try {
    // Scaffold the template
    await runNew({
      targetDir: tmpDir,
      template,
      templatesDir: TEMPLATES_DIR,
    });

    // Copy CLAUDE.md
    const cliDir = dirname(fromFileUrl(import.meta.url));
    const srcClaude = join(cliDir, "claude.md");
    await Deno.copyFile(srcClaude, join(tmpDir, "CLAUDE.md"));

    // Write a .env with test key
    await Deno.writeTextFile(
      join(tmpDir, ".env"),
      "ASSEMBLYAI_API_KEY=test\n",
    );

    // Install npm dependencies if package.json exists
    try {
      await Deno.stat(join(tmpDir, "package.json"));
      const npm = new Deno.Command("npm", {
        args: ["install", "--silent"],
        cwd: tmpDir,
      });
      const npmResult = await npm.output();
      if (!npmResult.success) {
        throw new Error("npm install failed");
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    // Build it
    await runBuild({ agentDir: tmpDir });

    console.log(`  ${brightMagenta("✓")} ${template}`);
    results.push({ name: template, ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${red("✗")} ${template}`);
    console.log(`    ${msg}`);
    results.push({ name: template, ok: false, error: msg });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

console.log();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

if (failed === 0) {
  console.log(bold(brightMagenta(`All ${passed} templates passed.`)));
} else {
  console.log(bold(red(`${failed} of ${results.length} templates failed.`)));
  Deno.exit(1);
}
