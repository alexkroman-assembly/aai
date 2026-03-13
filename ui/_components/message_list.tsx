// Copyright 2025 the AAI authors. MIT license.
import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import type { Message } from "../types.ts";
import { useSession } from "../signals.ts";
import { MessageBubble } from "./message_bubble.tsx";
import { Transcript } from "./transcript.tsx";
import { ThinkingIndicator } from "./thinking_indicator.tsx";

export function MessageList() {
  const { messages, transcript, state } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  useSignalEffect(() => {
    messages.value;
    transcript.value;
    state.value;
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  return (
    <div
      role="log"
      class="flex-1 overflow-y-auto [scrollbar-width:none] bg-aai-surface"
    >
      <div class="flex flex-col gap-4.5 p-4">
        {messages.value.map((msg: Message, i: number) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <Transcript text={transcript} />
        {state.value === "thinking" && <ThinkingIndicator />}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
