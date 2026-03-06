import { join } from "@std/path";
import { step } from "./_output.ts";

const TYPES_TEMPLATE = new URL("./types.template", import.meta.url);

function buildDenoJson(dir: string): string {
  // deno-lint-ignore no-explicit-any
  const config: Record<string, any> = {
    compilerOptions: {
      jsx: "react-jsx",
      jsxImportSource: "preact",
    },
  };
  try {
    const pkgRaw = Deno.readTextFileSync(join(dir, "package.json"));
    const pkg = JSON.parse(pkgRaw);
    const deps = pkg.dependencies ?? {};
    if (Object.keys(deps).length > 0) {
      config.nodeModulesDir = "auto";
      config.imports = {};
      for (const name of Object.keys(deps)) {
        config.imports[name] = `npm:${name}`;
      }
    }
  } catch { /* no package.json */ }
  return JSON.stringify(config, null, 2) + "\n";
}

/** Write types.d.ts (and deno.json if missing) to the given directory. */
export async function generateTypes(dir: string): Promise<string> {
  const dest = join(dir, "types.d.ts");
  const content = await Deno.readTextFile(TYPES_TEMPLATE);
  await Deno.writeTextFile(dest, content);

  const denoJsonPath = join(dir, "deno.json");
  const tsconfigPath = join(dir, "tsconfig.json");
  let hasConfig = false;
  try {
    await Deno.stat(denoJsonPath);
    hasConfig = true;
  } catch { /* missing */ }
  if (!hasConfig) {
    try {
      await Deno.stat(tsconfigPath);
      hasConfig = true;
    } catch { /* missing */ }
  }
  if (!hasConfig) {
    await Deno.writeTextFile(denoJsonPath, buildDenoJson(dir));
  }

  return dest;
}

/** CLI handler for `aai types`. */
export async function runTypes(dir: string): Promise<void> {
  const dest = await generateTypes(dir);
  step("Generated", dest);
}
