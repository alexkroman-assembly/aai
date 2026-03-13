// Copyright 2025 the AAI authors. MIT license.
import { bold, brightBlue, brightMagenta, dim } from "@std/fmt/colors";

/** Definition of a CLI option flag for help text rendering. */
export interface OptionDef {
  /** Flag syntax string (e.g. `"-s, --server <url>"`). */
  flags: string;
  /** Human-readable description of the option. */
  description: string;
  /** If `true`, the option is omitted from help output. */
  hidden?: boolean;
}

/** Definition of a CLI subcommand used to generate help text. */
export interface SubcommandDef {
  /** Subcommand name (e.g. `"new"`, `"deploy"`). */
  name: string;
  /** Short description shown in help output. */
  description: string;
  /** Positional arguments accepted by the subcommand. */
  args?: { name: string; optional?: boolean }[];
  /** Option flags accepted by the subcommand. */
  options?: OptionDef[];
}

/**
 * Generates the top-level `aai --help` output with ASCII logo, available
 * commands, global options, and a getting-started example.
 *
 * @param version The current CLI version string.
 * @returns Formatted, colorized help text.
 */
export function rootHelp(version: string): string {
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
    ["env", "<cmd>", "Manage environment variables"],
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

/**
 * Generates help text for a specific subcommand, listing its arguments,
 * options, and descriptions.
 *
 * @param cmd The subcommand definition to render help for.
 * @param version The current CLI version string.
 * @returns Formatted, colorized help text.
 */
export function subcommandHelp(
  cmd: SubcommandDef,
  version: string,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${brightMagenta(bold("aai"))} ${brightBlue(bold(cmd.name))}${
      version ? dim(`  v${version}`) : ""
    }`,
  );
  lines.push(`  ${dim(cmd.description)}`);
  lines.push("");

  if (cmd.args && cmd.args.length > 0) {
    lines.push(`  ${bold(brightBlue("Arguments"))}`);
    lines.push("");
    for (const arg of cmd.args) {
      const label = arg.optional
        ? brightMagenta(`[${arg.name}]`)
        : brightMagenta(`<${arg.name}>`);
      lines.push(`    ${label}`);
    }
    lines.push("");
  }

  const visibleOptions = (cmd.options ?? []).filter((o) => !o.hidden);
  if (visibleOptions.length > 0) {
    lines.push(`  ${bold(brightBlue("Options"))}`);
    lines.push("");
    for (const opt of visibleOptions) {
      lines.push(`    ${brightBlue(opt.flags)}`);
      lines.push(`      ${dim(opt.description)}`);
    }

    lines.push(`    ${brightBlue("-h")}${dim(",")} ${brightBlue("--help")}`);
    lines.push(`      ${dim("Show this help")}`);
    lines.push("");
  }

  return lines.join("\n");
}
