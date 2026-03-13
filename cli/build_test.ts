// Copyright 2025 the AAI authors. MIT license.
// import { assert } from "@std/assert";
// import { dirname, fromFileUrl, join } from "@std/path";
// import { runBuild } from "./build.ts";

// const CLI_DIR = dirname(fromFileUrl(import.meta.url));
// const TEMPLATES_DIR = join(CLI_DIR, "templates");

// TODO: Re-enable after @aai/sdk/worker-entry is published to JSR/npm.
// Vite can't resolve the new export path until the package is live.
//
// Deno.test(
//   { name: "runBuild", sanitizeOps: false, sanitizeResources: false },
//   async (t) => {
//     await t.step("validates and bundles agent from agentDir", async () => {
//       const tmpDir = await Deno.makeTempDir({ prefix: "aai-build-test-" });
//       const templateDir = join(TEMPLATES_DIR, "simple");
//
//       // Copy template files (includes package.json and .npmrc)
//       for await (const entry of Deno.readDir(templateDir)) {
//         if (entry.name === "node_modules") continue;
//         await Deno.copyFile(
//           join(templateDir, entry.name),
//           join(tmpDir, entry.name),
//         );
//       }
//
//       // Install dependencies from the template's package.json
//       const cmd = new Deno.Command("npm", {
//         args: ["install"],
//         cwd: tmpDir,
//         stdout: "null",
//         stderr: "null",
//       });
//       const { code } = await cmd.output();
//       assert(code === 0, "npm install failed");
//
//       const result = await runBuild({ agentDir: tmpDir });
//
//       assert(result.bundle.worker.length > 0);
//       assert(result.bundle.manifest.length > 0);
//
//       const manifest = JSON.parse(result.bundle.manifest);
//       assert(manifest.transport !== undefined);
//
//       // Verify .aai/build/ output was written
//       const workerJs = await Deno.readTextFile(
//         join(tmpDir, ".aai", "build", "worker.js"),
//       );
//       assert(workerJs.length > 0, ".aai/build/worker.js should exist");
//
//       const manifestJson = await Deno.readTextFile(
//         join(tmpDir, ".aai", "build", "manifest.json"),
//       );
//       assert(manifestJson.length > 0, ".aai/build/manifest.json should exist");
//
//       await Deno.remove(tmpDir, { recursive: true });
//     });
//   },
// );
