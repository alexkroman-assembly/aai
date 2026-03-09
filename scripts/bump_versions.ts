/**
 * Auto-bump patch versions for packages with staged changes.
 *
 * Reads workspace members from the root deno.json, so any new package added
 * to the workspace is automatically included.
 *
 * Compares staged files against the last commit to determine which packages
 * changed, then bumps their patch version in deno.json. Dependents are also
 * bumped when their dependencies change:
 *
 *   sdk/  → cli, server, ui, core
 *   core/ → cli, server, ui
 *
 * The bumped deno.json files are automatically staged so they're included
 * in the commit.
 *
 * Usage: deno run --allow-read --allow-write --allow-run scripts/bump_versions.ts
 */

const rootConfig = JSON.parse(await Deno.readTextFile("deno.json"));
const PACKAGES: string[] = rootConfig.workspace;

// When a package changes, these dependents must also be bumped.
// Based on the dependency graph: cli/, server/, ui/ depend on sdk/ and core/.
const DEPENDENTS: Record<string, string[]> = {
  sdk: ["cli", "core", "server", "ui"],
  core: ["cli", "server", "ui"],
};

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

async function getStagedFiles(): Promise<string[]> {
  const cmd = new Deno.Command("git", {
    args: ["diff", "--cached", "--name-only"],
    stdout: "piped",
  });
  const { stdout } = await cmd.output();
  return new TextDecoder().decode(stdout).trim().split("\n").filter(Boolean);
}

async function gitAdd(path: string): Promise<void> {
  const cmd = new Deno.Command("git", { args: ["add", path] });
  await cmd.output();
}

// Determine which packages have staged changes (excluding deno.json itself)
const staged = await getStagedFiles();
const directlyChanged = new Set<string>();

// Directories outside workspace packages that should trigger a cli rebuild.
const CLI_EXTRAS = ["templates/"];

for (const file of staged) {
  for (const pkg of PACKAGES) {
    if (file.startsWith(`${pkg}/`) && file !== `${pkg}/deno.json`) {
      directlyChanged.add(pkg);
    }
  }
  for (const prefix of CLI_EXTRAS) {
    if (file.startsWith(prefix)) {
      directlyChanged.add("cli");
    }
  }
}

if (directlyChanged.size === 0) {
  console.log("No package changes detected, skipping version bump.");
  Deno.exit(0);
}

// Expand to include dependents
const toBump = new Set<string>(directlyChanged);
for (const pkg of directlyChanged) {
  const deps = DEPENDENTS[pkg];
  if (deps) {
    for (const dep of deps) {
      toBump.add(dep);
    }
  }
}

for (const pkg of toBump) {
  const configPath = `${pkg}/deno.json`;
  const text = await Deno.readTextFile(configPath);
  const config = JSON.parse(text);

  if (!config.version) {
    console.log(`  ${pkg}: no version field, skipping`);
    continue;
  }

  const oldVersion = config.version;
  const newVersion = bumpPatch(oldVersion);
  config.version = newVersion;

  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");
  await gitAdd(configPath);

  const reason = directlyChanged.has(pkg) ? "changed" : "dependency changed";
  console.log(`  ${pkg}: ${oldVersion} → ${newVersion} (${reason})`);
}
