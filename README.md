# aai

Build voice agents with a single command.

## Install

```sh
brew tap alexkroman/aai https://github.com/alexkroman/homebrew-aai
brew install aai
```

## Quick start

```sh
aai new my-agent --template simple
cd my-agent
aai dev
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
