import { expect } from "@std/expect";
import { main } from "./cli.ts";

const denoConfig = await import("../deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

function withConsoleSpy(
  fn: (logged: string[]) => void | Promise<void>,
) {
  return async () => {
    const logged: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: string[]) => logged.push(args.join(" "));
    console.error = () => {};
    try {
      await fn(logged);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  };
}

Deno.test("cli main", async (t) => {
  await t.step(
    "prints version with --version",
    withConsoleSpy(async (logged) => {
      expect(await main(["--version"])).toBe(0);
      expect(logged).toEqual([VERSION]);
    }),
  );

  await t.step(
    "prints usage with --help",
    withConsoleSpy(async (logged) => {
      expect(await main(["--help"])).toBe(0);
      expect(logged[0]).toContain("dev");
      expect(logged[0]).toContain("build");
      expect(logged[0]).toContain("deploy");
    }),
  );

  await t.step(
    "prints usage with no args",
    withConsoleSpy(async (logged) => {
      expect(await main([])).toBe(0);
      expect(logged[0]).toContain("aai");
    }),
  );

  await t.step(
    "prints command help with dev --help",
    withConsoleSpy(async (logged) => {
      expect(await main(["dev", "--help"])).toBe(0);
      expect(logged[0]).toContain("--port");
      expect(logged[0]).toContain("<number>");
    }),
  );

  await t.step(
    "prints command help with build --help",
    withConsoleSpy(async (logged) => {
      expect(await main(["build", "--help"])).toBe(0);
      expect(logged[0]).toContain("--out-dir");
      expect(logged[0]).toContain("<dir>");
    }),
  );

  await t.step(
    "prints command help with deploy --help",
    withConsoleSpy(async (logged) => {
      expect(await main(["deploy", "--help"])).toBe(0);
      expect(logged[0]).toContain("--url");
      expect(logged[0]).toContain("--dry-run");
    }),
  );

  await t.step(
    "returns 1 for unknown command",
    withConsoleSpy(async () => {
      expect(await main(["unknown-command"])).toBe(1);
    }),
  );
});
