const hero = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 24px;

  & h1 {
    font-size: 24px;
    font-weight: 600;
    margin: 0;
  }
  & p {
    color: var(--aai-text-muted);
    font-size: 14px;
    margin: 0;
  }

  & button {
    margin-top: 16px;
    padding: 14px 36px;
    background: var(--aai-primary);
    color: var(--aai-text);
    border: none;
    border-radius: var(--aai-radius);
    font: 500 15px/1 inherit;
    cursor: pointer;
    letter-spacing: 0.5px;
  }
`;

const chat = css`
  max-width: 640px;
  margin: 0 auto;
  padding: 24px;
  min-height: 100vh;

  & .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--aai-surface-light);

    & span {
      font-size: 16px;
      font-weight: 600;
    }
    & .status {
      margin-left: auto;
    }
  }

  & .messages {
    min-height: 300px;
    max-height: 500px;
    overflow-y: auto;
    margin-bottom: 16px;
    border: 1px solid var(--aai-surface-light);
    border-radius: var(--aai-radius);
    padding: 16px;
    background: var(--aai-surface);
  }

  & .controls {
    display: flex;
    gap: 8px;

    & button {
      padding: 10px 20px;
      border-radius: var(--aai-radius);
      font: 500 13px/1 inherit;
      cursor: pointer;
    }
    & .toggle {
      border: none;
      color: var(--aai-bg);
    }
    & .reset {
      border: 1px solid var(--aai-surface-light);
      background: transparent;
      color: var(--aai-text-muted);
    }
  }
`;

function NightOwl() {
  const {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start,
    toggle,
    reset,
  } = useSession();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.value.length, transcript.value]);

  if (!started.value) {
    return (
      <div class={hero}>
        <div style="font-size:48px">&#x1F989;</div>
        <h1>Night Owl</h1>
        <p>your evening companion</p>
        <button type="button" onClick={start}>Start Conversation</button>
      </div>
    );
  }

  return (
    <div class={chat}>
      <div class="header">
        <div style="font-size:20px">&#x1F989;</div>
        <span>Night Owl</span>
        <div class="status">
          <StateIndicator state={state} />
        </div>
      </div>

      <ErrorBanner error={error} />

      <div class="messages">
        {messages.value.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
          />
        ))}
        <Transcript text={transcript} />
        <div ref={bottom} />
      </div>

      <div class="controls">
        <button
          type="button"
          class="toggle"
          style={{
            background: running.value
              ? "var(--aai-state-speaking)"
              : "var(--aai-state-ready)",
          }}
          onClick={toggle}
        >
          {running.value ? "Stop" : "Resume"}
        </button>
        <button type="button" class="reset" onClick={reset}>
          New Conversation
        </button>
      </div>
    </div>
  );
}

mount(NightOwl, {
  theme: darkTheme,
  platformUrl: new URL(".", globalThis.location.href).href.replace(/\/$/, ""),
});
