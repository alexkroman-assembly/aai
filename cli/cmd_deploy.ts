import { parseArgs } from "@std/cli/parse-args";
import { bold, cyan, dim, green } from "@std/fmt/colors";
import { error, step, stepInfo } from "./_output.ts";
import { runBuild } from "./build.ts";
import { runDeploy } from "./deploy.ts";

export async function runDeployCommand(args: string[]): Promise<number> {
  const flags = parseArgs(args, {
    string: ["server"],
    alias: { h: "help", s: "server" },
    boolean: ["help"],
  });

  if (flags.help) {
    console.log(
      `${green(bold("aai deploy"))} — Bundle and deploy to production

${bold("USAGE:")}
  ${cyan("aai deploy")}

${bold("OPTIONS:")}
  ${cyan("-s, --server")} ${
        dim("<url>")
      }    Server URL (default: https://aai-agent.fly.dev)
  ${cyan("-h, --help")}             Show this help message
`,
    );
    return 0;
  }

  const cwd = Deno.env.get("INIT_CWD") || Deno.cwd();
  const { DEFAULT_SERVER } = await import("./_discover.ts");
  const serverUrl = flags.server || DEFAULT_SERVER;

  const { getApiKey, getNamespace, resolveSlug, saveAgentLink, saveNamespace } =
    await import(
      "./_discover.ts"
    );
  const apiKey = await getApiKey();
  const namespace = await getNamespace();

  let result;
  try {
    result = await runBuild({ agentDir: cwd });
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const { agent } = result;
  const slug = await resolveSlug(cwd, namespace, agent.slug);
  const fullPath = `${namespace}/${slug}`;

  step("Deploy", fullPath);
  const deployed = await runDeploy({
    url: serverUrl,
    bundle: result.bundle,
    namespace,
    slug,
    dryRun: false,
    apiKey,
  });

  // Save the resolved namespace (may have been incremented on 403)
  if (deployed.namespace !== namespace) {
    await saveNamespace(deployed.namespace);
  }

  // Save the link between this directory and the namespace/slug
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
    stepInfo("App", `${serverUrl}/${deployedPath}/`);
  }
  if (agent.transport.includes("twilio")) {
    stepInfo("Twilio", `${serverUrl}/${deployedPath}/twilio/voice`);
  }

  stepInfo("Agent", agent.config?.name ?? deployed.slug);
  if (tools.length > 0) {
    stepInfo("Tools", tools.join(", "));
  }

  return 0;
}
