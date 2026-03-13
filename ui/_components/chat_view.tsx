// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import { useSession } from "../signals.ts";
import { StateIndicator } from "./state_indicator.tsx";
import { ErrorBanner } from "./error_banner.tsx";
import { MessageList } from "./message_list.tsx";
import { Controls } from "./controls.tsx";

export function ChatView(): preact.JSX.Element {
  const { state, error } = useSession();

  return (
    <div class="flex flex-col h-screen max-w-130 mx-auto bg-aai-bg text-aai-text font-aai text-sm">
      {/* Header */}
      <div class="flex items-center gap-3 px-4 py-3 border-b border-aai-border shrink-0">
        <span class="font-aai-mono text-[10px] leading-[1.1] font-bold text-aai-ring whitespace-pre">
          ▄▀█ ▄▀█ █ █▀█ █▀█ █
        </span>
        <div class="ml-auto">
          <StateIndicator state={state} />
        </div>
      </div>
      <ErrorBanner error={error} />
      <MessageList />
      <Controls />
    </div>
  );
}
