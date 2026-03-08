import { expect } from "@std/expect";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { main } from "./cli.ts";

const denoConfig = await import("./deno.json", { with: { type: "json" } });
const VERSION: string = denoConfig.default.version;

Deno.test("cli --version prints version", async () => {
  const logStub = stub(console, "log");
  const errStub = stub(console, "error");
  try {
    expect(await main(["--version"])).toBe(0);
    assertSpyCalls(logStub, 1);
    expect(logStub.calls[0].args).toEqual([VERSION]);
  } finally {
    logStub.restore();
    errStub.restore();
  }
});

Deno.test("cli --help prints usage", async () => {
  const logStub = stub(console, "log");
  const errStub = stub(console, "error");
  try {
    expect(await main(["--help"])).toBe(0);
    assertSpyCalls(logStub, 1);
    expect(logStub.calls[0].args[0]).toContain("aai");
  } finally {
    logStub.restore();
    errStub.restore();
  }
});
