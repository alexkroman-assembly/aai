import { info, step, stepInfo, warn } from "./_output.ts";

export interface DeployOpts {
  url: string;
  bundleDir: string;
  slug: string;
  dryRun: boolean;
  apiKey: string;
}

export async function runDeploy(opts: DeployOpts): Promise<void> {
  const dir = `${opts.bundleDir}/${opts.slug}`;

  let manifest: {
    slug: string;
    env: Record<string, string>;
    transport?: string[];
  };
  let worker: string;
  let client: string;
  try {
    manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    worker = await Deno.readTextFile(`${dir}/worker.js`);
    client = await Deno.readTextFile(`${dir}/client.js`);
  } catch (cause) {
    throw new Error(
      `no bundle found for ${opts.slug} in ${opts.bundleDir}/ -- run "aai build" first`,
      { cause },
    );
  }

  if (opts.dryRun) {
    stepInfo("Dry run", "would deploy:");
    info(`${opts.slug} -> ${opts.url}/${opts.slug}/`);
    return;
  }

  const resp = await fetch(`${opts.url}/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      slug: manifest.slug,
      env: manifest.env,
      worker,
      client,
      transport: manifest.transport,
    }),
  });

  if (resp.ok) {
    const transport = manifest.transport ?? ["websocket"];
    const urls: string[] = [];
    if (transport.includes("websocket")) {
      urls.push(`${opts.url}/${opts.slug}/`);
    }
    if (transport.includes("twilio")) {
      urls.push(`${opts.url}/twilio/${opts.slug}/voice`);
    }
    step("Deploy", `${opts.slug} -> ${urls[0] ?? opts.url}`);
    for (const url of urls.slice(1)) {
      info(url);
    }

    // Health check: best-effort verification
    try {
      const healthResp = await fetch(`${opts.url}/${opts.slug}/health`);
      const ok = healthResp.ok &&
        (await healthResp.json()).status === "ok";
      if (ok) {
        step("Ready", opts.slug);
      } else {
        warn(
          `${opts.slug} deployed but health check failed -- check for runtime errors`,
        );
      }
    } catch {
      // Health check is best-effort
    }
  } else {
    const text = await resp.text();
    throw new Error(`deploy failed (${resp.status}): ${text}`);
  }
}
