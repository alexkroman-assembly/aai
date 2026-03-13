// Copyright 2025 the AAI authors. MIT license.
import type * as preact from "preact";
import type { Message } from "../types.ts";

export function MessageBubble(
  { message }: { message: Message },
): preact.JSX.Element {
  const isUser = message.role === "user";
  return (
    <div class={`flex flex-col w-full ${isUser ? "items-end" : "items-start"}`}>
      <div
        class={`max-w-[min(82%,64ch)] whitespace-pre-wrap wrap-break-word text-sm font-normal leading-[150%] text-aai-text ${
          isUser
            ? "bg-aai-surface-faint border border-aai-border px-3 py-2 rounded-aai ml-auto"
            : "p-0"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}
