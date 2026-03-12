/**
 * Lightweight Prometheus metrics. No external dependencies.
 *
 * Platform view:  GET /metrics          → serialize()
 * Customer view:  GET /:ns/:slug/metrics → serializeForAgent("ns/slug")
 */

const DEFAULT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// --- Label helpers ---

type Labels = Record<string, string>;

function toKey(names: string[], labels?: Labels): string {
  if (!labels || names.length === 0) return "";
  return names.map((n) => `${n}="${labels[n] ?? ""}"`).join(",");
}

function parseKey(names: string[], key: string): Labels {
  const out: Labels = {};
  for (const n of names) {
    const p = `${n}="`;
    const i = key.indexOf(p);
    if (i === -1) continue;
    const s = i + p.length;
    out[n] = key.slice(s, key.indexOf('"', s));
  }
  return out;
}

function stripAgent(names: string[], labels: Labels): string {
  const rest = names.filter((n) => n !== "agent");
  if (rest.length === 0) return "";
  return rest.map((n) => `${n}="${labels[n] ?? ""}"`).join(",");
}

/** Filter + format a single entry. Returns null if filtered out. */
function resolve(
  names: string[],
  key: string,
  agent?: string,
): { suffix: string; extra: string } | null {
  if (agent && names.includes("agent")) {
    const parsed = parseKey(names, key);
    if (parsed.agent !== agent) return null;
    const stripped = stripAgent(names, parsed);
    return {
      suffix: stripped ? `{${stripped}}` : "",
      extra: stripped ? `,${stripped}` : "",
    };
  }
  return {
    suffix: key ? `{${key}}` : "",
    extra: key ? `,${key}` : "",
  };
}

// --- Metric types ---

type Counter = {
  inc(labels?: Labels, n?: number): void;
  serialize(agent?: string): string;
};

type Gauge = {
  inc(labels?: Labels): void;
  dec(labels?: Labels): void;
  serialize(agent?: string): string;
};

type Histogram = {
  observe(value: number, labels?: Labels): void;
  serialize(agent?: string): string;
};

export function createCounter(
  name: string,
  help: string,
  labelNames: string[] = [],
): Counter {
  const values = new Map<string, number>();
  if (labelNames.length === 0) values.set("", 0);

  return {
    inc(labels?: Labels, n = 1) {
      const key = toKey(labelNames, labels);
      values.set(key, (values.get(key) ?? 0) + n);
    },

    serialize(agent?: string) {
      const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
      for (const [key, val] of values) {
        const r = resolve(labelNames, key, agent);
        if (!r) continue;
        lines.push(`${name}${r.suffix} ${val}`);
      }
      return lines.join("\n");
    },
  };
}

export function createGauge(
  name: string,
  help: string,
  labelNames: string[] = [],
): Gauge {
  const values = new Map<string, number>();
  if (labelNames.length === 0) values.set("", 0);

  return {
    inc(labels?: Labels) {
      const key = toKey(labelNames, labels);
      values.set(key, (values.get(key) ?? 0) + 1);
    },

    dec(labels?: Labels) {
      const key = toKey(labelNames, labels);
      values.set(key, (values.get(key) ?? 0) - 1);
    },

    serialize(agent?: string) {
      const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
      for (const [key, val] of values) {
        const r = resolve(labelNames, key, agent);
        if (!r) continue;
        lines.push(`${name}${r.suffix} ${val}`);
      }
      return lines.join("\n");
    },
  };
}

type HistogramEntry = { counts: number[]; sum: number; count: number };

export function createHistogram(
  name: string,
  help: string,
  buckets = DEFAULT_BUCKETS,
  labelNames: string[] = [],
): Histogram {
  const entries = new Map<string, HistogramEntry>();

  function getEntry(key: string): HistogramEntry {
    let e = entries.get(key);
    if (!e) {
      e = { counts: new Array(buckets.length).fill(0), sum: 0, count: 0 };
      entries.set(key, e);
    }
    return e;
  }

  if (labelNames.length === 0) getEntry("");

  return {
    observe(value: number, labels?: Labels) {
      const e = getEntry(toKey(labelNames, labels));
      e.sum += value;
      e.count++;
      for (let i = 0; i < buckets.length; i++) {
        if (value <= buckets[i]) e.counts[i]++;
      }
    },

    serialize(agent?: string) {
      const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
      for (const [key, e] of entries) {
        const r = resolve(labelNames, key, agent);
        if (!r) continue;
        for (let i = 0; i < buckets.length; i++) {
          lines.push(
            `${name}_bucket{le="${buckets[i]}"${r.extra}} ${e.counts[i]}`,
          );
        }
        lines.push(`${name}_bucket{le="+Inf"${r.extra}} ${e.count}`);
        lines.push(`${name}_sum${r.suffix} ${e.sum}`);
        lines.push(`${name}_count${r.suffix} ${e.count}`);
      }
      return lines.join("\n");
    },
  };
}

// --- Registered metrics ---

export const sessionsTotal = createCounter(
  "aai_sessions_total",
  "Total voice sessions created",
  ["agent"],
);

export const sessionsActive = createGauge(
  "aai_sessions_active",
  "Currently active voice sessions",
  ["agent"],
);

export const turnsTotal = createCounter(
  "aai_turns_total",
  "Total conversation turns processed",
  ["agent"],
);

export const errorsTotal = createCounter(
  "aai_errors_total",
  "Total errors by component",
  ["agent", "component"],
);

export const turnDuration = createHistogram(
  "aai_turn_duration_seconds",
  "End-to-end turn duration in seconds",
  DEFAULT_BUCKETS,
  ["agent"],
);

export const ttsDuration = createHistogram(
  "aai_tts_duration_seconds",
  "TTS synthesis duration in seconds",
);

export const sttConnectDuration = createHistogram(
  "aai_stt_connect_duration_seconds",
  "STT WebSocket connection time in seconds",
  [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

export const toolDuration = createHistogram(
  "aai_tool_duration_seconds",
  "Tool execution duration in seconds",
  DEFAULT_BUCKETS,
  ["agent", "tool"],
);

type Metric = { serialize(agent?: string): string };

const agentMetrics: Metric[] = [
  sessionsTotal,
  sessionsActive,
  turnsTotal,
  errorsTotal,
  turnDuration,
  toolDuration,
];

const allMetrics: Metric[] = [
  ...agentMetrics,
  ttsDuration,
  sttConnectDuration,
];

/** Platform view: all metrics, all agents. */
export function serialize(): string {
  return allMetrics.map((m) => m.serialize()).join("\n\n") + "\n";
}

/** Customer view: agent-specific metrics, agent label stripped. */
export function serializeForAgent(agent: string): string {
  return agentMetrics.map((m) => m.serialize(agent)).join("\n\n") + "\n";
}
