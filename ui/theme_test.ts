import { expect } from "@std/expect";
import { applyTheme, darkTheme, defaultTheme } from "./theme.ts";

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
  await t.step("sets CSS custom properties from theme", () => {
    const { el, props } = mockElement();
    applyTheme(el, defaultTheme);

    expect(props.get("--aai-bg")).toBe("#ffffff");
    expect(props.get("--aai-surface-light")).toBe("#e0e0e0");
    expect(props.get("--aai-text-muted")).toBe("#666666");
    expect(props.get("--aai-state-listening")).toBe("#2196F3");
    expect(props.get("--aai-state-error")).toBe("#f44336");
    // 9 base + 6 states
    expect(props.size).toBe(15);
  });

  await t.step("applies dark theme", () => {
    const { el, props } = mockElement();
    applyTheme(el, darkTheme);

    expect(props.get("--aai-bg")).toBe("#0f0e17");
    expect(props.get("--aai-primary")).toBe("#7f5af0");
    expect(props.size).toBe(15);
  });
});
