import { Command } from "@cliffy/command";
import { step, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import { runDeploy } from "./deploy.ts";
import {
  DEFAULT_SERVER,
  getApiKey,
  getNamespace,
  resolveSlug,
  saveAgentLink,
  saveNamespace,
} from "./_discover.ts";

export const deployCommand: Command = new Command()
  .description("Bundle and deploy to production")
  .option("-s, --server <url:string>", "Server URL")
  .option("--local [url:string]", "Use local server", { hidden: true })
  .option("--dry-run", "Validate and bundle without deploying")
  .action(async ({ server, local, dryRun }) => {
    const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
    const serverUrl = local !== undefined
      ? (typeof local === "string" ? local : "http://localhost:3100")
      : (server || DEFAULT_SERVER);

    const apiKey = await getApiKey();
    const namespace = await getNamespace();
    const result = await runBuild({ agentDir: cwd });

    const { agent } = result;
    const slug = await resolveSlug(cwd, namespace, agent.slug);
    const fullPath = `${namespace}/${slug}`;

    step("Deploy", fullPath);
    const deployed = await runDeploy({
      url: serverUrl,
      bundle: result.bundle,
      namespace,
      slug,
      dryRun: dryRun ?? false,
      apiKey,
    });

    if (deployed.namespace !== namespace) {
      await saveNamespace(deployed.namespace);
    }

    await saveAgentLink(cwd, {
      namespace: deployed.namespace,
      slug: deployed.slug,
      apiKey,
    });

    const tools = [
      ...(agent.config?.builtinTools ?? []),
      ...(agent.toolSchemas ?? []).map((t) => t.name),
    ];

    const deployedPath = `${deployed.namespace}/${deployed.slug}`;
    if (agent.transport.includes("websocket")) {
      stepInfo("App", `${serverUrl}/${deployedPath}`);
    }
    if (agent.transport.includes("twilio")) {
      stepInfo("Twilio", `${serverUrl}/${deployedPath}/voice`);
    }

    stepInfo("Agent", agent.config?.name ?? deployed.slug);
    if (tools.length > 0) {
      stepInfo("Tools", tools.join(", "));
    }
  }) as unknown as Command;
