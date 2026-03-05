---
name: new-agent
description: Create a new aai voice agent. Use when the user wants to build a voice agent, create an agent, or scaffold an aai project.
argument-hint: <description of the agent to create>
---

# Create a new aai voice agent

You are creating a voice agent using the **aai** framework. Generate an `agent.ts` file based on the user's description in `$ARGUMENTS`.

## Agent structure

Every agent exports a default `defineAgent()` call. No imports needed — `defineAgent`, `z`, and `fetchJSON` are ambient globals provided by the framework:

```ts
export default defineAgent({
  name: "Agent Name",
  instructions: "...",
  greeting: "...",
  voice: "jess",           // "jess", "dan", or "tara"
  builtinTools: [],        // see available tools below
  tools: {},               // custom tools defined inline
});
```

## Available built-in tools

- `web_search` — search the web for current information
- `visit_webpage` — load and read a webpage
- `fetch_json` — fetch JSON from a REST API
- `run_code` — execute JavaScript in a sandbox (great for calculations)
- `user_input` — ask the user a follow-up question
- `final_answer` — deliver a spoken response (always include this)

## Custom tools

Define custom tools inline with `z` (zod) schemas:

```ts
export default defineAgent({
  name: "My Agent",
  tools: {
    my_tool: {
      description: "What this tool does",
      parameters: z.object({
        param: z.string().describe("What this param is"),
      }),
      execute: ({ param }, ctx) => {
        // ctx.fetch for HTTP requests
        // ctx.secrets for environment variables
        return { result: param };
      },
    },
  },
});
```

For tools that call external APIs, use `fetchJSON`:

```ts
// In execute:
const data = await fetchJSON("https://api.example.com/data", { fetch: ctx.fetch });
```

## Voice-first instructions guidelines

When writing the `instructions` field:
- Optimize for spoken responses — short, punchy sentences
- Never mention "search results" or "sources" — speak as if knowledge is your own
- No visual formatting references (no "bullet point", "bold", etc.)
- Use "First", "Next", "Finally" instead of lists
- Start with the most important information
- Be concise and confident — no hedging phrases
- Never use exclamation points

## Required files

After creating `agent.ts`, also create:

1. **`agent.json`** with the agent metadata:
```json
{
  "name": "agent-slug-name"
}
```

2. **`.env`** with required API keys:
```
ASSEMBLYAI_API_KEY=<user needs to add>
```

## Running the agent

After creating files, tell the user to run:
```sh
aai dev
```

If they don't have aai installed:
```sh
curl -fsSL https://voice-agent-api.fly.dev/install | sh
```
