import { log } from "./_output.ts";

export interface Tunnel {
  url: string;
  close(): void;
}

/** Spawn a cloudflared quick-tunnel and return the public URL. */
export async function startTunnel(localPort: number): Promise<Tunnel> {
  const cmd = new Deno.Command("cloudflared", {
    args: ["tunnel", "--url", `http://localhost:${localPort}`],
    stdout: "null",
    stderr: "piped",
  });

  const process = cmd.spawn();

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for cloudflared tunnel URL"));
    }, 30_000);

    const reader = process.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const match = buffer.match(
          /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/,
        );
        if (match) {
          clearTimeout(timeout);
          // Release the reader so stderr can continue flowing (cloudflared logs)
          reader.releaseLock();
          resolve(match[1]);
          return;
        }
      }
      clearTimeout(timeout);
      reject(new Error("cloudflared exited without printing tunnel URL"));
    })();
  });

  log.step("Tunnel", url);

  return {
    url,
    close() {
      try {
        process.kill();
      } catch { /* already dead */ }
    },
  };
}
