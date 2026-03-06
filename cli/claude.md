---
name: voice-agent
description: Create or update an aai voice agent. Use when the user wants to build a voice agent, create an agent, modify an existing agent, or scaffold an aai project.
argument-hint: <description of the agent to create or update>
---

# Create or update an aai voice agent

You are building a voice agent using the **aai** framework. Generate or update
files based on the user's description in `$ARGUMENTS`.

## Agent structure

Every agent exports a default `defineAgent()` call. No imports needed —
`defineAgent` and `fetchJSON` are ambient globals provided by the framework:

```ts
export default defineAgent({
  name: "Agent Name",
  instructions: "...",
  greeting: "...",
  voice: "luna", // see Voice type below
  builtinTools: [], // see BuiltinTool type below
  tools: {}, // custom tools defined inline
});
```

## TypeScript types (enforced by types.d.ts)

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

// Shorthand: bare string = required string param, object = JSON Schema property
// All params required by default; add `optional: true` to opt out
type ParamShorthand = string | (JSONSchemaProperty & { optional?: boolean });
type SimpleToolParameters = Record<string, ParamShorthand>;

// Full JSON Schema format still supported
interface ToolParameters {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

interface ToolDef {
  description: string; // LLM reads this to decide when to call the tool
  parameters: ToolParameters | SimpleToolParameters; // shorthand or full JSON Schema
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown> | unknown;
}

interface ToolContext {
  secrets: Record<string, string>; // env vars from .env
  fetch: typeof globalThis.fetch; // HTTP client
  signal?: AbortSignal;
}

interface HookContext {
  sessionId: string;
  secrets: Record<string, string>; // env vars from .env — same as ToolContext.secrets
}

interface AgentOptions {
  name: string; // Required: display name
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
```

## Custom tools

Define custom tools with shorthand parameters — bare strings become required
string params, all params are required by default:

```ts
tools: {
  my_tool: {
    description: "What this tool does",
    parameters: {
      param: "What this param is",
    },
    execute: async ({ param }, ctx) => {
      // ctx.fetch for HTTP requests
      // ctx.secrets for environment variables (from .env)
      return { result: param };
    },
  },
},
```

For enums, numbers, or optional params, use object syntax:

```ts
parameters: {
  category: { type: "string", enum: ["a", "b", "c"] },
  count: { type: "number", description: "How many" },
  label: { type: "string", description: "Optional label", optional: true },
},
```

Full JSON Schema (`type: "object"`, `properties`, `required`) is also supported.

For tools that call external APIs, use `fetchJSON`. It supports a generic type
parameter for type-safe responses:

```ts
interface SearchResult { items: { title: string; url: string }[] }

execute: async ({ query }, ctx) => {
  const data = await fetchJSON<SearchResult>("https://api.example.com/data?q=" + encodeURIComponent(query), {
    fetch: ctx.fetch,
  });
  return data.items;
},
```

## Environment variables and secrets

Variables listed in `agent.json`'s `env` array are loaded from `.env` (or the
process environment) and passed as `ctx.secrets` — a `Record<string, string>` —
in both tool `execute` functions and lifecycle hooks. They are **not** available
via `Deno.env` inside agent code.

```ts
// agent.json: { "env": ["ASSEMBLYAI_API_KEY", "MY_API_KEY"] }
// .env:       MY_API_KEY=sk-abc123

export default defineAgent({
  name: "My Agent",
  tools: {
    call_api: {
      description: "Call an external API",
      parameters: { query: "search query" },
      execute: async ({ query }, ctx) => {
        // Access env vars via ctx.secrets
        const key = ctx.secrets.MY_API_KEY;
        const res = await ctx.fetch(`https://api.example.com?q=${query}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        return res.json();
      },
    },
  },
  onConnect: (ctx) => {
    // Same secrets available in hooks
    console.log("Connected:", ctx.sessionId, ctx.secrets.MY_API_KEY);
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

Use `fetch_json` and/or custom tools with `ctx.fetch`. Good for weather,
finance, health data, or any REST API. Include the API endpoint URLs and
expected response shapes in the instructions.

### Embedded knowledge agent (local data)

Import a JSON file and expose it through custom tools:

```ts
import knowledge from "./knowledge.json" with { type: "json" };

export default defineAgent({
  name: "FAQ Bot",
  tools: {
    search_faq: {
      description: "Search the knowledge base",
      parameters: {
        query: "search term",
      },
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

Same as any agent, but `agent.json` includes a transport array:

```json
{
  "slug": "phone-agent",
  "transport": ["websocket", "twilio"],
  "env": ["ASSEMBLYAI_API_KEY"]
}
```

### npm dependencies agent

When an agent needs npm packages, declare them in `agent.json`:

```json
{
  "slug": "my-agent",
  "env": ["ASSEMBLYAI_API_KEY"],
  "npm": {
    "lodash-es": "^4.17.21"
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
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Name to format" } },
        required: ["name"],
      },
      execute: ({ name }) => capitalize(name),
    },
  },
});
```

### Custom UI agent

Add a `client.tsx` file alongside `agent.ts`. Just export a default component —
the framework auto-mounts it for you:

```tsx
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

- Must have a `export default` function component — this is required
- No imports needed — `useSession`, `css`, `keyframes`, `styled`, and Preact
  hooks (`useEffect`, `useRef`, `useState`, `useCallback`, `useMemo`) are
  provided as globals by the framework
- The component is auto-mounted to the page — do not call `mount()` yourself

**Available globals for styling (from goober):**

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

1. **`agent.json`** with agent metadata:

```json
{
  "slug": "agent-slug-name",
  "env": ["ASSEMBLYAI_API_KEY"]
}
```

**agent.json schema:**

- `slug` (string, required) — Unique agent identifier used in URLs
- `env` (string[], required) — Environment variable names required by the agent.
  Must include `"ASSEMBLYAI_API_KEY"`. Values are read from `.env` or the
  process environment. These are passed as `ctx.secrets` in both tool `execute`
  functions and lifecycle hooks (`onConnect`, `onDisconnect`, `onTurn`,
  `onError`). They are **not** injected into `Deno.env`.
- `transport` (optional) — Either a single transport string or an array:
  `"websocket"` | `"twilio"`. Defaults to `["websocket"]`.
- `npm` (optional) — Object mapping npm package names to version ranges. When
  present, the CLI generates a `package.json`, runs `npm install`, and
  configures esbuild to resolve bare imports from `node_modules`.

2. **`.env`** with required API keys:

```
ASSEMBLYAI_API_KEY=<user needs to add>
```

3. **`env.example`** — same as `.env` but without values, for version control.

## Running and deploying the agent

After creating files, tell the user to run:

```sh
aai
```

This single command runs the agent locally in dev mode. To type-check, validate,
and bundle without deploying:

```sh
aai --dry-run
```

If they don't have aai installed:

```sh
curl -fsSL https://aai-agent.fly.dev/install | sh
```
