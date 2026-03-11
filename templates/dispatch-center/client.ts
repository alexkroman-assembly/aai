import { html, useSession } from "@aai/ui";
import type { Message } from "@aai/ui";
import { useEffect, useRef } from "preact/hooks";

const CSS = `
@keyframes dc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes dc-slide-in {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.dc-messages::-webkit-scrollbar { width: 6px; }
.dc-messages::-webkit-scrollbar-track { background: transparent; }
.dc-messages::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
.dc-sidebar::-webkit-scrollbar { width: 6px; }
.dc-sidebar::-webkit-scrollbar-track { background: transparent; }
.dc-sidebar::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
.dc-btn { transition: all 0.15s ease; }
.dc-btn-primary { background: #2563eb; color: white; }
.dc-btn-primary:hover { background: #1d4ed8; }
.dc-btn-danger { background: #dc2626; color: white; }
.dc-btn-danger:hover { background: #b91c1c; }
.dc-btn-secondary { background: #334155; color: #e2e8f0; }
.dc-btn-secondary:hover { background: #475569; }
@media (max-width: 900px) {
  .dc-main { grid-template-columns: 1fr !important; grid-template-rows: auto 1fr !important; }
}
`;

const alertColors: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

const severityColors: Record<string, string> = {
  critical: "#ef4444",
  urgent: "#f97316",
  moderate: "#eab308",
  minor: "#22c55e",
};

const statusColors: Record<string, string> = {
  incoming: "#818cf8",
  triaged: "#a78bfa",
  dispatched: "#f59e0b",
  en_route: "#3b82f6",
  on_scene: "#22c55e",
  resolved: "#6b7280",
  escalated: "#ef4444",
};

// Parse incident data from messages for the sidebar
function extractIncidents(
  messages: { role: string; text: string }[],
  // deno-lint-ignore no-explicit-any
): Map<string, Record<string, any>> {
  const incidents = new Map();
  for (const msg of messages) {
    const incMatches = msg.text.matchAll(/INC-\d{4}/g);
    for (const m of incMatches) {
      const id = m[0];
      if (!incidents.has(id)) {
        incidents.set(id, { id, mentioned: 0 });
      }
      incidents.get(id).mentioned++;
    }

    const lines = msg.text.split("\n");
    for (const line of lines) {
      const idMatch = line.match(/INC-\d{4}/);
      if (!idMatch) continue;
      const id = idMatch[0];
      const inc = incidents.get(id) || { id, mentioned: 0 };

      for (const sev of ["critical", "urgent", "moderate", "minor"]) {
        if (line.toLowerCase().includes(sev)) inc.severity = sev;
      }
      for (
        const st of [
          "incoming",
          "triaged",
          "dispatched",
          "en_route",
          "on_scene",
          "resolved",
          "escalated",
        ]
      ) {
        if (
          line.toLowerCase().includes(st.replace("_", " ")) ||
          line.toLowerCase().includes(st)
        ) inc.status = st;
      }
      const locMatch = line.match(/(?:at|to|location:?)\s+([^,.\n]{5,50})/i);
      if (locMatch) inc.location = locMatch[1].trim();

      incidents.set(id, inc);
    }
  }
  return incidents;
}

function extractAlertLevel(messages: { role: string; text: string }[]): string {
  let level = "green";
  for (const msg of messages) {
    const match = msg.text.match(/alert level[:\s]+(\w+)/i);
    if (match) level = match[1].toLowerCase();
    if (
      msg.text.includes("alert level is red") || msg.text.includes("ALERT: RED")
    ) level = "red";
    if (msg.text.includes("alert level is orange")) level = "orange";
    if (msg.text.includes("alert level is yellow")) level = "yellow";
  }
  return level;
}

function stateColor(state: string): string {
  return state === "listening"
    ? "#22c55e"
    : state === "thinking"
    ? "#eab308"
    : state === "speaking"
    ? "#3b82f6"
    : state === "ready"
    ? "#22c55e"
    : state === "error"
    ? "#ef4444"
    : "#6b7280";
}

export default function App() {
  const session = useSession();
  const msgs = session.messages.value;
  const tx = session.transcript.value;
  const state = session.state.value;
  const error = session.error.value;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const incidents = extractIncidents(msgs);
  const alertLevel = extractAlertLevel(msgs);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const incidentList = Array.from(incidents.values()).reverse();
  const activeIncidents = incidentList.filter((i) => i.status !== "resolved");
  const resolvedCount =
    incidentList.filter((i) => i.status === "resolved").length;

  const alertBg = alertColors[alertLevel] || "#6b7280";
  const alertTextColor = alertLevel === "yellow" ? "#000" : "#fff";

  const btnBase = {
    padding: "8px 16px",
    border: "none",
    borderRadius: "6px",
    fontFamily: "inherit",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  const panelBase = {
    background: "#1a1a2e",
    border: "1px solid #1e293b",
    borderRadius: "8px",
    padding: "12px",
  };

  const panelTitle = {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    color: "#64748b",
    marginBottom: "10px",
  };

  const metricRow = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "4px 0",
    fontSize: "12px",
  };

  return html`
    <style>
    ${CSS}
    </style>
    <div style="${{
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
      background: "#0a0a0f",
      color: "#e2e8f0",
      minHeight: "100vh",
      padding: 0,
      margin: 0,
      display: "flex",
      flexDirection: "column",
    }}">
      <!-- Header -->
      <div style="${{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        borderBottom: "1px solid #1e293b",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
      }}">
        <div style="${{
          fontSize: "18px",
          fontWeight: 700,
          color: "#f1f5f9",
          letterSpacing: "1px",
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}">
          <span style="${{ color: "#3b82f6" }}">\\u{25C6}</span>
          Dispatch Command Center
          <span style="${{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            display: "inline-block",
            background: stateColor(state),
            animation: state === "listening"
              ? "dc-pulse 1.5s ease-in-out infinite"
              : state === "thinking"
              ? "dc-pulse 0.8s ease-in-out infinite"
              : "none",
          }}" title="${state}" />
          <span style="${{
            fontSize: "11px",
            color: "#64748b",
            fontWeight: 400,
            textTransform: "none",
          }}">
            ${state === "listening"
              ? "LISTENING"
              : state === "thinking"
              ? "PROCESSING"
              : state === "speaking"
              ? "TRANSMITTING"
              : state.toUpperCase()}
          </span>
        </div>
        <div style="${{ display: "flex", gap: "8px", alignItems: "center" }}">
          <span style="${{
            fontSize: "10px",
            color: "#64748b",
            letterSpacing: "1px",
          }}">SYSTEM ALERT:</span>
          <span style="${{
            background: alertBg,
            color: alertTextColor,
            padding: "4px 12px",
            borderRadius: "4px",
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1px",
            animation: alertLevel === "red"
              ? "dc-pulse 1s ease-in-out infinite"
              : "none",
          }}">${alertLevel.toUpperCase()}</span>
        </div>
      </div>

      <!-- Main content -->
      <div class="dc-main" style="${{
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        gridTemplateRows: "1fr",
        flex: 1,
        overflow: "hidden",
      }}">
        <!-- Left: conversation feed -->
        <div style="${{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid #1e293b",
        }}">
          <div class="dc-messages" style="${{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}">
            ${msgs.length === 0 && html`
              <div style="${{
                textAlign: "center",
                color: "#475569",
                padding: "40px 20px",
                fontSize: "13px",
              }}">
                Dispatch Command Center standing by. Click START to begin operations.
              </div>
            `} ${msgs.map((m: Message, i: number) =>
              html`
                <div key="${i}" style="${{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  lineHeight: 1.5,
                  maxWidth: "85%",
                  animation: "dc-slide-in 0.2s ease-out",
                  background: m.role === "assistant" ? "#1e293b" : "#172554",
                  alignSelf: m.role === "assistant" ? "flex-start" : "flex-end",
                  borderLeft: m.role === "assistant"
                    ? "3px solid #3b82f6"
                    : "none",
                  borderRight: m.role !== "assistant"
                    ? "3px solid #22d3ee"
                    : "none",
                }}">
                  <div style="${{
                    fontSize: "10px",
                    color: "#64748b",
                    marginBottom: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}">
                    ${m.role === "assistant" ? "DISPATCH" : "OPERATOR"}
                  </div>
                  ${m.text}
                </div>
              `
            )}
            <div ref="${messagesEndRef}" />
          </div>

          ${tx && html`
            <div style="${{
              padding: "8px 16px",
              background: "#111827",
              borderTop: "1px solid #1e293b",
              fontSize: "12px",
              color: "#64748b",
              fontStyle: "italic",
              minHeight: "32px",
              display: "flex",
              alignItems: "center",
            }}">
              <span style="${{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                display: "inline-block",
                marginRight: "8px",
                background: "#22c55e",
                animation: "dc-pulse 1.5s ease-in-out infinite",
              }}" />
              ${tx}
            </div>
          `} ${error && html`
            <div style="${{
              padding: "8px 16px",
              background: "#7f1d1d",
              color: "#fca5a5",
              fontSize: "12px",
              borderTop: "1px solid #991b1b",
            }}">
              ERROR: ${error.message} (${error.code})
            </div>
          `}

          <div style="${{
            padding: "12px 16px",
            background: "#111827",
            borderTop: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}">
            ${!session.started.value
              ? html`
                <button
                  type="button"
                  class="dc-btn dc-btn-primary"
                  style="${btnBase}"
                  onClick="${() => session.start()}"
                >
                  Start Dispatch
                </button>
              `
              : html`
                <button
                  type="button"
                  class="${`dc-btn ${
                    session.running.value
                      ? "dc-btn-secondary"
                      : "dc-btn-primary"
                  }`}"
                  style="${btnBase}"
                  onClick="${() => session.toggle()}"
                >
                  ${session.running.value ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  class="dc-btn dc-btn-danger"
                  style="${btnBase}"
                  onClick="${() => session.reset()}"
                >
                  Reset
                </button>
              `}
            <div style="${{ flex: 1 }}" />
            <span style="${{ fontSize: "10px", color: "#475569" }}">
              ${incidentList.length} incident${incidentList.length !== 1
                ? "s"
                : ""} logged
            </span>
          </div>
        </div>

        <!-- Right: sidebar dashboard -->
        <div class="dc-sidebar" style="${{
          background: "#111827",
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}">
          <!-- Quick stats -->
          <div style="${panelBase}">
            <div style="${panelTitle}">Operations Summary</div>
            <div style="${metricRow}">
              <span style="${{ color: "#94a3b8" }}">Active Incidents</span>
              <span style="${{
                fontWeight: 700,
                color: activeIncidents.length > 3 ? "#ef4444" : "#e2e8f0",
              }}">
                ${activeIncidents.length}
              </span>
            </div>
            <div style="${metricRow}">
              <span style="${{ color: "#94a3b8" }}">Resolved</span>
              <span style="${{
                fontWeight: 700,
                color: "#22c55e",
              }}">${resolvedCount}</span>
            </div>
            <div style="${metricRow}">
              <span style="${{ color: "#94a3b8" }}">Total Logged</span>
              <span style="${{ fontWeight: 700 }}">${incidentList.length}</span>
            </div>
          </div>

          <!-- Active incidents -->
          <div style="${panelBase}">
            <div style="${panelTitle}">Active Incidents</div>
            ${activeIncidents.length === 0
              ? html`
                <div style="${{
                  fontSize: "12px",
                  color: "#475569",
                  textAlign: "center",
                  padding: "8px",
                }}">No active incidents</div>
              `
              : activeIncidents.map((inc) =>
                html`
                  <div key="${inc.id}" style="${{
                    background: "#0f172a",
                    border: `1px solid ${(severityColors[inc.severity] ||
                      "#334155")}40`,
                    borderLeft: `3px solid ${
                      severityColors[inc.severity] || "#334155"
                    }`,
                    borderRadius: "6px",
                    padding: "10px",
                    marginBottom: "8px",
                    animation: "dc-slide-in 0.3s ease-out",
                  }}">
                    <div style="${{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "4px",
                    }}">
                      <span style="${{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#f1f5f9",
                      }}">${inc.id}</span>
                      ${inc.severity && html`
                        <span style="${{
                          fontSize: "9px",
                          padding: "2px 6px",
                          borderRadius: "3px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          background: `${severityColors[inc.severity]}30`,
                          color: severityColors[inc.severity],
                        }}">${inc.severity}</span>
                      `}
                    </div>
                    ${inc.location && html`
                      <div style="${{
                        fontSize: "11px",
                        color: "#94a3b8",
                        marginBottom: "2px",
                      }}">${inc.location}</div>
                    `} ${inc.status && html`
                      <div style="${{
                        fontSize: "10px",
                        color: statusColors[inc.status] || "#6b7280",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}">
                        ${inc.status.replace("_", " ")}
                      </div>
                    `}
                  </div>
                `
              )}
          </div>

          <!-- Legend -->
          <div style="${panelBase}">
            <div style="${panelTitle}">Severity Legend</div>
            ${Object.entries(severityColors).map(([sev, color]) =>
              html`
                <div key="${sev}" style="${{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "2px 0",
                }}">
                  <span style="${{
                    width: "10px",
                    height: "10px",
                    borderRadius: "2px",
                    background: color,
                  }}" />
                  <span style="${{
                    fontSize: "11px",
                    textTransform: "capitalize",
                    color: "#94a3b8",
                  }}">${sev}</span>
                </div>
              `
            )}
          </div>

          <!-- Scenario shortcuts -->
          <div style="${panelBase}">
            <div style="${panelTitle}">Training Scenarios</div>
            <div style="${{
              fontSize: "11px",
              color: "#64748b",
              lineHeight: 1.6,
            }}">
              Say "run mass casualty scenario" or "simulate active shooter" to test
              dispatch operations with complex multi-incident drills.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
