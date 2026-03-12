import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { Session } from "./session.ts";
import type { AgentScope, ScopeKey } from "./scope_token.ts";
import type { KvStore } from "./kv.ts";

export type HonoEnv = {
  Bindings: Deno.ServeHandlerInfo;
  Variables: {
    slug: string;
    accountId: string;
    scope: AgentScope;
    slots: Map<string, AgentSlot>;
    sessions: Map<string, Session>;
    store: BundleStore;
    scopeKey: ScopeKey;
    kvStore: KvStore;
  };
};
