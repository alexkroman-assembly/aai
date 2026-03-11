import { snapshotTest } from "@cliffy/testing";

await snapshotTest({
  name: "cli help and version output",
  meta: import.meta,
  denoArgs: ["--allow-env", "--allow-read"],
  colors: false,
  steps: {
    help: { args: ["--help"] },
    version: { args: ["--version"] },
    newHelp: { args: ["new", "--help"] },
    devHelp: { args: ["dev", "--help"] },
    deployHelp: { args: ["deploy", "--help"] },
    buildHelp: { args: ["build", "--help"] },
    typesHelp: { args: ["types", "--help"] },
  },
  async fn() {
    const { cli } = await import("./cli.ts");
    await cli.parse(Deno.args);
  },
});
