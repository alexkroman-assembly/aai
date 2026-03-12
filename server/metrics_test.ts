import { expect } from "@std/expect";
import {
  createCounter,
  createGauge,
  createHistogram,
  serialize,
  serializeForAgent,
} from "./metrics.ts";

Deno.test("counter without labels", () => {
  const c = createCounter("test_total", "A test counter");
  expect(c.serialize()).toContain("test_total 0");
  c.inc();
  c.inc();
  expect(c.serialize()).toContain("test_total 2");
  c.inc(undefined, 5);
  expect(c.serialize()).toContain("test_total 7");
});

Deno.test("counter with labels", () => {
  const c = createCounter("err_total", "Errors", ["component"]);
  c.inc({ component: "llm" });
  c.inc({ component: "stt" });
  c.inc({ component: "llm" });
  const output = c.serialize();
  expect(output).toContain("# HELP err_total Errors");
  expect(output).toContain("# TYPE err_total counter");
  expect(output).toContain('err_total{component="llm"} 2');
  expect(output).toContain('err_total{component="stt"} 1');
});

Deno.test("counter with multiple labels", () => {
  const c = createCounter("errs", "Errors", ["agent", "component"]);
  c.inc({ agent: "ns/bot", component: "llm" });
  c.inc({ agent: "ns/bot", component: "llm" });
  c.inc({ agent: "ns/bot", component: "stt" });
  const output = c.serialize();
  expect(output).toContain('errs{agent="ns/bot",component="llm"} 2');
  expect(output).toContain('errs{agent="ns/bot",component="stt"} 1');
});

Deno.test("gauge without labels", () => {
  const g = createGauge("active", "Active items");
  expect(g.serialize()).toContain("active 0");
  g.inc();
  g.inc();
  g.dec();
  expect(g.serialize()).toContain("active 1");
  expect(g.serialize()).toContain("# TYPE active gauge");
});

Deno.test("gauge with labels", () => {
  const g = createGauge("sessions", "Sessions", ["agent"]);
  g.inc({ agent: "a/one" });
  g.inc({ agent: "a/two" });
  g.inc({ agent: "a/one" });
  g.dec({ agent: "a/one" });
  const output = g.serialize();
  expect(output).toContain('sessions{agent="a/one"} 1');
  expect(output).toContain('sessions{agent="a/two"} 1');
});

Deno.test("histogram default buckets", () => {
  const h = createHistogram("dur", "Duration");
  h.observe(0.03);
  h.observe(0.2);
  h.observe(3.0);
  const output = h.serialize();
  expect(output).toContain("# TYPE dur histogram");
  expect(output).toContain('le="0.05"} 1');
  expect(output).toContain('le="0.1"} 1');
  expect(output).toContain('le="0.25"} 2');
  expect(output).toContain('le="0.5"} 2');
  expect(output).toContain('le="5"} 3');
  expect(output).toContain('le="+Inf"} 3');
  expect(output).toContain("dur_sum 3.23");
  expect(output).toContain("dur_count 3");
});

Deno.test("histogram custom buckets", () => {
  const h = createHistogram("stt", "STT connect", [0.1, 0.5, 1, 5]);
  h.observe(0.05);
  h.observe(0.3);
  h.observe(3.0);
  const output = h.serialize();
  expect(output).toContain('le="0.1"} 1');
  expect(output).toContain('le="0.5"} 2');
  expect(output).toContain('le="1"} 2');
  expect(output).toContain('le="5"} 3');
  expect(output).toContain('le="+Inf"} 3');
  expect(output).toContain("stt_count 3");
});

Deno.test("histogram with labels", () => {
  const h = createHistogram("turn_dur", "Turn duration", [0.5, 1, 5], [
    "agent",
  ]);
  h.observe(0.3, { agent: "ns/bot" });
  h.observe(2.0, { agent: "ns/bot" });
  h.observe(0.1, { agent: "ns/other" });
  const output = h.serialize();
  expect(output).toContain('le="0.5",agent="ns/bot"} 1');
  expect(output).toContain('le="5",agent="ns/bot"} 2');
  expect(output).toContain('le="+Inf",agent="ns/bot"} 2');
  expect(output).toContain('turn_dur_count{agent="ns/bot"} 2');
  expect(output).toContain('le="0.5",agent="ns/other"} 1');
  expect(output).toContain('turn_dur_count{agent="ns/other"} 1');
});

Deno.test("histogram with no observations", () => {
  const h = createHistogram("empty", "Empty", [1, 5]);
  const output = h.serialize();
  expect(output).toContain('le="1"} 0');
  expect(output).toContain('le="5"} 0');
  expect(output).toContain('le="+Inf"} 0');
  expect(output).toContain("empty_sum 0");
  expect(output).toContain("empty_count 0");
});

Deno.test("serialize includes all registered metrics", () => {
  const output = serialize();
  expect(output).toContain("aai_sessions_total");
  expect(output).toContain("aai_sessions_active");
  expect(output).toContain("aai_turns_total");
  expect(output).toContain("aai_errors_total");
  expect(output).toContain("aai_turn_duration_seconds");
  expect(output).toContain("aai_tts_duration_seconds");
  expect(output).toContain("aai_stt_connect_duration_seconds");
  expect(output).toContain("aai_tool_duration_seconds");
  expect(output.endsWith("\n")).toBe(true);
});

// --- Per-agent filtering ---

Deno.test("counter filters by agent and strips agent label", () => {
  const c = createCounter("errs", "Errors", ["agent", "component"]);
  c.inc({ agent: "ns/a", component: "llm" });
  c.inc({ agent: "ns/a", component: "llm" });
  c.inc({ agent: "ns/b", component: "stt" });
  c.inc({ agent: "ns/a", component: "turn" });
  const output = c.serialize("ns/a");
  expect(output).toContain('errs{component="llm"} 2');
  expect(output).toContain('errs{component="turn"} 1');
  expect(output).not.toContain("ns/b");
  expect(output).not.toContain("stt");
  expect(output).not.toContain('agent="');
});

Deno.test("counter with only agent label strips to bare metric", () => {
  const c = createCounter("turns", "Turns", ["agent"]);
  c.inc({ agent: "ns/a" });
  c.inc({ agent: "ns/a" });
  c.inc({ agent: "ns/b" });
  const output = c.serialize("ns/a");
  expect(output).toContain("turns 2");
  expect(output).not.toContain("ns/b");
  expect(output).not.toContain("{");
});

Deno.test("gauge filters by agent", () => {
  const g = createGauge("active", "Active", ["agent"]);
  g.inc({ agent: "ns/a" });
  g.inc({ agent: "ns/a" });
  g.inc({ agent: "ns/b" });
  g.dec({ agent: "ns/a" });
  const output = g.serialize("ns/a");
  expect(output).toContain("active 1");
  expect(output).not.toContain("ns/b");
});

Deno.test("histogram filters by agent and strips label", () => {
  const h = createHistogram("dur", "Duration", [0.5, 1, 5], ["agent"]);
  h.observe(0.3, { agent: "ns/a" });
  h.observe(2.0, { agent: "ns/a" });
  h.observe(0.1, { agent: "ns/b" });
  const output = h.serialize("ns/a");
  expect(output).toContain('le="0.5"} 1');
  expect(output).toContain('le="5"} 2');
  expect(output).toContain('le="+Inf"} 2');
  expect(output).toContain("dur_count 2");
  expect(output).not.toContain("ns/a");
  expect(output).not.toContain("ns/b");
  expect(output).not.toContain('agent="');
});

Deno.test("histogram keeps non-agent labels when filtering", () => {
  const h = createHistogram("tool_dur", "Tool", [1, 5], ["agent", "tool"]);
  h.observe(0.5, { agent: "ns/a", tool: "search" });
  h.observe(2.0, { agent: "ns/a", tool: "fetch" });
  h.observe(0.1, { agent: "ns/b", tool: "search" });
  const output = h.serialize("ns/a");
  expect(output).toContain('le="1",tool="search"} 1');
  expect(output).toContain('le="5",tool="fetch"} 1');
  expect(output).toContain('tool_dur_count{tool="search"} 1');
  expect(output).toContain('tool_dur_count{tool="fetch"} 1');
  expect(output).not.toContain("ns/b");
  expect(output).not.toContain('agent="');
});

Deno.test("returns empty data for unknown agent", () => {
  const c = createCounter("x", "X", ["agent"]);
  c.inc({ agent: "ns/a" });
  const output = c.serialize("ns/unknown");
  expect(output).toContain("# HELP");
  expect(output).not.toContain("ns/a");
  const dataLines = output.split("\n").filter((l) =>
    !l.startsWith("#") && l.trim() !== ""
  );
  expect(dataLines).toHaveLength(0);
});

Deno.test("serializeForAgent includes agent metrics, excludes global", () => {
  const output = serializeForAgent("test/nonexistent");
  expect(output).toContain("aai_sessions_total");
  expect(output).toContain("aai_turns_total");
  expect(output).toContain("aai_tool_duration_seconds");
  expect(output).not.toContain("aai_llm_duration_seconds");
  expect(output).not.toContain("aai_tts_duration_seconds");
  expect(output).not.toContain("aai_stt_connect_duration_seconds");
});

Deno.test("metric without agent label is unaffected by filter", () => {
  const c = createCounter("plain", "Plain counter");
  c.inc();
  c.inc();
  expect(c.serialize("ns/a")).toContain("plain 2");
  expect(c.serialize()).toContain("plain 2");
});
