import { dirname, fromFileUrl, join, resolve } from "@std/path";

/** Root of the aai framework (parent of cli/). */
const AAI_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

/** Spawn a compiled server binary on the given port. */
export function spawnCompiled(
  binaryPath: string,
  port: number,
): Deno.ChildProcess {
  const cmd = new Deno.Command(binaryPath, {
    env: { PORT: String(port) },
    stdout: "inherit",
    stderr: "inherit",
  });
  return cmd.spawn();
}

/** Spawn the orchestrator subprocess on the given port. */
export function spawn(port: number): Deno.ChildProcess {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      "--unstable-worker-options",
      resolve(AAI_ROOT, "server/main.ts"),
    ],
    env: { PORT: String(port) },
    stdout: "inherit",
    stderr: "inherit",
  });
  return cmd.spawn();
}

/** Poll the orchestrator health endpoint until it responds 200. */
export async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const resp = await fetch(`${url}/health`);
      if (resp.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server failed to start");
}

/** POST the bundled agent to a local orchestrator's /deploy endpoint. */
export async function deployToLocal(
  url: string,
  slugDir: string,
  slug: string,
  env: Record<string, string>,
  transport: string[],
): Promise<void> {
  const [worker, client] = await Promise.all([
    Deno.readTextFile(join(slugDir, "worker.js")),
    Deno.readTextFile(join(slugDir, "client.js")),
  ]);

  const resp = await fetch(`${url}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, env, worker, client, transport }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Deploy failed (${resp.status}): ${text}`);
  }
}
