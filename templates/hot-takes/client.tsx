import { ErrorBanner, keyframes, styled, useSession } from "@aai/ui";
import { useEffect, useRef } from "preact/hooks";

// --- Animations ---

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
`;

const ripple = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.4); }
  70% { box-shadow: 0 0 0 18px rgba(167, 139, 250, 0); }
  100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0); }
`;

const breathe = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.15); opacity: 1; }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
`;

// --- Styled Components ---

const Shell = styled("div")`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #09090b;
  color: #fafafa;
  font-family: "Inter", "SF Pro Display", -apple-system, sans-serif;
  overflow: hidden;
  position: relative;
`;

const GradientBg = styled("div")`
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse at 20% 0%,
      rgba(167, 139, 250, 0.08) 0%,
      transparent 50%
    ),
    radial-gradient(
    ellipse at 80% 100%,
    rgba(99, 102, 241, 0.06) 0%,
    transparent 50%
  );
  pointer-events: none;
`;

const Header = styled("div")`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 24px 0;
  flex-shrink: 0;
  z-index: 2;
`;

const Title = styled("h1")`
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: #52525b;
  letter-spacing: 1px;
  text-transform: lowercase;
`;

const MessagesArea = styled("div")`
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 2;
  max-width: 640px;
  width: 100%;
  margin: 0 auto;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.06);
    border-radius: 4px;
  }
`;

const Bubble = styled("div")`
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.55;
  animation: ${fadeIn} 0.3s ease;
  ${(props: { isUser: boolean }) =>
    props.isUser
      ? `
    align-self: flex-end;
    background: linear-gradient(135deg, #a78bfa, #818cf8);
    color: #fff;
    border-bottom-right-radius: 6px;
  `
      : `
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.06);
    color: #e4e4e7;
    border-bottom-left-radius: 6px;
  `};
`;

const TranscriptBubble = styled("div")`
  align-self: flex-end;
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 18px;
  border-bottom-right-radius: 6px;
  background: rgba(167, 139, 250, 0.1);
  border: 1px solid rgba(167, 139, 250, 0.15);
  color: #a78bfa;
  font-size: 14px;
  line-height: 1.5;
  font-style: italic;
`;

const ThinkingDots = styled("div")`
  align-self: flex-start;
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 18px;
  border-bottom-left-radius: 6px;

  & span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #71717a;
    animation: ${breathe} 1.4s ease-in-out infinite;
  }
  & span:nth-child(2) {
    animation-delay: 0.15s;
  }
  & span:nth-child(3) {
    animation-delay: 0.3s;
  }
`;

const ControlBar = styled("div")`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 24px 32px;
  gap: 16px;
  z-index: 2;
  flex-shrink: 0;
`;

const MicBtn = styled("button")`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  background: ${(props: { active: boolean }) =>
    props.active
      ? "linear-gradient(135deg, #a78bfa, #818cf8)"
      : "rgba(255, 255, 255, 0.06)"};
  color: #fff;
  font-size: 26px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  animation: ${(props: { active: boolean }) =>
    props.active ? ripple : "none"} 1.8s infinite;
  &:hover {
    transform: scale(1.05);
    background: ${(props: { active: boolean }) =>
      props.active
        ? "linear-gradient(135deg, #b49bff, #929cf8)"
        : "rgba(255, 255, 255, 0.1)"};
  }
  &:active {
    transform: scale(0.95);
  }
`;

const StateLabel = styled("div")`
  font-size: 12px;
  color: #52525b;
  letter-spacing: 0.5px;
  text-transform: lowercase;
  animation: ${float} 3s ease-in-out infinite;
`;

const ErrorBar = styled("div")`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
`;

// --- App ---

export default function App() {
  const session = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages.value.length, session.transcript.value]);

  const msgs = session.messages.value;
  const tx = session.transcript.value;
  const state = session.state.value;
  const running = session.running.value;

  const stateText = state === "listening"
    ? "listening"
    : state === "thinking"
    ? "thinking"
    : state === "speaking"
    ? "speaking"
    : state === "connecting" || state === "ready"
    ? "connecting"
    : "";

  return (
    <Shell>
      <GradientBg />

      <Header>
        <Title>voice ai hot takes</Title>
      </Header>

      <MessagesArea>
        {msgs.map((m: { role: string; text: string }, i: number) => (
          <Bubble key={i} isUser={m.role === "user"}>
            {m.text}
          </Bubble>
        ))}
        {tx && <TranscriptBubble>{tx}</TranscriptBubble>}
        {state === "thinking" && (
          <ThinkingDots>
            <span />
            <span />
            <span />
          </ThinkingDots>
        )}
        <div ref={scrollRef} />
      </MessagesArea>

      <ControlBar>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <MicBtn
            active={running}
            onClick={() =>
              session.started.value ? session.toggle() : session.start()}
          >
            {running ? "\uD83C\uDFA4" : "\u25B6"}
          </MicBtn>
          {stateText && <StateLabel>{stateText}</StateLabel>}
        </div>
      </ControlBar>

      {session.error.value && (
        <ErrorBar>
          <ErrorBanner error={session.error} />
        </ErrorBar>
      )}
    </Shell>
  );
}
