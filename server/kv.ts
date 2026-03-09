import { Redis } from "@upstash/redis";
import type { AgentScope } from "./scope_token.ts";

const MAX_VALUE_SIZE = 65_536;

export type KvStore = {
  get(scope: AgentScope, key: string): Promise<string | null>;
  set(
    scope: AgentScope,
    key: string,
    value: string,
    ttl?: number,
  ): Promise<void>;
  del(scope: AgentScope, key: string): Promise<void>;
  keys(scope: AgentScope, pattern?: string): Promise<string[]>;
};

function scopedKey(scope: AgentScope, key: string): string {
  return `kv:${scope.ownerHash}:${scope.slug}:${key}`;
}

function scopePrefix(scope: AgentScope): string {
  return `kv:${scope.ownerHash}:${scope.slug}:`;
}

export function createKvStore(url: string, token: string): KvStore {
  const redis = new Redis({ url, token });

  return {
    async get(scope, key) {
      const result = await redis.get<string>(scopedKey(scope, key));
      return result ?? null;
    },

    async set(scope, key, value, ttl) {
      if (value.length > MAX_VALUE_SIZE) {
        throw new Error(`Value exceeds max size of ${MAX_VALUE_SIZE} bytes`);
      }
      if (ttl && ttl > 0) {
        await redis.set(scopedKey(scope, key), value, { ex: ttl });
      } else {
        await redis.set(scopedKey(scope, key), value);
      }
    },

    async del(scope, key) {
      await redis.del(scopedKey(scope, key));
    },

    async keys(scope, pattern) {
      const prefix = scopePrefix(scope);
      const searchPattern = pattern ? `${prefix}${pattern}` : `${prefix}*`;
      const rawKeys = await redis.keys(searchPattern);
      return rawKeys.map((k) => k.slice(prefix.length));
    },
  };
}

export function createMemoryKvStore(): KvStore {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  function isExpired(entry: { expiresAt?: number }): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }

  return {
    get(scope, key) {
      const entry = store.get(scopedKey(scope, key));
      if (!entry || isExpired(entry)) {
        if (entry) store.delete(scopedKey(scope, key));
        return Promise.resolve(null);
      }
      return Promise.resolve(entry.value);
    },

    set(scope, key, value, ttl) {
      if (value.length > MAX_VALUE_SIZE) {
        throw new Error(`Value exceeds max size of ${MAX_VALUE_SIZE} bytes`);
      }
      store.set(scopedKey(scope, key), {
        value,
        expiresAt: ttl && ttl > 0 ? Date.now() + ttl * 1000 : undefined,
      });
      return Promise.resolve();
    },

    del(scope, key) {
      store.delete(scopedKey(scope, key));
      return Promise.resolve();
    },

    keys(scope, pattern) {
      const prefix = scopePrefix(scope);
      const now = Date.now();
      const results: string[] = [];
      for (const [key, entry] of store) {
        if (entry.expiresAt && entry.expiresAt <= now) {
          store.delete(key);
          continue;
        }
        if (key.startsWith(prefix)) {
          results.push(key.slice(prefix.length));
        }
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
