import { expect } from "@std/expect";
import {
  DEFAULT_SERVER,
  incrementName,
  slugFromDir,
  slugify,
} from "./_discover.ts";

Deno.test("slugify", async (t) => {
  await t.step("lowercases and replaces non-alphanumeric", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  await t.step("strips leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  await t.step("collapses multiple separators", () => {
    expect(slugify("a   b___c")).toBe("a-b-c");
  });

  await t.step("returns empty for non-alphanumeric input", () => {
    expect(slugify("!!!")).toBe("");
  });

  await t.step("handles already-slugified input", () => {
    expect(slugify("my-agent")).toBe("my-agent");
  });
});

Deno.test("slugFromDir", async (t) => {
  await t.step("extracts slug from directory name", () => {
    expect(slugFromDir("/home/user/my-agent")).toBe("my-agent");
  });

  await t.step("slugifies directory name", () => {
    expect(slugFromDir("/home/user/My Cool Agent")).toBe("my-cool-agent");
  });

  await t.step("returns 'agent' for non-alphanumeric dir", () => {
    expect(slugFromDir("/!!!")).toBe("agent");
  });
});

Deno.test("incrementName", async (t) => {
  await t.step("appends -1 to name without number", () => {
    expect(incrementName("my-agent")).toBe("my-agent-1");
  });

  await t.step("increments existing number suffix", () => {
    expect(incrementName("my-agent-1")).toBe("my-agent-2");
    expect(incrementName("my-agent-99")).toBe("my-agent-100");
  });

  await t.step("handles name that is just a number suffix", () => {
    expect(incrementName("agent-0")).toBe("agent-1");
  });
});

Deno.test("DEFAULT_SERVER", () => {
  expect(DEFAULT_SERVER).toBe("https://aai-agent.fly.dev");
});
