import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";

// Deno-style right-aligned action prefix width
const PAD = 9;

function fmt(
  action: string,
  color: (s: string) => string,
  msg: string,
): string {
  return `${color(bold(action.padStart(PAD)))} ${msg}`;
}

export function step(action: string, msg: string): void {
  console.log(fmt(action, green, msg));
}

export function stepInfo(action: string, msg: string): void {
  console.log(fmt(action, cyan, msg));
}

export function info(msg: string): void {
  console.log(dim(`${" ".repeat(PAD + 1)}${msg}`));
}

export function warn(msg: string): void {
  console.error(fmt("warning", yellow, msg));
}

export function error(msg: string): void {
  console.error(`${red(bold("error"))}: ${msg}`);
}
