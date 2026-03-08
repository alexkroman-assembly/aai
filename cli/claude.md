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

For tools with parameters, also import Zod:

```ts
import { defineAgent } from "@aai/sdk";
import { z } from "zod";
```

For tools that call external APIs, import `fetchJSON`:

```ts
import { defineAgent, fetchJSON } from "@aai/sdk";
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
  | (string & {}); // any Rime speaker ID — https://docs.rime.ai/api-reference/voices

interface ToolDef {
  description: string; // LLM reads this to decide when to call the tool
  parameters?: z.ZodObject<any>; // Zod object schema (omit for no-arg tools)
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

interface ToolContext {
  sessionId: string; // unique per-connection session ID
  env: Record<string, string>; // env vars from .env
  signal?: AbortSignal;
}

interface HookContext {
  sessionId: string;
  env: Record<string, string>; // env vars from .env — same as ToolContext.env
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
  onConnect?: (ctx: HookContext) => void | Promise<void>;
  onDisconnect?: (ctx: HookContext) => void | Promise<void>;
  onError?: (error: Error, ctx?: HookContext) => void;
  onTurn?: (text: string, ctx: HookContext) => void | Promise<void>;
}

type Transport = "websocket" | "twilio";
```

## Custom tools

Tool parameters are defined using Zod schemas. Import `z` from `"zod"` and use
`z.object({...})` to define the parameter schema:

```ts
tools: {
  my_tool: {
    description: "What this tool does",
    parameters: z.object({
      param: z.string().describe("What this param is"),
    }),
    execute: async ({ param }, ctx) => {
      // ctx.env for environment variables (from .env)
      return { result: param };
    },
  },
},
```

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

For tools that call external APIs, use `fetchJSON`. It supports a generic type
parameter for type-safe responses:

```ts
interface SearchResult { items: { title: string; url: string }[] }

execute: async ({ query }) => {
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
      execute: async ({ query }, ctx) => {
        // Access env vars via ctx.env
        const key = ctx.env.MY_API_KEY;
        const res = await fetch(`https://api.example.com?q=${query}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        return res.json();
      },
    },
  },
  onConnect: (ctx) => {
    // Same env available in hooks
    console.log("Connected:", ctx.sessionId, ctx.env.MY_API_KEY);
  },
});
```

## Voice-first instructions guidelines

When writing the `instructions` field:

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
      execute: ({ query }) => {
        const results = knowledge.faqs.filter((f) =>
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

When an agent needs external packages, add them to `deno.json` imports:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  },
  "imports": {
    "lodash-es": "npm:lodash-es@^4"
  }
}
```

Then import them as bare specifiers in `agent.ts`:

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
      execute: ({ name }) => capitalize(name),
    },
  },
});
```

Both `npm:` and `jsr:` specifiers are supported in the import map.

### Custom UI agent

Add a `client.tsx` file alongside `agent.ts`. Import from `@aai/ui` and
`preact/hooks`, then export a default component — the framework auto-mounts it
for you:

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

After creating `agent.ts`, also create:

**`.env`** with required API keys:

```sh
ASSEMBLYAI_API_KEY=<user needs to add>
```

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
