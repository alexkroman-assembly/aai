export type KvClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
};

export function createKv(
  ctx: { env: Record<string, string> },
): KvClient {
  const kvUrl = ctx.env.AAI_KV_URL;
  const kvToken = ctx.env.AAI_SCOPE_TOKEN;

  if (!kvUrl || !kvToken) {
    throw new Error(
      "KV storage not available. " +
        "Make sure you are using a server that supports KV storage.",
    );
  }

  async function kvFetch(body: Record<string, unknown>): Promise<unknown> {
    const resp = await fetch(kvUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${kvToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`KV error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    if (data.error) {
      throw new Error(`KV error: ${data.error}`);
    }
    return data.result;
  }

  return {
    async get(key) {
      const result = await kvFetch({ op: "get", key });
      return result as string | null;
    },

    async set(key, value, ttl) {
      await kvFetch({ op: "set", key, value, ttl });
    },

    async del(key) {
      await kvFetch({ op: "del", key });
    },

    async keys(pattern) {
      const result = await kvFetch({ op: "keys", pattern });
      return result as string[];
    },
  };
}
