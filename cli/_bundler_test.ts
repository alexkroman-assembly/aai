import { expect } from "@std/expect";
import { resolve } from "@std/path";
import { _internals, AAI_ROOT } from "./_bundler.ts";

const {
  WORKSPACE_ALIASES,
  bundleError,
  getConfigPath,
  getOutputText,
  jsBytes,
  buildNpmAliases,
} = _internals;

// --- bundleError ---

Deno.test("bundleError: creates error with BundleError name", () => {
  const err = bundleError("something went wrong");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("BundleError");
  expect(err.message).toBe("something went wrong");
});

// --- WORKSPACE_ALIASES ---

Deno.test("WORKSPACE_ALIASES: maps @aai/sdk to sdk/mod.ts", () => {
  expect(WORKSPACE_ALIASES["@aai/sdk"]).toBe(
    resolve(AAI_ROOT, "sdk/mod.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: maps @aai/sdk/types to sdk/types.ts", () => {
  expect(WORKSPACE_ALIASES["@aai/sdk/types"]).toBe(
    resolve(AAI_ROOT, "sdk/types.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: maps @aai/core/protocol to core/_protocol.ts", () => {
  expect(WORKSPACE_ALIASES["@aai/core/protocol"]).toBe(
    resolve(AAI_ROOT, "core/_protocol.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: maps @aai/ui to ui/mod.ts", () => {
  expect(WORKSPACE_ALIASES["@aai/ui"]).toBe(
    resolve(AAI_ROOT, "ui/mod.ts"),
  );
});

Deno.test("WORKSPACE_ALIASES: all values are absolute paths under AAI_ROOT", () => {
  for (const [key, value] of Object.entries(WORKSPACE_ALIASES)) {
    expect(value.startsWith(AAI_ROOT)).toBe(true);
    expect(value).toMatch(/\.ts$/);
    // Key should be an @aai/ specifier
    expect(key.startsWith("@aai/")).toBe(true);
  }
});

// --- getConfigPath ---

Deno.test("getConfigPath: returns root deno.json when it exists", () => {
  const configPath = getConfigPath();
  expect(configPath).toBe(resolve(AAI_ROOT, "deno.json"));
});

// --- getOutputText ---

Deno.test("getOutputText: returns first output file text", () => {
  const result = {
    outputFiles: [{ path: "out.js", text: "console.log('hi')" }],
  };
  expect(getOutputText(result)).toBe("console.log('hi')");
});

Deno.test("getOutputText: returns empty string when no output files", () => {
  expect(getOutputText({})).toBe("");
  expect(getOutputText({ outputFiles: [] })).toBe("");
});

// --- jsBytes ---

Deno.test("jsBytes: returns bytes for .js output", () => {
  const metafile = {
    outputs: {
      "out.js": { bytes: 1234 },
      "out.js.map": { bytes: 5678 },
    },
  };
  expect(jsBytes(metafile)).toBe(1234);
});

Deno.test("jsBytes: returns 0 when no .js output", () => {
  const metafile = { outputs: { "out.css": { bytes: 100 } } };
  expect(jsBytes(metafile)).toBe(0);
});

// --- buildNpmAliases ---

Deno.test("buildNpmAliases: resolves known npm packages", () => {
  const aliases = buildNpmAliases();
  // These packages should exist in node_modules
  expect(aliases["preact"]).toBeDefined();
  expect(aliases["preact"]!.includes("node_modules")).toBe(true);
  expect(aliases["htm"]).toBeDefined();
  expect(aliases["comlink"]).toBeDefined();
});

Deno.test("buildNpmAliases: resolves scoped packages", () => {
  const aliases = buildNpmAliases();
  // @preact/signals is a scoped package
  expect(aliases["@preact/signals"]).toBeDefined();
});

Deno.test("buildNpmAliases: resolves subpath packages", () => {
  const aliases = buildNpmAliases();
  // preact/hooks is a subpath
  expect(aliases["preact/hooks"]).toBeDefined();
});
