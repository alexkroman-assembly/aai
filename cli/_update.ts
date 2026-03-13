// Copyright 2025 the AAI authors. MIT license.
import { deadline } from "@std/async/deadline";
import { bold, brightBlue, dim, yellow } from "@std/fmt/colors";
import { error as logError, info, step } from "./_output.ts";
import { greaterThan, parse } from "@std/semver";

const REPO = "alexkroman/aai";
const VERSION_URL =
  `https://github.com/${REPO}/releases/download/latest/VERSION`;
const CHECK_TIMEOUT_MS = 3000;

function detectTarget(): string {
  const os = Deno.build.os === "darwin" ? "darwin" : "linux";
  const arch = Deno.build.arch === "aarch64" ? "arm64" : "x64";
  return `aai-${os}-${arch}`;
}

async function checkForUpdate(
  currentVersion: string,
): Promise<string | null> {
  try {
    const resp = await deadline(fetch(VERSION_URL), CHECK_TIMEOUT_MS);
    if (!resp.ok) return null;
    const remote = (await resp.text()).trim();
    if (greaterThan(parse(remote), parse(currentVersion))) return remote;
    return null;
  } catch {
    return null;
  }
}

async function doUpgrade(newVersion: string): Promise<boolean> {
  const target = detectTarget();
  const url =
    `https://github.com/${REPO}/releases/download/latest/${target}.tar.gz`;

  step("Download", `aai ${newVersion}`);

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      logError(`Download failed: ${resp.status} ${resp.statusText}`);
      return false;
    }

    const tmp = await Deno.makeTempDir();
    const tarPath = `${tmp}/${target}.tar.gz`;
    const file = await Deno.open(tarPath, { write: true, create: true });
    await resp.body!.pipeTo(file.writable);

    const tar = new Deno.Command("tar", {
      args: ["xzf", tarPath, "-C", tmp],
    });
    const tarResult = await tar.output();
    if (!tarResult.success) {
      logError("Failed to extract archive");
      return false;
    }

    // Find current binary path
    const installDir = Deno.env.get("AAI_INSTALL_DIR") ||
      `${Deno.env.get("HOME")}/.aai/bin`;
    const binPath = `${installDir}/aai`;

    await Deno.copyFile(`${tmp}/aai`, binPath);
    await Deno.chmod(binPath, 0o755);
    await Deno.remove(tmp, { recursive: true });

    step("Updated", `aai to ${newVersion}`);
    return true;
  } catch (err) {
    logError(`Upgrade failed: ${err}`);
    return false;
  }
}

/**
 * Checks for a newer CLI release on GitHub and, if one is found, prompts the
 * user to upgrade in place. Downloads and replaces the current binary if the
 * user confirms. Exits the process after a successful upgrade.
 *
 * @param currentVersion The currently running CLI version (semver string).
 */
export async function promptUpgradeIfAvailable(
  currentVersion: string,
): Promise<void> {
  const newVersion = await checkForUpdate(currentVersion);
  if (!newVersion) return;

  console.log(
    `\n${yellow("Update available:")} ${dim(currentVersion)} → ${
      bold(brightBlue(newVersion))
    }`,
  );
  const confirmed = confirm("Upgrade now?");
  if (!confirmed) {
    info(dim(`Run aai again to upgrade later.`));
    return;
  }

  const ok = await doUpgrade(newVersion);
  if (ok) {
    info("Restart aai to use the new version.");
    Deno.exit(0);
  }
}
