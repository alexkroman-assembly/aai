import { bold, cyan, dim, yellow } from "@std/fmt/colors";

const REPO = "alexkroman/aai";
const VERSION_URL =
  `https://github.com/${REPO}/releases/download/latest/VERSION`;
const CHECK_TIMEOUT_MS = 3000;

function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split(".").map(Number);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

function detectTarget(): string {
  const os = Deno.build.os === "darwin" ? "darwin" : "linux";
  const arch = Deno.build.arch === "aarch64" ? "arm64" : "x64";
  return `aai-${os}-${arch}`;
}

/** Check GitHub for a newer release. Returns the new version or null. */
export async function checkForUpdate(
  currentVersion: string,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const resp = await fetch(VERSION_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const remote = (await resp.text()).trim();
    return isNewer(remote, currentVersion) ? remote : null;
  } catch {
    return null;
  }
}

/** Download and replace the current binary with the latest release. */
async function doUpgrade(newVersion: string): Promise<boolean> {
  const target = detectTarget();
  const url =
    `https://github.com/${REPO}/releases/download/v${newVersion}/${target}.tar.gz`;

  console.log(`Downloading aai v${newVersion}...`);

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`Download failed: ${resp.status} ${resp.statusText}`);
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
      console.error("Failed to extract archive");
      return false;
    }

    // Find current binary path
    const installDir = Deno.env.get("AAI_INSTALL_DIR") ||
      `${Deno.env.get("HOME")}/.aai/bin`;
    const binPath = `${installDir}/aai`;

    await Deno.copyFile(`${tmp}/aai`, binPath);
    await Deno.chmod(binPath, 0o755);
    await Deno.remove(tmp, { recursive: true });

    console.log(`Updated aai to v${newVersion}`);
    return true;
  } catch (err) {
    console.error(`Upgrade failed: ${err}`);
    return false;
  }
}

/** Check for updates and prompt the user to upgrade if available. */
export async function promptUpgradeIfAvailable(
  currentVersion: string,
): Promise<void> {
  const newVersion = await checkForUpdate(currentVersion);
  if (!newVersion) return;

  console.log(
    `\n${yellow("Update available:")} ${dim(currentVersion)} → ${
      bold(cyan(newVersion))
    }`,
  );
  const answer = prompt("Upgrade now? (Y/n)");
  if (answer !== null && answer !== "" && answer.toLowerCase() !== "y") {
    console.log(dim(`Run aai again to upgrade later.\n`));
    return;
  }

  const ok = await doUpgrade(newVersion);
  if (ok) {
    console.log("Restart aai to use the new version.\n");
    Deno.exit(0);
  }
}
