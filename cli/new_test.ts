import { expect } from "@std/expect";
import { join } from "@std/path";
import { listTemplates, runNew } from "./_new.ts";
import { silenceSteps, withTempDir } from "./_test_utils.ts";

async function createFakeTemplates(dir: string): Promise<string> {
  const templatesDir = join(dir, "templates");

  // simple template
  const simple = join(templatesDir, "simple");
  await Deno.mkdir(simple, { recursive: true });
  await Deno.writeTextFile(
    join(simple, "agent.ts"),
    'export default defineAgent({\n  name: "Default Name",\n});',
  );
  await Deno.writeTextFile(join(simple, "readme.txt"), "hello");

  // template with subdirectory
  const advanced = join(templatesDir, "advanced");
  const sub = join(advanced, "tools");
  await Deno.mkdir(sub, { recursive: true });
  await Deno.writeTextFile(
    join(advanced, "agent.ts"),
    'export default defineAgent({ name: "Advanced" });',
  );
  await Deno.writeTextFile(join(sub, "helper.ts"), "// helper");

  // template with excluded dirs
  await Deno.mkdir(join(simple, "node_modules"), { recursive: true });
  await Deno.writeTextFile(
    join(simple, "node_modules", "pkg.js"),
    "// should be skipped",
  );
  await Deno.writeTextFile(join(simple, "_deno.json"), "{}");

  // template with .env.example
  const withEnv = join(templatesDir, "with-env");
  await Deno.mkdir(withEnv, { recursive: true });
  await Deno.writeTextFile(
    join(withEnv, "agent.ts"),
    'export default defineAgent({ name: "Env Agent" });',
  );
  await Deno.writeTextFile(join(withEnv, ".env.example"), "MY_KEY=");

  return templatesDir;
}

// --- listTemplates ---

Deno.test("listTemplates returns sorted directory names", async () => {
  await withTempDir(async (dir) => {
    const templatesDir = await createFakeTemplates(dir);
    const result = await listTemplates(templatesDir);
    expect(result).toEqual(["advanced", "simple", "with-env"]);
  });
});

Deno.test("listTemplates returns empty for empty dir", async () => {
  await withTempDir(async (dir) => {
    const result = await listTemplates(dir);
    expect(result).toEqual([]);
  });
});

// --- runNew ---

Deno.test("runNew copies template files to target", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      await runNew({
        targetDir: target,
        template: "simple",
        templatesDir,
      });

      const agent = await Deno.readTextFile(join(target, "agent.ts"));
      expect(agent).toContain("Default Name");

      const readme = await Deno.readTextFile(join(target, "readme.txt"));
      expect(readme).toBe("hello");
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew skips node_modules and _deno.json", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      await runNew({
        targetDir: target,
        template: "simple",
        templatesDir,
      });

      let hasNodeModules = false;
      try {
        await Deno.stat(join(target, "node_modules"));
        hasNodeModules = true;
      } catch { /* expected */ }
      expect(hasNodeModules).toBe(false);

      let hasDenoJson = false;
      try {
        await Deno.stat(join(target, "_deno.json"));
        hasDenoJson = true;
      } catch { /* expected */ }
      expect(hasDenoJson).toBe(false);
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew replaces name in agent.ts", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      await runNew({
        targetDir: target,
        template: "simple",
        templatesDir,
        name: "Custom Bot",
      });

      const agent = await Deno.readTextFile(join(target, "agent.ts"));
      expect(agent).toContain('"Custom Bot"');
      expect(agent).not.toContain("Default Name");
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew escapes special characters in name", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      await runNew({
        targetDir: target,
        template: "simple",
        templatesDir,
        name: 'He said "hello"',
      });

      const agent = await Deno.readTextFile(join(target, "agent.ts"));
      expect(agent).toContain('He said \\"hello\\"');
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew copies subdirectories recursively", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      await runNew({
        targetDir: target,
        template: "advanced",
        templatesDir,
      });

      const helper = await Deno.readTextFile(
        join(target, "tools", "helper.ts"),
      );
      expect(helper).toBe("// helper");
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew copies .env.example to .env", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      await runNew({
        targetDir: target,
        template: "with-env",
        templatesDir,
      });

      const env = await Deno.readTextFile(join(target, ".env"));
      expect(env).toBe("MY_KEY=");
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew throws for unknown template", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      let threw = false;
      try {
        await runNew({
          targetDir: target,
          template: "nonexistent",
          templatesDir,
        });
      } catch (err) {
        threw = true;
        expect((err as Error).message).toContain("unknown template");
        expect((err as Error).message).toContain("nonexistent");
      }
      expect(threw).toBe(true);
    });
  } finally {
    s.restore();
  }
});
