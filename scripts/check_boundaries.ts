/**
 * Verify that cli/, server/, and ui/ do not import from each other.
 * Only sdk/ is allowed as a cross-package dependency.
 *
 * Catches both relative imports (../server/) and workspace imports (@aai/server).
 * Skips test files for workspace imports (test utils may share helpers).
 * Skips string literals (template code written to shim files).
 */

const RULES: { dirs: string[]; forbidden: RegExp; skipTests: boolean }[] = [
  // No relative cross-imports
  { dirs: ["cli", "ui"], forbidden: /from\s+["']\.\.\/server\//, skipTests: false },
  { dirs: ["server", "ui"], forbidden: /from\s+["']\.\.\/cli\//, skipTests: false },
  { dirs: ["cli", "server"], forbidden: /from\s+["']\.\.\/ui\//, skipTests: false },
  // No workspace cross-imports (except in test files)
  { dirs: ["cli", "ui"], forbidden: /^import\b.*from\s+["']@aai\/server/, skipTests: true },
  { dirs: ["server", "ui"], forbidden: /^import\b.*from\s+["']@aai\/cli/, skipTests: true },
  { dirs: ["cli", "server"], forbidden: /^import\b.*from\s+["']@aai\/ui/, skipTests: true },
];

let violations = 0;

for (const rule of RULES) {
  for (const dir of rule.dirs) {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (rule.skipTests && (entry.name.includes("_test") || entry.name.startsWith("_test"))) continue;

      const path = `${dir}/${entry.name}`;
      const content = await Deno.readTextFile(path);
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (rule.forbidden.test(line)) {
          console.error(`${path}:${i + 1}: ${line.trim()}`);
          violations++;
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(`\nFound ${violations} import boundary violation(s).`);
  console.error("cli/, server/, and ui/ may only import from sdk/.");
  Deno.exit(1);
} else {
  console.log("Import boundaries OK");
}
