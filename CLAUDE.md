# CLAUDE.md

## Overview

AAI is a voice agent development kit. Users define agents via `defineAgent()`
in `agent.ts`, and the CLI bundles and deploys them to a server that
orchestrates STT (AssemblyAI) → LLM (Claude) → TTS (Rime) in real-time over
WebSocket or Twilio.

## Commands

```sh
deno task setup          # Configure git hooks (run after clone)
deno task check          # Full CI: type-check, lint, fmt, tests
deno task test           # Run all tests
deno task dev            # Run CLI dev server locally
deno task serve          # Run the orchestrator server directly
deno task deploy         # Production deploy
deno task new            # Scaffold a new agent from templates/
deno task bump           # Auto-bump versions for changed packages
deno lint                # Lint only
deno fmt                 # Format only
```

Run a single test file: `deno test --allow-all server/session_test.ts`

## Git Hooks

Hooks live in `.githooks/` (activated via `deno task setup`).

- **pre-commit**: blocks direct commits to `main`, auto-bumps versions
  (`deno task bump`), then runs `deno task check`
- **pre-push**: blocks direct pushes to `main`, verifies binary compiles via
  `deno compile`

## Architecture

### Workspaces

Five packages in `deno.json` workspace: `sdk/`, `core/`, `server/`, `ui/`,
`cli/`.

Dependency rule: `cli/`, `server/`, and `ui/` depend on `sdk/` and `core/` but
never on each other.

- `sdk/` — Public agent SDK (JSR `@aai/sdk`): types,
  `defineAgent`, `fetchJSON`
- `core/` — Internal plumbing: worker entry, protocol, RPC,
  JSON schemas
- `cli/` — The `aai` CLI tool (`cli/cli.ts`)
- `server/` — Orchestrator server (`server/main.ts`)
- `ui/` — Browser client library (Preact), bundled as
  `client.js` (`ui/mod.ts`)

### Key Files

#### cli/

- `cli.ts` — arg parsing, scaffolds new agents if no `agent.ts`, then calls
  `dev.ts`
- `dev.ts` — validates, bundles (esbuild), deploys; optionally watches
- `_bundler.ts` — esbuild bundling of `agent.ts`/`client.tsx` into
  `worker.js`/`client.js`
- `_discover.ts` — imports `agent.ts` to extract config from `defineAgent()`
- `_validate.ts` — build-time agent config validation
- `deploy.ts` — production deploy (persists to Tigris/S3)
- `new.ts` — scaffolds new agent from `templates/`

#### server/

- `orchestrator.ts` — Hono app: deploy, health, WebSocket, Twilio, landing
  page routes
- `session.ts` — per-connection session: wires STT → turn handler → TTS,
  manages interruptions
- `turn_handler.ts` — agentic loop: LLM + tool calls (up to 5 iterations),
  forces `final_answer` on last
- `worker_pool.ts` — spawns agent code in sandboxed Deno Workers (net-only
  permissions), idle eviction
- `worker_entry.ts` — runs inside Worker; exposes `executeTool`/`invokeHook`
  via RPC
- `tool_executor.ts` — dispatches custom tool calls to Worker via RPC
- `builtin_tools.ts` — web_search, visit_webpage, fetch_json, run_code,
  user_input, final_answer
- `llm.ts` — Claude API calls (OpenAI-compatible format)
- `stt.ts` — AssemblyAI streaming STT
- `tts.ts` — Rime streaming TTS
- `transport_websocket.ts` / `transport_twilio.ts` — transport handlers

#### ui/

- `session.ts` — WebSocket session management, audio capture/playback
- `audio.ts` — PCM encoding/decoding, AudioWorklet management
- `mod.ts` — default Preact UI component

### Data Flow

1. User speaks → browser captures PCM audio → WebSocket → server
1. Server forwards audio to AssemblyAI STT → receives transcript
1. STT fires `onTurn` → `turn_handler.ts` runs agentic loop (LLM + tools)
1. LLM response text → Rime TTS → audio chunks → WebSocket → browser
1. Browser plays audio; user can interrupt at any time (cancels in-flight turn)

### Agent Isolation

Agent code runs in Deno Workers with only `net: true` permission. The worker
communicates with the host via RPC over `postMessage`. Custom tool `execute`
functions run inside the worker; built-in tools run on the host.

## Conventions

- **Runtime**: Deno (not Node). Use `@std/*` for standard library.
- **Frameworks**: Hono (server), Preact (client UI)
- **Testing**: `@std/testing/bdd` (`describe`/`it`) + `@std/expect`. Test files
  are co-located: `foo.ts` → `foo_test.ts`
- **Browser behavior**: CLI opens the browser only when scaffolding a new agent,
  never during `dev` on an existing agent
- **Agent API docs**: `cli/claude.md` is copied into user agent directories as
  their CLAUDE.md. When modifying the agent API surface (`sdk/types.ts`), update
  `cli/claude.md` to match.
- **Templates**: `templates/` contains agent scaffolding templates
- **Scripts**: `scripts/check_boundaries.ts` enforces the workspace dependency
  rule; `scripts/bump_versions.ts` handles version bumps
