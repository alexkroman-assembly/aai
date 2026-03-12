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

Run it: `aai deploy`

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
  sttPrompt?: string;        // STT guidance (jargon, names)
  maxSteps?: number | ((ctx: HookContext) => number);
  toolChoice?: ToolChoice;   // "auto" | "required" | "none"
  transport?: Transport[];   // "websocket" | "twilio" (default: ["websocket"])
  env?: string[];            // Env var names to load (default: ["ASSEMBLYAI_API_KEY"])
  builtinTools?: BuiltinTool[];
  tools?: Record<string, ToolDef>;
  state?: () => S;           // Factory for per-session state
  onConnect?: (ctx: HookContext) => void | Promise<void>;
  onDisconnect?: (ctx: HookContext) => void | Promise<void>;
  onError?: (error: Error, ctx?: HookContext) => void;
  onTurn?: (text: string, ctx: HookContext) => void | Promise<void>;
  onStep?: (step: StepInfo, ctx: HookContext) => void | Promise<void>;
  onBeforeStep?: (stepNumber: number, ctx: HookContext) =>
    { activeTools?: string[] } | void;
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
      return { result: args.param };
    },
  },
},
```

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

## Tool context

Every `execute` function and lifecycle hook receives a context object:

```ts
// Tools get ToolContext
ctx.sessionId; // string — unique per connection
ctx.env; // Record<string, string> — env vars from .env
ctx.abortSignal; // AbortSignal — cancelled on interruption (tools only)
ctx.state; // per-session state (see "Per-session state")
ctx.kv; // persistent KV store (see "Persistent storage")
ctx.messages; // readonly Message[] — conversation history

// Hooks get HookContext (same minus signal and messages)
```

---

## Tool choice

Control how the LLM selects tools. Default is `"auto"`:

```ts
export default defineAgent({
  name: "Strict Tool Agent",
  toolChoice: "required", // Force the LLM to always call a tool
  // Options: "auto" (default), "none",
  // { type: "tool", toolName: "my_tool" }
});
```

---

## Step hooks

### `onStep` — after each tool step

Called after each LLM step completes. Use for logging, analytics, or updating
state based on what tools were called:

```ts
export default defineAgent({
  name: "Logged Agent",
  onStep: (step, ctx) => {
    console.log(`Step ${step.stepNumber}: ${step.toolCalls.length} tool calls`);
    for (const tc of step.toolCalls) {
      console.log(`  - ${tc.toolName}`);
    }
  },
});
```

### `onBeforeStep` — dynamic tool filtering

Called before each LLM step. Return `{ activeTools: [...] }` to limit which
tools the LLM can use on this step. Useful for workflows where tools should only
be available at certain stages:

```ts
export default defineAgent({
  name: "Workflow Agent",
  state: () => ({ phase: "gather" }),
  onBeforeStep: (stepNumber, ctx) => {
    const state = ctx.state as { phase: string };
    if (state.phase === "gather") {
      return { activeTools: ["search", "lookup", "final_answer"] };
    }
    return { activeTools: ["summarize", "final_answer"] };
  },
});
```

---

## Dynamic `maxSteps`

`maxSteps` can be a function that returns the max steps based on session state:

```ts
export default defineAgent({
  name: "Adaptive Agent",
  state: () => ({ complexity: "simple" }),
  maxSteps: (ctx) => {
    const state = ctx.state as { complexity: string };
    return state.complexity === "complex" ? 10 : 5;
  },
});
```

---

## Conversation history in tools

Tools receive the conversation history via `ctx.messages`. Each message has
`role` ("user", "assistant", or "tool") and `content` (string):

```ts
tools: {
  summarize_conversation: tool({
    description: "Summarize the conversation so far",
    execute: (args, ctx) => {
      const userMessages = ctx.messages.filter(m => m.role === "user");
      return {
        messageCount: ctx.messages.length,
        userTurns: userMessages.length,
      };
    },
  }),
},
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

The framework forces `final_answer` after `maxSteps - 1` tool iterations
(default: 4).

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

### STT transcription guidance (`sttPrompt`)

Helps the speech-to-text engine with domain-specific vocabulary — proper nouns,
acronyms, jargon:

```ts
export default defineAgent({
  voice: "orion",
  sttPrompt: "Transcribe technical terms: Kubernetes, gRPC, PostgreSQL",
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

## Custom UI (`client.ts`)

Add a `client.ts` file alongside `agent.ts`. Export a default Preact component —
the framework auto-mounts it. Use `htm` tagged templates instead of JSX:

```ts
import { html, useSession } from "@aai/ui";

export default function App() {
  const session = useSession();
  const msgs = session.messages.value;
  const tx = session.transcript.value;
  return html`
    <div>
      ${msgs.map((m, i) =>
        html`
          <p key="${i}">${m.text}</p>
        `
      )} ${tx && html`
        <p>${tx}</p>
      `}
      <button onClick="${() => session.toggle()}">Toggle</button>
      <button onClick="${() => session.reset()}">Reset</button>
    </div>
  `;
}
```

**Rules:**

- Export a default function component — do not call `mount()` yourself
- Import `html` from `@aai/ui` for tagged template rendering (no JSX needed)
- Import hooks from `preact/hooks` (`useEffect`, `useRef`, `useState`, etc.)
- Import UI utilities from `@aai/ui`

**Styling:**

- Use Preact's built-in `style` prop with objects: `style=${{ color: "red" }}`
- For CSS that requires selectors, pseudo-elements, keyframes, or media queries,
  inject a `<style>` element: `` html`<style>${CSS}</style>` ``

**Built-in components from `@aai/ui`:**

- `ErrorBanner` — `` html`<${ErrorBanner} error=${session.error} />` ``
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
`dispatch-center`, `infocom-adventure`

---

## Using npm/jsr packages

```sh
npm install some-package
```

For JSR packages, add a `.npmrc`:

```ini
@jsr:registry=https://npm.jsr.io
```

Then `npm install @jsr/scope__package-name`.

Import as bare specifiers — the bundler resolves from `node_modules`:

```ts
import { someFunction } from "some-package";
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
aai deploy       # Bundle and deploy to production
aai deploy --dry-run  # Validate and bundle without deploying
aai new          # Scaffold a new agent project
```

Install: `curl -fsSL https://aai-agent.fly.dev/install | sh`

---

## Build validation

`aai deploy` bundles and deploys your agent:

1. Bundles agent code with esbuild (static compilation only — agent code is
   never imported or executed by the CLI)
2. Deploys the bundled JS to the server, where it runs inside a sandboxed Deno
   Worker with all permissions denied

---

## Troubleshooting

- **"no agent found"** — Ensure `agent.ts` exists in the current directory
- **"bundle failed"** — TypeScript syntax error — check imports, brackets
