import { bold, brightBlue, brightMagenta, dim } from "@std/fmt/colors";
// deno-lint-ignore-file no-explicit-any
import type { Command } from "@cliffy/command";

export function rootHelp(this: Command): string {
  const version = this.getVersion();
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${brightMagenta(bold(" ▄▀█ ▄▀█ █"))}   ${
      dim("Voice agent development kit")
    }`,
  );
  lines.push(
    `  ${brightMagenta(bold(" █▀█ █▀█ █"))}   ${brightMagenta(`v${version}`)}`,
  );
  lines.push("");
  lines.push(
    `  ${bold(brightBlue("Usage"))}   ${brightMagenta("aai")} ${
      dim("<command> [options]")
    }`,
  );
  lines.push("");
  lines.push(`  ${bold(brightBlue("Commands"))}`);
  lines.push("");

  const cmds: [string, string, string][] = [
    ["new", "[dir]", "Scaffold a new agent project"],
    ["deploy", "", "Bundle and deploy to production"],
  ];

  for (const [name, args, desc] of cmds) {
    const nameStr = brightBlue(name.padEnd(8));
    const argsStr = args ? brightMagenta(args.padEnd(6)) : "      ";
    lines.push(`    ${nameStr} ${argsStr} ${dim(desc)}`);
  }

  lines.push("");
  lines.push(`  ${bold(brightBlue("Options"))}`);
  lines.push("");
  lines.push(
    `    ${brightBlue("-h")}${dim(",")} ${brightBlue("--help")}      ${
      dim("Show this help")
    }`,
  );
  lines.push(
    `    ${brightBlue("-V")}${dim(",")} ${brightBlue("--version")}   ${
      dim("Show the version number")
    }`,
  );
  lines.push("");
  lines.push(`  ${bold(brightBlue("Getting started"))}`);
  lines.push("");
  lines.push(
    `    ${dim("$")} ${brightMagenta("aai new")} ${brightBlue("my-agent")}    ${
      dim("Create a new agent")
    }`,
  );
  lines.push(`    ${dim("$")} ${brightMagenta("cd my-agent")}`);
  lines.push(
    `    ${dim("$")} ${brightMagenta("aai deploy")}          ${
      dim("Deploy to production")
    }`,
  );
  lines.push("");

  return lines.join("\n");
}

export function subcommandHelp(this: Command): string {
  const name = this.getName();
  const parentCmd = this.getParent() as Command | undefined;
  const parent = parentCmd?.getName() ?? "aai";
  const desc = this.getDescription();
  const version = this.getVersion() || parentCmd?.getVersion();
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${brightMagenta(bold(parent))} ${brightBlue(bold(name))}${
      version ? dim(`  v${version}`) : ""
    }`,
  );
  lines.push(`  ${dim(desc)}`);
  lines.push("");

  const args = this.getArguments();
  if (args.length > 0) {
    lines.push(`  ${bold(brightBlue("Arguments"))}`);
    lines.push("");
    for (const arg of args) {
      // deno-lint-ignore no-explicit-any
      const isOptional = (arg as any).optional ?? (arg as any).optionalValue;
      const label = isOptional
        ? brightMagenta(`[${arg.name}]`)
        : brightMagenta(`<${arg.name}>`);
      lines.push(`    ${label}`);
    }
    lines.push("");
  }

  const options = this.getOptions(false);
  const visibleOptions = options.filter(
    (o) => !o.hidden && o.name !== "help",
  );
  if (visibleOptions.length > 0) {
    lines.push(`  ${bold(brightBlue("Options"))}`);
    lines.push("");
    for (const opt of visibleOptions) {
      const flagList = Array.isArray(opt.flags) ? opt.flags : [opt.flags];
      const flags = flagList
        .map((f: string) => brightBlue(f.trim()))
        .join(dim(", "));

      let hint = "";
      if (opt.default !== undefined) {
        hint = dim(` (default: ${brightMagenta(JSON.stringify(opt.default))})`);
      } else if (opt.required) {
        hint = dim(` (required)`);
      }

      lines.push(`    ${flags}${hint}`);
      lines.push(`      ${dim(opt.description)}`);
    }

    lines.push(`    ${brightBlue("-h")}${dim(",")} ${brightBlue("--help")}`);
    lines.push(`      ${dim("Show this help")}`);
    lines.push("");
  }

  return lines.join("\n");
}
