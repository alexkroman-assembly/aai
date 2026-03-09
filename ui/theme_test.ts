import { expect } from "@std/expect";
import { applyTheme, darkTheme, defaultTheme, lightTheme } from "./theme.ts";

function mockElement(): { el: HTMLElement; props: Map<string, string> } {
  const props = new Map<string, string>();
  const style = new Proxy({} as Record<string, string>, {
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
    get(target, prop) {
      if (prop === "setProperty") {
        return (k: string, v: string) => props.set(k, v);
      }
      return target[prop as string];
    },
  });
  const el = { style } as unknown as HTMLElement;
  return { el, props };
}

Deno.test("applyTheme", async (t) => {
  await t.step("sets CSS custom properties from default (dark) theme", () => {
    const { el, props } = mockElement();
    applyTheme(el, defaultTheme);

    expect(props.get("--aai-bg")).toBe("#0f0e17");
    expect(props.get("--aai-surface-light")).toBe("#2b2c3f");
    expect(props.get("--aai-text-muted")).toBe("#94a1b2");
    expect(props.get("--aai-state-listening")).toBe("#7f5af0");
    expect(props.get("--aai-state-error")).toBe("#ff6b6b");
    // 9 base + 6 states
    expect(props.size).toBe(15);
  });

  await t.step("darkTheme is same as defaultTheme", () => {
    expect(darkTheme).toBe(defaultTheme);
  });

  await t.step("applies light theme", () => {
    const { el, props } = mockElement();
    applyTheme(el, lightTheme);

    expect(props.get("--aai-bg")).toBe("#ffffff");
    expect(props.get("--aai-primary")).toBe("#2196F3");
    expect(props.size).toBe(15);
  });
});
