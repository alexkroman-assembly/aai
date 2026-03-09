# Create or update an aai voice agent

You are building a voice agent using the **aai** framework. Generate or update
files based on the user's description in `$ARGUMENTS`.

## Agent structure

Every agent imports from `@aai/sdk` and exports a default `defineAgent()` call:

```ts
import { defineAgent } from "@aai/sdk";

export default defineAgent({
  name: "Agent Name",
  instructions: "...",
  greeting: "...",
  voice: "luna", // see Voice type below
  builtinTools: [], // see BuiltinTool type below
  tools: {}, // custom tools defined inline
});
```

For tools with parameters, also import `z`:

```ts
import { defineAgent, z } from "@aai/sdk";
```

For tools that call external APIs, import `fetchJSON`:

```ts
import { defineAgent, fetchJSON, z } from "@aai/sdk";
```

## TypeScript types

```ts
type BuiltinTool =
  | "web_search" // Search the web via Brave Search API
  | "visit_webpage" // Fetch & convert a webpage to markdown
  | "fetch_json" // HTTP GET a JSON REST API
  | "run_code" // Execute JavaScript in a sandboxed Deno worker
  | "user_input" // Ask the user a follow-up question (always auto-included)
  | "final_answer"; // Deliver spoken response (always auto-included)

### Built-in tool reference

**web_search** — Search the web via Brave Search API.
- Parameters: `query` (string), `max_results` (number, optional, default 5)
- Returns: array of `{ title, url, description }`

**visit_webpage** — Fetch a URL and return its content as Markdown.
- Parameters: `url` (string)
- Returns: `{ url, content }` (Markdown text, max ~10K chars)

**fetch_json** — HTTP GET a JSON API endpoint.
- Parameters: `url` (string), `headers` (object, optional)
- Returns: parsed JSON response

**run_code** — Execute JavaScript in a sandboxed Deno worker (no network, no filesystem).
- Parameters: `code` (string)
- Returns: captured `console.log()` output as a string
- 30-second timeout; all output must use `console.log()`

**user_input** — Ask the user a follow-up question and wait for their spoken
response. Always available (auto-included). Ends the current turn.
- Parameters: `question` (string)

**final_answer** — Deliver the agent's spoken response via TTS. Always available
(auto-included). Ends the current turn. The framework forces this tool after 4
tool iterations.
- Parameters: `answer` (string)

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
  | (string & Record<never, never>); // any Rime speaker ID — https://docs.rime.ai/api-reference/voices

interface ToolDef {
  description: string; // LLM reads this to decide when to call the tool
  parameters?: z.ZodObject<z.ZodRawShape>; // Zod schema
  // ^^ omit for no-arg tools
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

interface ToolContext {
  sessionId: string; // unique per-connection session ID
  env: Record<string, string>; // env vars from .env
  signal?: AbortSignal;
  state: unknown; // per-session state (see "Per-session state" section)
}

interface HookContext {
  sessionId: string;
  env: Record<string, string>; // env vars from .env — same as ToolContext.env
  state: unknown; // per-session state
}

interface AgentOptions {
  name: string; // Required: display name
  env?: string[]; // Env var names to load (default: ["ASSEMBLYAI_API_KEY"])
  transport?: Transport | Transport[]; // "websocket" | "twilio" (default: ["websocket"])
  instructions?: string; // System prompt (voice-first default provided)
  greeting?: string; // Spoken on connect
  voice?: Voice; // Rime TTS voice (default: "luna")
  prompt?: string; // TTS voice guidance (pacing, tone, emotion)
  builtinTools?: BuiltinTool[]; // Subset of built-in tools to enable
  tools?: Record<string, ToolDef>; // Custom tools keyed by name
  state?: () => S; // Factory for per-session state (auto-managed)
  onConnect?: (ctx: HookContext) => void | Promise<void>;
  onDisconnect?: (ctx: HookContext) => void | Promise<void>;
  // ctx is undefined if error occurs outside a session
  onError?: (error: Error, ctx?: HookContext) => void;
  onTurn?: (text: string, ctx: HookContext) => void | Promise<void>;
}

type Transport = "websocket" | "twilio";
```

## Custom tools

Tool parameters are defined using Zod schemas. Import `z` from `"@aai/sdk"` and
use `z.object({...})` to define the parameter schema:

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

**Important:** The `execute` function receives `args: Record<string, unknown>`.
Use `args as { ... }` to destructure with type safety.

For enums, numbers, or optional params:

```ts
parameters: z.object({
  category: z.enum(["a", "b", "c"]),
  count: z.number().describe("How many"),
  label: z.string().describe("Optional label").optional(),
}),
```

For a tool with no parameters, just omit `parameters`:

```ts
tools: {
  list_items: {
    description: "List all items",
    execute: () => items,
  },
},
```

### multiTool helper

For multi-action tools (one tool with many operations), use `multiTool()`. This
replaces the manual switch-case pattern:

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

`multiTool()` automatically generates a `z.enum` for the `action` parameter and
merges all action schemas. See `infocom-adventure` for a full example.

### fetchJSON with fallback

`fetchJSON` supports a `fallback` option that returns a default value instead of
throwing on HTTP or network errors:

```ts
const data = await fetchJSON<MyType>(url, {
  fallback: { error: "API unavailable" },
});
```

For tools that call external APIs, use `fetchJSON`. It supports a generic type
parameter for type-safe responses:

```ts
interface SearchResult { items: { title: string; url: string }[] }

execute: async (args) => {
  const { query } = args as { query: string };
  const url = "https://api.example.com/data?q=" +
    encodeURIComponent(query);
  const data = await fetchJSON<SearchResult>(url);
  return data.items;
},
```

## Environment variables

Variables listed in the `env` array in `defineAgent()` are loaded from `.env`
(or the process environment) and passed as `ctx.env` — a
`Record<string, string>` — in both tool `execute` functions and lifecycle hooks.
They are **not** available via `Deno.env` inside agent code. The default is
`["ASSEMBLYAI_API_KEY"]`.

```ts
// .env: MY_API_KEY=sk-abc123

export default defineAgent({
  name: "My Agent",
  env: ["ASSEMBLYAI_API_KEY", "MY_API_KEY"],
  tools: {
    call_api: {
      description: "Call an external API",
      parameters: z.object({
        query: z.string().describe("search query"),
      }),
      execute: async (args, ctx) => {
        const { query } = args as { query: string };
        const key = ctx.env.MY_API_KEY;
        const res = await fetch(`https://api.example.com?q=${query}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        return res.json();
      },
    },
  },
  onConnect: (ctx) => {
    console.log("Connected:", ctx.sessionId, ctx.env.MY_API_KEY);
  },
});
```

## Persistent storage (KV)

For data that persists across sessions (user preferences, accumulated knowledge,
settings), use `kvTools()`. Data is scoped per agent and per API key — agents
cannot access each other's data.

### kvTools helper

The fastest way to add persistent memory. Spreads four pre-built tools into your
agent: `save_memory`, `recall_memory`, `list_memories`, `forget_memory`.

```ts
import { defineAgent, kvTools } from "@aai/sdk";

export default defineAgent({
  name: "Memory Agent",
  tools: {
    ...kvTools(),
  },
});
```

To customize tool names or descriptions:

```ts
tools: {
  ...kvTools({
    names: { save: "store_note", forget: "erase_note" },
    descriptions: { save: "Store a note for later" },
  }),
},
```

See the `memory-agent` template for a full example.

### createKv (low-level)

For custom KV tools beyond the standard four, use `createKv(ctx)` directly:

```ts
import { createKv, defineAgent, z } from "@aai/sdk";

export default defineAgent({
  name: "Custom KV Agent",
  tools: {
    save: {
      description: "Save a value",
      parameters: z.object({
        key: z.string().describe("Storage key"),
        value: z.string().describe("Value to store"),
      }),
      execute: async ({ key, value }, ctx) => {
        const kv = createKv(ctx);
        await kv.set(key as string, value as string);
        return { saved: key };
      },
    },
  },
});
```

**KV API:**

- `kv.get(key)` — returns `string | null`
- `kv.set(key, value, ttl?)` — set a value, optional TTL in seconds
- `kv.del(key)` — delete a key
- `kv.keys(pattern?)` — list keys matching a glob (e.g. `"user:*"`)

Values are strings (max 64 KB). Use `JSON.stringify`/`JSON.parse` for objects.

## Per-session state

For data that only needs to last for a single connection (games, workflows,
multi-step processes), use the `state` option in `defineAgent()`. The framework
automatically creates a fresh state for each session and cleans it up on
disconnect:

```ts
export default defineAgent({
  name: "Stateful Agent",
  state: () => ({ score: 0, items: [] as string[] }),
  tools: {
    update: {
      description: "Update session state",
      parameters: z.object({ item: z.string() }),
      execute: (args, ctx) => {
        const { item } = args as { item: string };
        const state = ctx.state as { score: number; items: string[] };
        state.items.push(item);
        return state;
      },
    },
  },
});
```

The `state` factory runs once per session. Access it via `ctx.state` in tools
and hooks. No `onConnect`/`onDisconnect` needed for state management — the
framework handles creation and cleanup automatically.

See the `infocom-adventure` template for a full example with inventory, room
tracking, score, and game flags. See `dispatch-center` for a complex example
with incident management and triage scoring.

## TTS voice guidance (prompt)

The `prompt` field controls how the TTS voice speaks — pacing, tone, and
emotion. It does not affect what the LLM says, only how it sounds:

```ts
export default defineAgent({
  name: "Narrator",
  voice: "orion",
  prompt: "Speak in a dramatic, atmospheric tone. Use pauses for suspense.",
});
```

## Voice-first instructions guidelines

Best practices for the `instructions` field (what the voice agent is told to
do):

- Optimize for spoken responses — short, punchy sentences
- Never mention "search results" or "sources" — speak as if knowledge is your
  own
- No visual formatting references (no "bullet point", "bold", etc.)
- Use "First", "Next", "Finally" instead of numbered lists
- Start with the most important information
- Be concise and confident — no hedging phrases
- Never use exclamation points
- Tell the agent its personality, tone, and what it specializes in
- Include specific instructions for how to use each tool and when

## Example agents by category

### Minimal agent

```ts
export default defineAgent({
  name: "Simple Assistant",
});
```

### Research agent (web search + page reading)

Use `web_search`, `visit_webpage`. Good for agents that answer questions using
live web data.

### Code/calculation agent (sandbox execution)

Use `run_code`. Good for math, unit conversions, data processing. The `run_code`
tool executes JavaScript — instruct the agent to always compute rather than
guess.

### API-powered agent (external data)

Use `fetch_json` and/or custom tools with `fetch`. Good for weather, finance,
health data, or any REST API. Include the API endpoint URLs and expected
response shapes in the instructions.

### Embedded knowledge agent (local data)

Import a JSON file and expose it through custom tools:

```ts
import knowledge from "./knowledge.json" with { type: "json" };

export default defineAgent({
  name: "FAQ Bot",
  tools: {
    search_faq: {
      description: "Search the knowledge base",
      parameters: z.object({
        query: z.string().describe("search term"),
      }),
      execute: (args) => {
        const { query } = args as { query: string };
        const results = knowledge.faqs.filter((f: { question: string }) =>
          f.question.toLowerCase().includes(query.toLowerCase())
        );
        return results.length ? results : { message: "No matches found" };
      },
    },
  },
});
```

### Phone agent (Twilio integration)

Same as any agent, but with a `transport` field in `defineAgent()`:

```ts
export default defineAgent({
  name: "Phone Agent",
  transport: ["websocket", "twilio"],
  builtinTools: ["web_search", "visit_webpage"],
});
```

### npm/jsr dependencies agent

When an agent needs external packages, use npm to install them. Create a
`.npmrc` file to enable JSR registry access:

```ini
@jsr:registry=https://npm.jsr.io
```

Then install packages with npm:

```sh
npm install lodash-es
npm install @jsr/scope__package-name  # for JSR packages
```

Import them as bare specifiers in `agent.ts`:

```ts
import { capitalize } from "lodash-es";

export default defineAgent({
  name: "My Agent",
  tools: {
    format_name: {
      description: "Capitalize a name",
      parameters: z.object({
        name: z.string().describe("Name to format"),
      }),
      execute: (args) => {
        const { name } = args as { name: string };
        return capitalize(name);
      },
    },
  },
});
```

The `aai` bundler automatically resolves packages from `node_modules`.

### Custom UI agent

Add a `client.tsx` file alongside `agent.ts`. Import from `@aai/ui` and
`preact/hooks`, then export a default component — the framework auto-mounts it
for you.

**Templates with custom UI** (use `aai new -t <name>` to scaffold):

- `night-owl` — dark ambient theme, demonstrates styled components
- `dispatch-center` — complex dashboard with sidebar, severity indicators
- `infocom-adventure` — retro CRT terminal with CSS animations and boot screen

Minimal example:

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

**Rules for `client.tsx`:**

- Export a default function component — the framework auto-mounts it for you
- Import `useSession`, `css`, `keyframes`, `styled`, and UI components from
  `@aai/ui`
- Import Preact hooks (`useEffect`, `useRef`, `useState`, etc.) from
  `preact/hooks`
- The component is auto-mounted to the page — do not call `mount()` yourself

**Available styling imports from `@aai/ui` (powered by goober):**

- `css` — tagged template for class names: ``const myClass = css`color: red`;``
- `keyframes` — tagged template for animations:
  ``const fade = keyframes`from { opacity: 0 } to { opacity: 1 }`;``
- `styled` — styled-components API: `const Box = styled('div')`...``

**Available built-in components from `@aai/ui`:**

- `ErrorBanner` — shows session errors: `<ErrorBanner error={session.error} />`
- `StateIndicator` — shows current agent state as a colored dot
- `Transcript` — shows live speech-to-text transcript
- `ChatView` — default chat message list
- `MessageBubble` — individual message: `<MessageBubble msg={msg} />`
- `ThinkingIndicator` — animated thinking state

**Available session signals via `useSession()`:**

- `session.state.value` — `AgentState`: "connecting" | "ready" | "listening" |
  "thinking" | "speaking" | "error"
- `session.messages.value` — `Message[]`: array of `{ role, text }` objects
- `session.transcript.value` — `string`: live speech-to-text transcript
- `session.error.value` — `SessionError | null`: `{ code, message }` if errored
- `session.started.value` / `session.running.value` — `boolean` flags
- `session.start()` — begin the session
- `session.toggle()` — pause/resume
- `session.reset()` — restart the session
- `session.dispose()` — clean up

## Required files

After creating `agent.ts`, also create a **`.env`** file if the agent uses
custom API keys (e.g. for external APIs). The `ASSEMBLYAI_API_KEY` does not need
to go in `.env` — it is saved in the global aai config on first run. Only add
`.env` for agent-specific keys:

```sh
MY_API_KEY=<user needs to add>
```

## Troubleshooting

**"missing default export"** — Your `agent.ts` must use
`export default defineAgent({...})`.

**"missing env vars required by agent: X"** — Add the listed variables to your
`.env` file, or remove them from the `env` array if not needed.

**"schema validation failed with sample args"** — A Zod schema in one of your
tools has a constraint that rejects empty/zero values. Check `.min()`,
`.regex()`, or `.refine()` validators.

**"bundle failed"** — Usually a TypeScript syntax error in `agent.ts`. Check for
missing imports, unclosed brackets, or unsupported syntax.

**Tool test shows "✗"** — The tool's `execute` function threw an error when
called with empty/sample args. If the tool requires real data (API calls, etc.),
this may be expected — check that the schema is correct.

**Dev server shows error but still running** — The previous working version
continues to serve. Fix the errors and save the file to trigger a rebuild.

## Build validation

`aai build` validates your agent before bundling:

1. Imports `agent.ts` and checks for a default export from `defineAgent()`
2. Validates the `name` field is a non-empty string
3. Tests each custom tool:
   - Verifies the tool has a `description`
   - Validates the Zod schema by parsing sample args (empty strings, zeros,
     first enum values)
   - Runs `execute()` with the sample args — execution errors are OK (schema
     validity is what matters)
4. Bundles with esbuild

Tools that fail schema validation will show "✗" in the build output. Tools that
pass schema but throw during execution still show "✓" (the schema is valid;
runtime errors with sample data are expected).

## Running and deploying the agent

```sh
aai dev       # Run local dev server with file watching
aai deploy    # Bundle and deploy to production
aai new       # Scaffold a new agent project
```

`aai dev` starts a local server, bundles and deploys the agent to it, and
watches for file changes. Use it during development.

`aai deploy` bundles and deploys to the production server.

`aai deploy --dry-run` validates and bundles without deploying.

If they don't have aai installed:

```sh
curl -fsSL https://aai-agent.fly.dev/install | sh
```
