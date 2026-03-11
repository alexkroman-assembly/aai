import { mount } from "./mount.ts";
import { App } from "./_components.ts";

mount(App, {
  platformUrl: globalThis.location.origin + globalThis.location.pathname,
});
