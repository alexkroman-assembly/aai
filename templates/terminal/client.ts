import { html, useSession } from "@aai/ui";
import type { Message } from "@aai/ui";
import { useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";

const XTERM_CSS =
  "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css";
const XTERM_JS =
  "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js";
const XTERM_FIT_JS =
  "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js";

const PROMPT = "\x1b[36mtrainee@k8s-lab\x1b[0m:\x1b[34m~\x1b[0m$ ";
const WELCOME = [
  "\x1b[1;32mKubernetes Training Lab\x1b[0m",
  "\x1b[90m─────────────────────────────────────────\x1b[0m",
  "Speak terminal commands into your microphone.",
  "Your speech will be transcribed and executed.",
  "",
  "Type or say \x1b[33mhelp\x1b[0m for available commands.",
  "\x1b[90m─────────────────────────────────────────\x1b[0m",
  "",
].join("\r\n");

// ─── Simulated k8s cluster ───────────────────────────────────────────────────

const NAMESPACES = ["default", "kube-system", "monitoring", "app"];
const PODS: Record<
  string,
  {
    name: string;
    ready: string;
    status: string;
    restarts: number;
    age: string;
  }[]
> = {
  default: [
    {
      name: "nginx-deployment-6b7f6c5b9-x4k2l",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "3d",
    },
    {
      name: "nginx-deployment-6b7f6c5b9-m8j3n",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "3d",
    },
    {
      name: "redis-master-0",
      ready: "1/1",
      status: "Running",
      restarts: 1,
      age: "5d",
    },
    {
      name: "api-server-7d4f8b6c9-q2w3e",
      ready: "0/1",
      status: "CrashLoopBackOff",
      restarts: 42,
      age: "1d",
    },
  ],
  "kube-system": [
    {
      name: "coredns-5d78c9869d-k4m2n",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "10d",
    },
    {
      name: "coredns-5d78c9869d-j7h8k",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "10d",
    },
    {
      name: "etcd-control-plane",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "10d",
    },
    {
      name: "kube-apiserver-control-plane",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "10d",
    },
    {
      name: "kube-scheduler-control-plane",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "10d",
    },
  ],
  monitoring: [
    {
      name: "prometheus-server-0",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "7d",
    },
    {
      name: "grafana-5f8c7d6b4-r9t1p",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "7d",
    },
  ],
  app: [
    {
      name: "frontend-6c8d9f7b5-a1b2c",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "2d",
    },
    {
      name: "backend-8e7f6d5c4-d3e4f",
      ready: "1/1",
      status: "Running",
      restarts: 0,
      age: "2d",
    },
    {
      name: "worker-9f8e7d6c5-g5h6i",
      ready: "0/1",
      status: "ImagePullBackOff",
      restarts: 0,
      age: "4h",
    },
  ],
};

const SERVICES: Record<
  string,
  {
    name: string;
    type: string;
    clusterIp: string;
    ports: string;
    age: string;
  }[]
> = {
  default: [
    {
      name: "kubernetes",
      type: "ClusterIP",
      clusterIp: "10.96.0.1",
      ports: "443/TCP",
      age: "10d",
    },
    {
      name: "nginx-service",
      type: "LoadBalancer",
      clusterIp: "10.96.45.12",
      ports: "80:30080/TCP",
      age: "3d",
    },
    {
      name: "redis-master",
      type: "ClusterIP",
      clusterIp: "10.96.78.34",
      ports: "6379/TCP",
      age: "5d",
    },
  ],
};

const DEPLOYMENTS: Record<
  string,
  {
    name: string;
    ready: string;
    upToDate: number;
    available: number;
    age: string;
  }[]
> = {
  default: [
    {
      name: "nginx-deployment",
      ready: "2/2",
      upToDate: 2,
      available: 2,
      age: "3d",
    },
    { name: "api-server", ready: "0/1", upToDate: 1, available: 0, age: "1d" },
  ],
  app: [
    { name: "frontend", ready: "1/1", upToDate: 1, available: 1, age: "2d" },
    { name: "backend", ready: "1/1", upToDate: 1, available: 1, age: "2d" },
    { name: "worker", ready: "0/1", upToDate: 1, available: 0, age: "4h" },
  ],
};

function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}

function handleCommand(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0];

  if (cmd === "help") {
    return [
      "Available commands:",
      "  kubectl get pods [-n namespace]     List pods",
      "  kubectl get services [-n namespace] List services",
      "  kubectl get deployments [-n ns]     List deployments",
      "  kubectl get namespaces              List namespaces",
      "  kubectl get nodes                   List nodes",
      "  kubectl describe pod <name> [-n ns] Describe a pod",
      "  kubectl logs <pod> [-n ns]          View pod logs",
      "  kubectl apply -f <file>             Apply a manifest",
      "  kubectl delete pod <name> [-n ns]   Delete a pod",
      "  kubectl top pods [-n ns]            Resource usage",
      "  kubectl rollout status <deploy>     Rollout status",
      "  ls / cat / echo / clear / whoami    Basic shell",
      "",
    ].join("\r\n");
  }

  if (cmd === "clear") return "\x1b[2J\x1b[H";
  if (cmd === "whoami") return "trainee\r\n";
  if (cmd === "hostname") return "k8s-lab\r\n";
  if (cmd === "date") return new Date().toString() + "\r\n";
  if (cmd === "pwd") return "/home/trainee\r\n";
  if (cmd === "ls") return "manifests/  notes.txt\r\n";
  if (cmd === "echo") return parts.slice(1).join(" ") + "\r\n";

  if (cmd === "cat" && parts[1] === "notes.txt") {
    return "TODO: Fix the CrashLoopBackOff on api-server pod\r\nTODO: Investigate ImagePullBackOff on worker pod in app namespace\r\n";
  }

  if (cmd === "cat" && parts[1]?.includes("manifest")) {
    return [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: nginx-deployment",
      "spec:",
      "  replicas: 2",
      "  selector:",
      "    matchLabels:",
      "      app: nginx",
      "  template:",
      "    metadata:",
      "      labels:",
      "        app: nginx",
      "    spec:",
      "      containers:",
      "      - name: nginx",
      "        image: nginx:1.25",
      "        ports:",
      "        - containerPort: 80",
      "",
    ].join("\r\n");
  }

  if (cmd !== "kubectl") {
    return `\x1b[31mbash: ${cmd}: command not found\x1b[0m\r\n`;
  }

  const subCmd = parts[1];
  const resource = parts[2];
  const nsFlag = parts.indexOf("-n");
  const ns = nsFlag >= 0 ? parts[nsFlag + 1] ?? "default" : "default";

  if (subCmd === "get") {
    if (resource === "namespaces" || resource === "ns") {
      const lines = ["NAME            STATUS   AGE"];
      for (const n of NAMESPACES) {
        lines.push(`${padRight(n, 16)}Active   10d`);
      }
      return lines.join("\r\n") + "\r\n";
    }

    if (resource === "nodes" || resource === "node") {
      return [
        "NAME            STATUS   ROLES           AGE   VERSION",
        "control-plane   Ready    control-plane   10d   v1.29.2",
        "worker-1        Ready    <none>          10d   v1.29.2",
        "worker-2        Ready    <none>          10d   v1.29.2",
        "",
      ].join("\r\n");
    }

    if (resource === "pods" || resource === "pod" || resource === "po") {
      const pods = PODS[ns];
      if (!pods) return `No resources found in ${ns} namespace.\r\n`;
      const lines = [
        "NAME                                     READY   STATUS              RESTARTS   AGE",
      ];
      for (const p of pods) {
        const status = p.status === "CrashLoopBackOff"
          ? `\x1b[31m${p.status}\x1b[0m`
          : p.status === "ImagePullBackOff"
          ? `\x1b[33m${p.status}\x1b[0m`
          : p.status;
        lines.push(
          `${padRight(p.name, 41)}${padRight(p.ready, 8)}${
            padRight(status, 20 + (status.length - p.status.length))
          }${padRight(String(p.restarts), 11)}${p.age}`,
        );
      }
      return lines.join("\r\n") + "\r\n";
    }

    if (resource === "services" || resource === "svc") {
      const svcs = SERVICES[ns] ?? [];
      if (!svcs.length) return `No resources found in ${ns} namespace.\r\n`;
      const lines = [
        "NAME             TYPE           CLUSTER-IP     PORTS          AGE",
      ];
      for (const s of svcs) {
        lines.push(
          `${padRight(s.name, 17)}${padRight(s.type, 15)}${
            padRight(s.clusterIp, 15)
          }${padRight(s.ports, 15)}${s.age}`,
        );
      }
      return lines.join("\r\n") + "\r\n";
    }

    if (resource === "deployments" || resource === "deploy") {
      const deps = DEPLOYMENTS[ns] ?? [];
      if (!deps.length) return `No resources found in ${ns} namespace.\r\n`;
      const lines = ["NAME               READY   UP-TO-DATE   AVAILABLE   AGE"];
      for (const d of deps) {
        lines.push(
          `${padRight(d.name, 19)}${padRight(d.ready, 8)}${
            padRight(String(d.upToDate), 13)
          }${padRight(String(d.available), 12)}${d.age}`,
        );
      }
      return lines.join("\r\n") + "\r\n";
    }

    return `error: the server doesn't have a resource type "${resource}"\r\n`;
  }

  if (subCmd === "describe") {
    if (resource === "pod") {
      const podName = parts[3] ?? "";
      const allPods = Object.values(PODS).flat();
      const pod = allPods.find((p) =>
        p.name === podName || p.name.startsWith(podName)
      );
      if (!pod) {
        return `Error from server (NotFound): pods "${podName}" not found\r\n`;
      }

      const lines = [
        `Name:         ${pod.name}`,
        `Namespace:    ${ns}`,
        `Status:       ${pod.status}`,
        `Ready:        ${pod.ready}`,
        `Restarts:     ${pod.restarts}`,
        `Age:          ${pod.age}`,
      ];

      if (pod.status === "CrashLoopBackOff") {
        lines.push(
          "",
          "Events:",
          "  Type     Reason     Age   Message",
          "  ----     ------     ---   -------",
          "  Normal   Scheduled  1d    Successfully assigned default/api-server-7d4f8b6c9-q2w3e to worker-1",
          '  Normal   Pulled     30m   Container image "api-server:v2.1.0" already present',
          "  Warning  BackOff    5m    Back-off restarting failed container",
          `  Warning  Unhealthy  5m    Liveness probe failed: connection refused on port 8080`,
        );
      }

      if (pod.status === "ImagePullBackOff") {
        lines.push(
          "",
          "Events:",
          "  Type     Reason          Age   Message",
          "  ----     ------          ---   -------",
          "  Normal   Scheduled       4h    Successfully assigned app/worker-9f8e7d6c5-g5h6i to worker-2",
          '  Warning  Failed          4h    Failed to pull image "worker:v1.3.0-rc1": rpc error: code = NotFound',
          "  Warning  ErrImagePull    4h    Error: image not found",
          '  Normal   BackOff         3h    Back-off pulling image "worker:v1.3.0-rc1"',
        );
      }

      return lines.join("\r\n") + "\r\n";
    }
    return `error: the server doesn't have a resource type "${resource}"\r\n`;
  }

  if (subCmd === "logs") {
    const podName = parts[2] ?? "";
    const allPods = Object.values(PODS).flat();
    const pod = allPods.find((p) =>
      p.name === podName || p.name.startsWith(podName)
    );
    if (!pod) {
      return `Error from server (NotFound): pods "${podName}" not found\r\n`;
    }

    if (pod.status === "CrashLoopBackOff") {
      return [
        "2024-01-15T10:30:01Z INFO  Starting api-server v2.1.0",
        "2024-01-15T10:30:01Z INFO  Loading configuration...",
        "2024-01-15T10:30:02Z INFO  Connecting to database at postgres://db:5432/api",
        "2024-01-15T10:30:05Z ERROR Connection refused: postgres://db:5432/api",
        "2024-01-15T10:30:05Z ERROR Failed to initialize database connection",
        "2024-01-15T10:30:05Z FATAL Cannot start without database. Exiting.",
        "",
      ].join("\r\n");
    }

    if (pod.name.includes("nginx")) {
      return [
        '10.244.1.5 - - [15/Jan/2024:10:00:01] "GET / HTTP/1.1" 200 615',
        '10.244.1.5 - - [15/Jan/2024:10:00:03] "GET /health HTTP/1.1" 200 2',
        '10.244.2.8 - - [15/Jan/2024:10:01:12] "GET /api/v1/status HTTP/1.1" 200 42',
        "",
      ].join("\r\n");
    }

    return `(no logs available for ${pod.name})\r\n`;
  }

  if (subCmd === "top" && resource === "pods") {
    const pods = PODS[ns];
    if (!pods) return `No resources found in ${ns} namespace.\r\n`;
    const lines = [
      "NAME                                     CPU(cores)   MEMORY(bytes)",
    ];
    for (const p of pods) {
      const cpu = p.status === "Running"
        ? `${Math.floor(Math.random() * 200 + 10)}m`
        : "0m";
      const mem = p.status === "Running"
        ? `${Math.floor(Math.random() * 256 + 32)}Mi`
        : "0Mi";
      lines.push(`${padRight(p.name, 41)}${padRight(cpu, 13)}${mem}`);
    }
    return lines.join("\r\n") + "\r\n";
  }

  if (subCmd === "apply") {
    return "deployment.apps/nginx-deployment configured\r\n";
  }

  if (subCmd === "delete" && resource === "pod") {
    const podName = parts[3] ?? "";
    return `pod "${podName}" deleted\r\n`;
  }

  if (subCmd === "rollout") {
    if (parts[2] === "status") {
      const name = parts[3] ?? "";
      return `deployment "${name}" successfully rolled out\r\n`;
    }
    if (parts[2] === "restart") {
      const name = parts[3] ?? "";
      return `deployment.apps/${name} restarted\r\n`;
    }
  }

  if (subCmd === "exec") {
    return "error: unable to connect to container (simulated environment)\r\n";
  }

  if (subCmd === "config") {
    if (parts[2] === "current-context") return "k8s-lab\r\n";
    if (parts[2] === "get-contexts") {
      return [
        "CURRENT   NAME       CLUSTER    AUTHINFO   NAMESPACE",
        "*         k8s-lab    k8s-lab    trainee    default",
        "",
      ].join("\r\n");
    }
  }

  return `error: unknown command "${
    parts.slice(1).join(" ")
  }"\r\nRun 'kubectl --help' for usage.\r\n`;
}

// ─── Normalize STT ──────────────────────────────────────────────────────────

function normalizeCommand(text: string): string {
  return text.toLowerCase().replace(/[.!?,;:]+$/, "");
}

// ─── xterm.js loader ─────────────────────────────────────────────────────────

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadCss(href: string): void {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

// deno-lint-ignore no-explicit-any
type XTerm = any;

async function loadXterm(): Promise<{
  Terminal: new (opts: Record<string, unknown>) => XTerm;
  FitAddon: new () => XTerm;
}> {
  loadCss(XTERM_CSS);
  await loadScript(XTERM_JS);
  await loadScript(XTERM_FIT_JS);
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return { Terminal: g.Terminal, FitAddon: g.FitAddon.FitAddon };
}

// ─── Terminal theme (Dracula-inspired) ───────────────────────────────────────

const THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "rgba(56, 139, 253, 0.3)",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d353",
  white: "#c9d1d9",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d364",
  brightWhite: "#f0f6fc",
};

// ─── State ───────────────────────────────────────────────────────────────────

const lastMessageCount = signal(0);
// deno-lint-ignore no-explicit-any
let termInstance: any = null;

function writePrompt(): void {
  if (termInstance) termInstance.write(PROMPT);
}

function runCommand(text: string): void {
  if (!termInstance) return;
  const cmd = normalizeCommand(text);
  termInstance.write(cmd + "\r\n");
  const output = handleCommand(cmd);
  if (output) termInstance.write(output);
  writePrompt();
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0d1117;
  overflow: hidden;
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace;
}

.term-wrap {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.term-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  font-size: 12px;
  color: #8b949e;
  flex-shrink: 0;
}

.term-tabs {
  display: flex;
  gap: 2px;
}
.term-tab {
  padding: 4px 16px;
  background: #0d1117;
  color: #c9d1d9;
  border-radius: 6px 6px 0 0;
  font-size: 12px;
  border: 1px solid #30363d;
  border-bottom: none;
  font-family: inherit;
}

.term-xterm {
  flex: 1;
  overflow: hidden;
}
.term-xterm .xterm {
  height: 100%;
  padding: 8px;
}

.term-status {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 16px;
  background: #161b22;
  border-top: 1px solid #30363d;
  color: #8b949e;
  font-size: 12px;
  flex-shrink: 0;
  font-family: inherit;
}
.term-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.term-btn {
  padding: 2px 10px;
  background: transparent;
  color: #8b949e;
  border: 1px solid #30363d;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  border-radius: 4px;
}
.term-btn:hover { background: #21262d; color: #c9d1d9; }

.term-start {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  color: #c9d1d9;
}
.term-start-logo {
  font-size: 28px;
  font-weight: bold;
  color: #58a6ff;
  letter-spacing: 4px;
}
.term-start-sub { color: #8b949e; font-size: 14px; }
.term-start-desc { color: #6e7681; font-size: 13px; text-align: center; max-width: 400px; }
.term-start-btn {
  padding: 10px 32px;
  font-size: 14px;
  border-color: #58a6ff;
  color: #58a6ff;
}

.term-error {
  padding: 6px 16px;
  background: #3d1f1f;
  color: #ff7b72;
  font-size: 12px;
  border-bottom: 1px solid #5a2d2d;
  font-family: inherit;
}

.term-transcript {
  padding: 4px 16px;
  background: #161b22;
  color: #6e7681;
  font-size: 12px;
  font-style: italic;
  border-top: 1px solid #30363d;
  flex-shrink: 0;
  font-family: inherit;
  min-height: 24px;
}
`;

// ─── Component ───────────────────────────────────────────────────────────────

export default function Terminal() {
  const {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start,
    toggle,
  } = useSession();

  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize xterm.js when started
  useEffect(() => {
    if (!started.value || !containerRef.current) return;
    if (termInstance) return;

    let disposed = false;
    // deno-lint-ignore no-explicit-any
    let fitAddon: any = null;

    loadXterm().then(({ Terminal: XTerminal, FitAddon }) => {
      if (disposed || !containerRef.current) return;

      fitAddon = new FitAddon();
      const term = new XTerminal({
        theme: THEME,
        fontFamily:
          '"JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace',
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        allowProposedApi: true,
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      term.write(WELCOME);
      writePromptOn(term);

      termInstance = term;

      // Handle keyboard input for typed commands
      let inputBuffer = "";
      term.onKey(
        ({ key, domEvent }: { key: string; domEvent: KeyboardEvent }) => {
          if (domEvent.key === "Enter") {
            term.write("\r\n");
            const output = handleCommand(
              normalizeCommand(inputBuffer),
            );
            if (output) term.write(output);
            inputBuffer = "";
            writePromptOn(term);
          } else if (domEvent.key === "Backspace") {
            if (inputBuffer.length > 0) {
              inputBuffer = inputBuffer.slice(0, -1);
              term.write("\b \b");
            }
          } else if (domEvent.key === "l" && domEvent.ctrlKey) {
            term.clear();
            inputBuffer = "";
            writePromptOn(term);
          } else if (
            key.length === 1 && !domEvent.ctrlKey && !domEvent.altKey
          ) {
            inputBuffer += key;
            term.write(key);
          }
        },
      );

      const onResize = () => fitAddon?.fit();
      globalThis.addEventListener("resize", onResize);
      term._resizeCleanup = () =>
        globalThis.removeEventListener("resize", onResize);
    });

    return () => {
      disposed = true;
      if (termInstance) {
        termInstance._resizeCleanup?.();
        termInstance.dispose();
        termInstance = null;
      }
    };
  }, [started.value]);

  // Watch for new user messages (STT transcriptions) and execute them
  useEffect(() => {
    const msgs = messages.value;
    const prev = lastMessageCount.value;
    if (msgs.length > prev) {
      for (let i = prev; i < msgs.length; i++) {
        const msg = msgs[i] as Message;
        if (msg.role === "user") {
          runCommand(msg.text);
        }
      }
      lastMessageCount.value = msgs.length;
    }
  }, [messages.value.length]);

  const stateVal = state.value;
  const isListening = stateVal === "listening";
  const statusColor = isListening
    ? "#3fb950"
    : stateVal === "thinking"
    ? "#d29922"
    : stateVal === "connecting" || stateVal === "ready"
    ? "#6e7681"
    : stateVal === "error"
    ? "#ff7b72"
    : "#58a6ff";

  const statusLabel = isListening
    ? "Listening"
    : stateVal === "thinking"
    ? "Processing"
    : stateVal === "connecting"
    ? "Connecting"
    : stateVal === "ready"
    ? "Ready"
    : stateVal === "error"
    ? "Error"
    : stateVal;

  if (!started.value) {
    return html`
      <style>
      ${CSS}
      </style>
      <div class="term-wrap">
        <div class="term-start">
          <div class="term-start-logo">K8</div>
          <div class="term-start-sub">Kubernetes Training Terminal</div>
          <div class="term-start-desc">
            Speak terminal commands into your microphone. They will be transcribed and
            executed in real time.
          </div>
          <button
            type="button"
            class="term-btn term-start-btn"
            onClick="${start}"
          >
            Start Session
          </button>
        </div>
      </div>
    `;
  }

  const errVal = error.value;
  const tx = transcript.value;

  return html`
    <style>
    ${CSS}
    </style>
    <div class="term-wrap">
      <div class="term-header">
        <div class="term-tabs">
          <div class="term-tab">trainee@k8s-lab</div>
        </div>
        <div style="${{ display: "flex", gap: "8px", alignItems: "center" }}">
          <button type="button" class="term-btn" onClick="${toggle}">
            ${running.value ? "Pause" : "Resume"}
          </button>
        </div>
      </div>

      ${errVal && html`
        <div class="term-error">${errVal.message}</div>
      `}

      <div class="term-xterm" ref="${containerRef}" />

      ${tx && html`
        <div class="term-transcript">${tx}</div>
      `}

      <div class="term-status">
        <div style="${{ display: "flex", alignItems: "center", gap: "6px" }}">
          <div class="term-status-dot" style="${{ background: statusColor }}" />
          <span>${statusLabel}</span>
        </div>
        <span style="${{ marginLeft: "auto" }}">
          k8s-lab | ${messages.value.filter((m: Message) => m.role === "user")
            .length} commands
        </span>
      </div>
    </div>
  `;
}

function writePromptOn(term: XTerm): void {
  term.write(PROMPT);
}
