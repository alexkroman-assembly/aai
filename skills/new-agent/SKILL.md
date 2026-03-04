---
name: new-agent
description: Create a new aai voice agent. Use when the user wants to build a voice agent, create an agent, or scaffold an aai project.
argument-hint: <description of the agent to create>
---

# Create a new aai voice agent

You are creating a voice agent using the **aai** framework. Generate an `agent.ts` file based on the user's description in `$ARGUMENTS`.

## Agent structure

Every agent exports a default `Agent()` call:

```ts
import { Agent } from "@aai/sdk";

export default Agent({
  name: "Agent Name",
  instructions: "...",
  greeting: "...",
  voice: "jess",           // "jess", "dan", or "tara"
  builtinTools: [],        // see available tools below
  tools: {},               // custom tools defined with tool()
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

Define custom tools with `tool()` and `zod` schemas:

```ts
import { Agent, tool } from "@aai/sdk";
import { z } from "zod";

export default Agent({
  name: "My Agent",
  tools: {
    my_tool: tool({
      description: "What this tool does",
      parameters: z.object({
        param: z.string().describe("What this param is"),
      }),
      handler: ({ param }, ctx) => {
        // ctx.fetch for HTTP requests
        // ctx.secrets for environment variables
        return { result: param };
      },
    }),
  },
});
```

For tools that call external APIs, use `fetchJSON`:

```ts
import { Agent, fetchJSON, tool } from "@aai/sdk";
import type { ToolContext } from "@aai/sdk";

// In handler:
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
ASSEMBLYAI_TTS_API_KEY=<user needs to add>
```

3. **`deno.json`** with the SDK import:
```json
{
  "imports": {
    "@aai/sdk": "jsr:@anthropic-ai/aai/sdk",
    "zod": "npm:zod@^4.3.6"
  }
}
```

## Running the agent

After creating files, tell the user to run:
```sh
aai dev
```

If they don't have aai installed:
```sh
brew tap alexkroman/aai https://github.com/alexkroman/homebrew-aai
brew install aai
```
