# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AAI is a voice agent development kit. Users define agents via `defineAgent()` in `agent.ts`, and the CLI bundles and deploys them to a server that orchestrates STT (AssemblyAI) → LLM (Claude) → TTS (Rime) in real-time over WebSocket or Twilio.

## Commands

```sh
deno task setup          # Configure git hooks (run after clone)
deno task check          # Full CI: type-check + lint + fmt check + tests
deno task test           # Run all tests
deno test server/session_test.ts  # Run a single test file (needs --allow-all --unstable-worker-options for most)
deno task dev            # Run CLI dev server locally
deno task serve          # Run the orchestrator server directly
deno lint                # Lint only
deno fmt                 # Format only
```

The pre-commit hook runs `deno task check`. The pre-push hook verifies the binary compiles via `deno compile`. Direct commits/pushes to `main` are blocked by git hooks.

## Architecture

### Three Workspaces

The `deno.json` workspace has three packages: `server/`, `ui/`, `cli/`.

**`cli/`** — The `aai` CLI tool. Entry point: `cli/cli.ts`.
- `cli.ts` → parses args, scaffolds new agents if no `agent.ts` exists, then calls `dev.ts`
- `dev.ts` → type-checks, validates, bundles (esbuild), and deploys the agent to the server; optionally watches for changes
- `_bundler.ts` → esbuild bundling of agent.ts and client.tsx into worker.js and client.js
- `_discover.ts` → finds and loads agent.ts + agent.json from user's directory
- `_validate.ts` → validates the agent config at build time
- `deploy.ts` → production deploy (persists to Tigris/S3)
- `new.ts` → scaffolds new agent from templates/

**`server/`** — The orchestrator server. Entry point: `server/main.ts`.
- `orchestrator.ts` → Hono app with routes: deploy, health, WebSocket, Twilio, landing page
- `worker_pool.ts` → spawns agent code in sandboxed Deno Workers with restricted permissions (net only); manages agent lifecycle with idle eviction
- `worker_entry.ts` → runs inside the Worker; exposes `getConfig` and `executeTool` via RPC
- `session.ts` → per-connection session: wires STT → turn handler → TTS, manages interruptions
- `turn_handler.ts` → agentic loop: sends messages to LLM, executes tool calls (up to 5 iterations), forces `final_answer` on last iteration
- `builtin_tools.ts` → implementations of web_search, visit_webpage, fetch_json, run_code, user_input, final_answer
- `tool_executor.ts` → dispatches custom tool calls to the Worker via RPC
- `transport_websocket.ts` / `transport_twilio.ts` → WebSocket and Twilio transport handlers
- `stt.ts` → AssemblyAI streaming STT client
- `tts.ts` → Rime TTS streaming client
- `llm.ts` → Claude API calls (OpenAI-compatible format)

**`ui/`** — Browser client library (Preact). Bundled into `client.js` and served to the browser.
- `session.ts` → WebSocket session management, audio capture/playback
- `mod.ts` → exports the default Preact UI component
- `audio.ts` → PCM audio encoding/decoding, AudioWorklet management

### Key Data Flow

1. User speaks → browser captures PCM audio → WebSocket → server
2. Server forwards audio to AssemblyAI STT → receives transcript
3. STT fires `onTurn` → `turn_handler.ts` runs agentic loop (LLM + tools)
4. LLM response text → Rime TTS → audio chunks sent back over WebSocket
5. Browser plays audio; user can interrupt at any time (cancels in-flight turn)

### Agent Isolation

Agent code runs in Deno Workers with only `net: true` permission. The worker communicates with the host via a simple RPC protocol over `postMessage`. Custom tool `execute` functions run inside the worker; built-in tools run on the host.

## Agent API (for user-facing CLAUDE.md)

The `cli/claude.md` file is copied into user agent directories as their CLAUDE.md. It documents the `defineAgent()` API. When modifying the agent API surface (`server/agent_types.ts`), update `cli/claude.md` to match.

## Key Conventions

- Runtime: Deno (not Node). Use `@std/*` imports for standard library.
- Web framework: Hono (server), Preact (client UI)
- Tests use `@std/testing/bdd` (`describe`/`it`) and `@std/expect`
- Test files are co-located: `foo.ts` → `foo_test.ts`
- The CLI should only open the browser when scaffolding a new agent, not when running dev on an existing agent
- `shared/` contains JSON schemas used by both CLI and server for validation
- `templates/` contains agent scaffolding templates (simple, etc.)
