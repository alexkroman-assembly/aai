// Copyright 2025 the AAI authors. MIT license.
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { listTemplates, runNew } from "./_new.ts";
import { silenceSteps, withTempDir } from "./_test_utils.ts";

async function createFakeTemplates(dir: string): Promise<string> {
  const templatesDir = join(dir, "templates");

  // shared files
  const shared = join(templatesDir, "_shared");
  await Deno.mkdir(shared, { recursive: true });
  await Deno.writeTextFile(join(shared, "shared.txt"), "from shared");
  await Deno.writeTextFile(join(shared, ".env.example"), "MY_KEY=");

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

  await Deno.writeTextFile(join(simple, "deno.json"), "{}");

  // template with .env.example that overrides shared
  const withEnv = join(templatesDir, "with-env");
  await Deno.mkdir(withEnv, { recursive: true });
  await Deno.writeTextFile(
    join(withEnv, "agent.ts"),
    'export default defineAgent({ name: "Env Agent" });',
  );
  await Deno.writeTextFile(join(withEnv, ".env.example"), "CUSTOM_KEY=");

  return templatesDir;
}

// --- listTemplates ---

Deno.test("listTemplates returns sorted directory names excluding shared", async () => {
  await withTempDir(async (dir) => {
    const templatesDir = await createFakeTemplates(dir);
    const result = await listTemplates(templatesDir);
    assertEquals(result, ["advanced", "simple", "with-env"]);
  });
});

Deno.test("listTemplates returns empty for empty dir", async () => {
  await withTempDir(async (dir) => {
    const result = await listTemplates(dir);
    assertEquals(result, []);
  });
});

// --- runNew ---

Deno.test("runNew copies template and shared files to target", async () => {
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
      assertStringIncludes(agent, "Default Name");

      const readme = await Deno.readTextFile(join(target, "readme.txt"));
      assertStrictEquals(readme, "hello");

      // shared file should be present
      const shared = await Deno.readTextFile(join(target, "shared.txt"));
      assertStrictEquals(shared, "from shared");
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew skips node_modules", async () => {
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
      assertStrictEquals(hasNodeModules, false);

      // deno.json should be copied (used for deps + config)
      assert(await exists(join(target, "deno.json")));
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew template files take precedence over shared", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      // with-env has its own .env.example that should NOT be overwritten by shared
      await runNew({
        targetDir: target,
        template: "with-env",
        templatesDir,
      });

      const env = await Deno.readTextFile(join(target, ".env.example"));
      assertStrictEquals(env, "CUSTOM_KEY=");

      // .env should be copied from the template's .env.example
      const dotEnv = await Deno.readTextFile(join(target, ".env"));
      assertStrictEquals(dotEnv, "CUSTOM_KEY=");
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
      assertStrictEquals(helper, "// helper");
    });
  } finally {
    s.restore();
  }
});

Deno.test("runNew copies .env.example to .env from shared", async () => {
  const s = silenceSteps();
  try {
    await withTempDir(async (dir) => {
      const templatesDir = await createFakeTemplates(dir);
      const target = join(dir, "output");

      // simple doesn't have its own .env.example, so shared one is used
      await runNew({
        targetDir: target,
        template: "simple",
        templatesDir,
      });

      assert(await exists(join(target, ".env")));
      const env = await Deno.readTextFile(join(target, ".env"));
      assertStrictEquals(env, "MY_KEY=");
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
        assertStringIncludes((err as Error).message, "unknown template");
        assertStringIncludes((err as Error).message, "nonexistent");
      }
      assertStrictEquals(threw, true);
    });
  } finally {
    s.restore();
  }
});
