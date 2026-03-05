---
name: voice-agent
description: Create or update an aai voice agent. Use when the user wants to build a voice agent, create an agent, modify an existing agent, or scaffold an aai project.
argument-hint: <description of the agent to create or update>
---

# Create or update an aai voice agent

You are building a voice agent using the **aai** framework. Generate or update files based on the user's description in `$ARGUMENTS`.

## Agent structure

Every agent exports a default `defineAgent()` call. No imports needed — `defineAgent`, `z`, and `fetchJSON` are ambient globals provided by the framework:

```ts
export default defineAgent({
  name: "Agent Name",
  instructions: "...",
  greeting: "...",
  voice: "luna",              // "luna", "arcana", or any Rime voice
  builtinTools: [],            // see available tools below
  tools: {},                   // custom tools defined inline
});
```

## Available built-in tools

- `web_search` — search the web for current information
- `visit_webpage` — load and read a webpage
- `fetch_json` — fetch JSON from a REST API
- `run_code` — execute JavaScript in a sandbox (great for calculations, data transforms)
- `user_input` — ask the user a follow-up question before proceeding
- `final_answer` — deliver a spoken response (always include this)

## Custom tools

Define custom tools inline with `z` (zod) schemas:

```ts
tools: {
  my_tool: {
    description: "What this tool does",
    parameters: z.object({
      param: z.string().describe("What this param is"),
    }),
    execute: async ({ param }, ctx) => {
      // ctx.fetch for HTTP requests
      // ctx.secrets for environment variables (from .env)
      return { result: param };
    },
  },
},
```

For tools that call external APIs, use `fetchJSON`:

```ts
execute: async ({ query }, ctx) => {
  const data = await fetchJSON("https://api.example.com/data?q=" + encodeURIComponent(query), {
    fetch: ctx.fetch,
  });
  return data;
},
```

## Voice-first instructions guidelines

When writing the `instructions` field:
- Optimize for spoken responses — short, punchy sentences
- Never mention "search results" or "sources" — speak as if knowledge is your own
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
Use `web_search`, `visit_webpage`, `user_input`, `final_answer`. Good for agents that answer questions using live web data.

### Code/calculation agent (sandbox execution)
Use `run_code`, `user_input`, `final_answer`. Good for math, unit conversions, data processing. The `run_code` tool executes JavaScript — instruct the agent to always compute rather than guess.

### API-powered agent (external data)
Use `fetch_json` and/or custom tools with `ctx.fetch`. Good for weather, finance, health data, or any REST API. Include the API endpoint URLs and expected response shapes in the instructions.

### Embedded knowledge agent (local data)
Import a JSON file and expose it through custom tools:
```ts
import knowledge from "./knowledge.json" with { type: "json" };

export default defineAgent({
  name: "FAQ Bot",
  tools: {
    search_faq: {
      description: "Search the knowledge base",
      parameters: z.object({ query: z.string().describe("search term") }),
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
  "env": { "ASSEMBLYAI_API_KEY": null }
}
```

### Custom UI agent
Add a `client.tsx` file alongside `agent.ts`. It receives the session via `useSession()`:
```tsx
import { useSession } from "aai/client";

export default function App() {
  const { messages, transcript, status, stop, resume, reset } = useSession();
  return (
    <div>
      {messages.map((m, i) => <p key={i}>{m.text}</p>)}
      <p>{transcript}</p>
    </div>
  );
}
```

## Required files

After creating `agent.ts`, also create:

1. **`agent.json`** with agent metadata:
```json
{
  "slug": "agent-slug-name",
  "env": {
    "ASSEMBLYAI_API_KEY": null,
    "LLM_MODEL": "gpt-5-nano"
  }
}
```

2. **`.env`** with required API keys:
```
ASSEMBLYAI_API_KEY=<user needs to add>
```

3. **`env.example`** — same as `.env` but without values, for version control.

## Running the agent

After creating files, tell the user to run:
```sh
aai dev
```

To point at a local server:
```sh
aai dev --url http://localhost:3100
```

If they don't have aai installed:
```sh
curl -fsSL https://aai-agent.fly.dev/install | sh
```
