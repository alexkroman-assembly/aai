# Build a voice agent with `aai`

You are helping a user build a voice agent using the **aai** framework. Generate
or update files based on the user's description in `$ARGUMENTS`.

## Quick start

Every agent lives in `agent.ts` and exports a default `defineAgent()` call:

```ts
import { defineAgent } from "@aai/sdk";

export default defineAgent({
  name: "My Agent",
  instructions: "You are a helpful assistant that...",
  greeting: "Hey there. What can I help you with?",
  voice: "luna",
});
```

Run it: `aai dev`

## Imports

Import what you need from `@aai/sdk`:

```ts
// Always needed
import { defineAgent } from "@aai/sdk";

// For tools with parameters
import { defineAgent, z } from "@aai/sdk";

// For type-safe tools (recommended)
import { defineAgent, tool, z } from "@aai/sdk";

// For external API calls
import { defineAgent, fetchJSON, z } from "@aai/sdk";

// For persistent memory helpers
import { defineAgent, kvTools } from "@aai/sdk";

// For multi-action tools
import { defineAgent, multiTool, z } from "@aai/sdk";

// Type imports (when you need explicit type annotations)
import type { HookContext, ToolContext } from "@aai/sdk";
```

---

## `defineAgent()` options

```ts
defineAgent({
  name: string;              // Required: display name
  instructions?: string;     // System prompt (sensible voice-first default provided)
  greeting?: string;         // Spoken on connect
  voice?: Voice;             // Rime TTS voice (default: "luna")
  prompt?: string;           // TTS voice guidance — controls pacing, tone, emotion
  transport?: Transport[];   // "websocket" | "twilio" (default: ["websocket"])
  env?: string[];            // Env var names to load (default: ["ASSEMBLYAI_API_KEY"])
  builtinTools?: BuiltinTool[];
  tools?: Record<string, ToolDef>;
  state?: () => S;           // Factory for per-session state
  onConnect?: (ctx: HookContext) => void | Promise<void>;
  onDisconnect?: (ctx: HookContext) => void | Promise<void>;
  onError?: (error: Error, ctx?: HookContext) => void;
  onTurn?: (text: string, ctx: HookContext) => void | Promise<void>;
});
```

---

## Custom tools

### Using the `tool()` helper (recommended)

The `tool()` helper infers argument types from your Zod schema, so you don't
need manual `args as {...}` casts:

```ts
import { defineAgent, tool, z } from "@aai/sdk";

export default defineAgent({
  name: "Weather Agent",
  tools: {
    get_weather: tool({
      description: "Get current weather for a city",
      parameters: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async (args, ctx) => {
        // args.city is typed as string — no cast needed
        const data = await fetch(
          `https://api.example.com/weather?q=${args.city}`,
        );
        return data.json();
      },
    }),
  },
});
```

### Inline definition (without `tool()`)

```ts
tools: {
  my_tool: {
    description: "What this tool does",
    parameters: z.object({
      param: z.string().describe("What this param is"),
    }),
    execute: async (args, ctx) => {
      const { param } = args as { param: string };
      return { result: param };
    },
  },
},
```

With this approach, `args` is `Record<string, unknown>` — use `args as { ... }`
to destructure with type safety.

### No-parameter tools

Omit `parameters` entirely:

```ts
tools: {
  list_items: {
    description: "List all items",
    execute: () => items,
  },
},
```

### Zod schema patterns

```ts
parameters: z.object({
  query: z.string().describe("Search query"),
  category: z.enum(["a", "b", "c"]),
  count: z.number().describe("How many"),
  label: z.string().describe("Optional label").optional(),
}),
```

### `multiTool()` — one tool, many actions

Replaces manual switch-case patterns. Automatically generates a `z.enum` for the
`action` parameter and merges all action schemas:

```ts
import { defineAgent, multiTool, z } from "@aai/sdk";
import type { ToolContext } from "@aai/sdk";

type GameState = { score: number; room: string; items: string[] };

export default defineAgent({
  name: "Adventure",
  state: (): GameState => ({ score: 0, room: "start", items: [] }),
  tools: {
    game: multiTool({
      description: "Manage game state: get, move, take.",
      actions: {
        get: {
          execute: (_args: Record<string, unknown>, ctx: ToolContext) => {
            return ctx.state as GameState;
          },
        },
        move: {
          schema: z.object({ room: z.string() }),
          execute: (args: Record<string, unknown>, ctx: ToolContext) => {
            const s = ctx.state as GameState;
            s.room = args.room as string;
            return { room: s.room };
          },
        },
        take: {
          schema: z.object({ item: z.string() }),
          execute: (args: Record<string, unknown>, ctx: ToolContext) => {
            const s = ctx.state as GameState;
            s.items.push(args.item as string);
            return { items: s.items };
          },
        },
      },
    }),
  },
});
```

---

## Tool context

Every `execute` function and lifecycle hook receives a context object:

```ts
// Tools get ToolContext
ctx.sessionId; // string — unique per connection
ctx.env; // Record<string, string> — env vars from .env
ctx.signal; // AbortSignal — cancelled on interruption (tools only)
ctx.state; // per-session state (see "Per-session state")
ctx.kv; // persistent KV store (see "Persistent storage")

// Hooks get HookContext (same minus signal)
```

---

## Built-in tools

Enable built-in tools via the `builtinTools` array. `user_input` and
`final_answer` are always auto-included.

- **`web_search`** — Search the web (Brave Search). Params: `query`,
  `max_results?` (default 5)
- **`visit_webpage`** — Fetch URL → Markdown. Params: `url`
- **`fetch_json`** — HTTP GET a JSON API. Params: `url`, `headers?`
- **`run_code`** — Execute JS in a sandbox (no net/fs, 30s timeout). Params:
  `code`
- **`user_input`** — Ask user a follow-up question (auto-included). Params:
  `question`
- **`final_answer`** — Deliver spoken response via TTS (auto-included). Params:
  `answer`

The framework forces `final_answer` after 4 tool iterations.

---

## Environment variables

Variables in the `env` array are loaded from `.env` and passed as `ctx.env`.
They are **not** available via `Deno.env` inside agent code.

```ts
export default defineAgent({
  name: "My Agent",
  env: ["ASSEMBLYAI_API_KEY", "MY_API_KEY"],
  tools: {
    call_api: tool({
      description: "Call an external API",
      parameters: z.object({ query: z.string() }),
      execute: async (args, ctx) => {
        const res = await fetch(`https://api.example.com?q=${args.query}`, {
          headers: { Authorization: `Bearer ${ctx.env.MY_API_KEY}` },
        });
        return res.json();
      },
    }),
  },
});
```

After creating `agent.ts`, add a **`.env`** file for agent-specific keys.
`ASSEMBLYAI_API_KEY` is saved in the global aai config — no need to add it to
`.env`.

```sh
MY_API_KEY=<user needs to add>
```

---

## `fetchJSON` — typed API calls

Supports generics for type-safe responses and a `fallback` option for graceful
error handling:

```ts
import { defineAgent, fetchJSON } from "@aai/sdk";

interface SearchResult {
  items: { title: string; url: string }[];
}

// Basic usage
const data = await fetchJSON<SearchResult>(url);

// With fallback on error
const data = await fetchJSON<SearchResult>(url, {
  fallback: { items: [] },
});

// With custom headers
const data = await fetchJSON<SearchResult>(url, {
  headers: { Authorization: `Bearer ${ctx.env.API_KEY}` },
});
```

---

## Per-session state

For data that lasts only for a single connection (games, workflows, multi-step
processes). The framework creates fresh state per session and cleans up on
disconnect:

```ts
export default defineAgent({
  name: "Quiz Agent",
  state: () => ({ score: 0, question: 0 }),
  tools: {
    answer: tool({
      description: "Submit an answer",
      parameters: z.object({ answer: z.string() }),
      execute: (args, ctx) => {
        const state = ctx.state as { score: number; question: number };
        state.question++;
        // check answer...
        return state;
      },
    }),
  },
});
```

Access via `ctx.state` in both tools and hooks.

---

## Persistent storage (KV)

Every tool and hook receives `ctx.kv` — a persistent key-value store scoped per
agent. Values are automatically JSON serialized/deserialized.

**API:**

- `kv.get<T>(key)` → `T | null`
- `kv.set(key, value, options?)` — optional `{ expireIn: ms }`
- `kv.delete(key)`
- `kv.list<T>(prefix, options?)` → `{ key, value }[]` — optional
  `{ limit, reverse }`

Keys are strings; use colon-separated prefixes by convention (`"user:123"`). Max
value size: 64 KB.

```ts
// Save
await ctx.kv.set(`note:${Date.now()}`, { text: "hello" });

// Read
const note = await ctx.kv.get<{ text: string }>("note:123");

// List
const notes = await ctx.kv.list("note:", { limit: 10, reverse: true });

// Delete
await ctx.kv.delete("note:123");
```

### `kvTools()` — drop-in persistent memory

Spreads four pre-built tools into your agent: `save_memory`, `recall_memory`,
`list_memories`, `forget_memory`:

```ts
import { defineAgent, kvTools } from "@aai/sdk";

export default defineAgent({
  name: "Memory Agent",
  tools: { ...kvTools() },
});
```

Customize names/descriptions:

```ts
tools: {
  ...kvTools({
    names: { save: "store_note", forget: "erase_note" },
    descriptions: { save: "Store a note for later" },
  }),
},
```

---

## Voices

```ts
type Voice =
  | "luna"
  | "andromeda"
  | "celeste"
  | "orion"
  | "sirius"
  | "lyra"
  | "estelle"
  | "esther"
  | "kima"
  | "bond"
  | "thalassa"
  | "vespera"
  | "moss"
  | "fern"
  | "astra"
  | "tauro"
  | "walnut"
  | "arcana"
  | string; // any Rime speaker ID — https://docs.rime.ai/api-reference/voices
```

### TTS voice guidance (`prompt`)

Controls how the voice speaks — pacing, tone, emotion. Does not affect what the
LLM says:

```ts
export default defineAgent({
  voice: "orion",
  prompt: "Speak in a dramatic, atmospheric tone. Use pauses for suspense.",
});
```

---

## Writing good `instructions`

The `instructions` field is the system prompt for your voice agent. Optimize for
spoken conversation:

- Short, punchy sentences — optimize for speech, not text
- Never mention "search results" or "sources" — speak as if knowledge is your
  own
- No visual formatting ("bullet point", "bold", etc.) — use "First", "Next",
  "Finally"
- Lead with the most important information
- Be concise and confident — no hedging ("It seems that", "I believe")
- No exclamation points — keep tone calm and conversational
- Define the agent's personality, tone, and specialty
- Include when and how to use each tool

---

## Custom UI (`client.tsx`)

Add a `client.tsx` file alongside `agent.ts`. Export a default Preact component
— the framework auto-mounts it:

```tsx
import { useSession } from "@aai/ui";

export default function App() {
  const session = useSession();
  const msgs = session.messages.value;
  const tx = session.transcript.value;
  return (
    <div>
      {msgs.map((m, i) => <p key={i}>{m.text}</p>)}
      {tx && <p>{tx}</p>}
      <button onClick={() => session.toggle()}>Toggle</button>
      <button onClick={() => session.reset()}>Reset</button>
    </div>
  );
}
```

**Rules:**

- Export a default function component — do not call `mount()` yourself
- Import hooks from `preact/hooks` (`useEffect`, `useRef`, `useState`, etc.)
- Import UI utilities from `@aai/ui`

**Styling (powered by goober):**

- `css` — tagged template for class names: `` css`color: red` ``
- `keyframes` — tagged template for animations
- `styled` — styled-components API: `` styled('div')`...` ``

**Built-in components from `@aai/ui`:**

- `ErrorBanner` — `<ErrorBanner error={session.error} />`
- `StateIndicator` — colored dot showing agent state
- `Transcript` — live speech-to-text transcript
- `ChatView` — default chat message list
- `MessageBubble` — individual message bubble
- `ThinkingIndicator` — animated thinking state

**Session signals (`useSession()`):**

- `session.state.value` (`AgentState`) — "connecting", "ready", "listening",
  "thinking", "speaking", "error"
- `session.messages.value` (`Message[]`) — `{ role, text }` objects
- `session.transcript.value` (`string`) — Live speech-to-text
- `session.error.value` (`SessionError | null`) — `{ code, message }`
- `session.started.value` (`boolean`) — Whether session has started
- `session.running.value` (`boolean`) — Whether session is active

**Methods:** `session.start()`, `session.toggle()`, `session.reset()`,
`session.dispose()`

**Templates with custom UI** (scaffold with `aai new -t <name>`): `night-owl`,
`dispatch-center`, `infocom-adventure`, `hot-takes`

---

## Using npm/jsr packages

```sh
npm install lodash-es
```

For JSR packages, add a `.npmrc`:

```ini
@jsr:registry=https://npm.jsr.io
```

Then `npm install @jsr/scope__package-name`.

Import as bare specifiers — the bundler resolves from `node_modules`:

```ts
import { capitalize } from "lodash-es";
```

---

## Phone agents (Twilio)

Add `transport: ["websocket", "twilio"]` to enable phone support:

```ts
export default defineAgent({
  name: "Phone Agent",
  transport: ["websocket", "twilio"],
});
```

---

## Embedded knowledge

Import a JSON file and expose it through tools:

```ts
import knowledge from "./knowledge.json" with { type: "json" };

export default defineAgent({
  name: "FAQ Bot",
  tools: {
    search_faq: tool({
      description: "Search the knowledge base",
      parameters: z.object({ query: z.string() }),
      execute: (args) => {
        return knowledge.faqs.filter((f: { question: string }) =>
          f.question.toLowerCase().includes(args.query.toLowerCase())
        );
      },
    }),
  },
});
```

---

## CLI commands

```sh
aai dev          # Local dev server with file watching
aai deploy       # Bundle and deploy to production
aai deploy --dry-run  # Validate and bundle without deploying
aai new          # Scaffold a new agent project
```

Install: `curl -fsSL https://aai-agent.fly.dev/install | sh`

---

## Build validation

`aai dev` and `aai deploy` validate before bundling:

1. Checks for a default export from `defineAgent()`
2. Validates `name` is a non-empty string
3. For each custom tool: verifies `description`, validates Zod schema with
   sample args, test-runs `execute()` (execution errors are OK — schema validity
   is what matters)
4. Bundles with esbuild

---

## Troubleshooting

- **"missing default export"** — Use `export default defineAgent({...})`
- **"missing env vars required by agent: X"** — Add to `.env` or remove from
  `env` array
- **"schema validation failed with sample args"** — Check `.min()`, `.regex()`,
  `.refine()` validators
- **"bundle failed"** — TypeScript syntax error — check imports, brackets
- **Tool test shows "✗"** — `execute` threw with sample args — may be expected
  if tool needs real data
- **Dev server shows error but still running** — Previous working version still
  serves — fix and save
