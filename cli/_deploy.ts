import { info, step, stepInfo, warn } from "./_output.ts";
import type { BundleOutput } from "./_bundler.ts";
import { incrementName } from "./_discover.ts";

export const _internals = {
  fetch: globalThis.fetch.bind(globalThis),
};

export type DeployOpts = {
  url: string;
  bundle: BundleOutput;
  namespace: string;
  slug: string;
  dryRun: boolean;
  apiKey: string;
};

export type DeployResult = {
  namespace: string;
  slug: string;
};

async function attemptDeploy(
  url: string,
  namespace: string,
  slug: string,
  apiKey: string,
  manifest: Record<string, unknown>,
  worker: string,
  client: string,
): Promise<Response> {
  const fullPath = `${namespace}/${slug}`;
  return await _internals.fetch(`${url}/${fullPath}/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      env: manifest.env,
      worker,
      client,
      transport: manifest.transport,
    }),
  });
}

const MAX_RETRIES = 20;

export async function runDeploy(
  opts: DeployOpts,
): Promise<DeployResult> {
  const manifest = JSON.parse(opts.bundle.manifest);
  const worker = opts.bundle.worker;
  const client = opts.bundle.client;

  let namespace = opts.namespace;
  const slug = opts.slug;

  if (opts.dryRun) {
    const fullPath = `${namespace}/${slug}`;
    stepInfo("Dry run", "would deploy:");
    info(`${fullPath} -> ${opts.url}/${fullPath}`);
    return { namespace, slug };
  }

  // Try deploying, auto-incrementing namespace on 403
  for (let i = 0; i < MAX_RETRIES; i++) {
    const resp = await attemptDeploy(
      opts.url,
      namespace,
      slug,
      opts.apiKey,
      manifest,
      worker,
      client,
    );

    if (resp.ok) {
      const fullPath = `${namespace}/${slug}`;
      const transport = manifest.transport ?? ["websocket"];
      const urls: string[] = [];
      if (transport.includes("websocket")) {
        urls.push(`${opts.url}/${fullPath}`);
      }
      if (transport.includes("twilio")) {
        urls.push(`${opts.url}/${fullPath}/twilio/voice`);
      }
      step("Deploy", `${fullPath} -> ${urls[0] ?? opts.url}`);
      for (const url of urls.slice(1)) {
        info(url);
      }

      // Health check: best-effort verification
      try {
        const healthResp = await _internals.fetch(
          `${opts.url}/${fullPath}/health`,
        );
        const ok = healthResp.ok &&
          (await healthResp.json()).status === "ok";
        if (ok) {
          step("Ready", fullPath);
        } else {
          warn(
            `${fullPath} deployed but health check failed -- check for runtime errors`,
          );
        }
      } catch {
        // Health check is best-effort
      }

      return { namespace, slug };
    }

    if (resp.status === 403) {
      const text = await resp.text();
      // Namespace conflict — increment and retry
      if (text.includes("Namespace")) {
        const next = incrementName(namespace);
        step("Retry", `namespace "${namespace}" taken, trying "${next}"`);
        namespace = next;
        continue;
      }
    }

    const text = await resp.text();
    throw new Error(`deploy failed (${resp.status}): ${text}`);
  }

  throw new Error(
    `deploy failed: could not find available namespace after ${MAX_RETRIES} attempts`,
  );
}
