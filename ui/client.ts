import { mount } from "./mount.ts";
import { App } from "./_components.ts";

mount(App, {
  platformUrl: new URL(".", globalThis.location.href).href.replace(/\/$/, ""),
});
