// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import { useSession } from "../signals.ts";
import { ChatView } from "./chat_view.tsx";

export function App(): preact.JSX.Element {
  const { started, start } = useSession();

  if (!started.value) {
    return (
      <div class="flex items-center justify-center h-screen bg-aai-bg font-aai">
        <div class="flex flex-col items-center gap-6 bg-aai-surface border border-aai-border rounded-lg px-12 py-10">
          <span class="font-aai-mono text-lg leading-[1.1] font-bold text-aai-ring whitespace-pre">
            ▄▀█ ▄▀█ █ █▀█ █▀█ █
          </span>
          <button
            type="button"
            class="h-8 px-4 py-1.5 rounded-aai text-sm font-medium leading-[130%] cursor-pointer bg-aai-surface-hover text-aai-text-secondary border border-aai-border outline-none"
            onClick={start}
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  return <ChatView />;
}
