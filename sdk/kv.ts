export type KvClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
};

const MAX_VALUE_SIZE = 65_536;

function createMemoryKvClient(): KvClient {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  function isExpired(entry: { expiresAt?: number }): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) {
        if (entry) store.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(entry.value);
    },

    set(key, value, ttl) {
      if (value.length > MAX_VALUE_SIZE) {
        throw new Error(`Value exceeds max size of ${MAX_VALUE_SIZE} bytes`);
      }
      store.set(key, {
        value,
        expiresAt: ttl && ttl > 0 ? Date.now() + ttl * 1000 : undefined,
      });
      return Promise.resolve();
    },

    del(key) {
      store.delete(key);
      return Promise.resolve();
    },

    keys(pattern) {
      const now = Date.now();
      const results: string[] = [];
      for (const [key, entry] of store) {
        if (entry.expiresAt && entry.expiresAt <= now) {
          store.delete(key);
          continue;
        }
        results.push(key);
      }
      if (pattern) {
        const regex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        );
        return Promise.resolve(results.filter((k) => regex.test(k)));
      }
      return Promise.resolve(results);
    },
  };
}

export function createKv(
  ctx: { env: Record<string, string> },
): KvClient {
  const kvUrl = ctx.env.AAI_KV_URL;
  const kvToken = ctx.env.AAI_SCOPE_TOKEN;

  if (!kvUrl || !kvToken) {
    return createMemoryKvClient();
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
