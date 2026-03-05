# aai

Build voice agents with a single command.

## Install

```sh
curl -fsSL https://voice-agent-api.fly.dev/install | sh
```

## Quick start

```sh
mkdir my-agent && cd my-agent
aai
```

## Claude Code skill

Install the Claude Code skill to create agents with `/new-agent`:

```sh
aai skill install
```

Then in Claude Code, type `/new-agent a travel assistant that helps plan trips` and it will scaffold a complete agent for you.

## Setup

After cloning, configure git hooks:

```sh
deno task setup
```
