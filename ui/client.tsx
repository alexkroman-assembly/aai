import { mount } from "./mount.tsx";
import { App } from "./components.tsx";

mount(App, {
  platformUrl: new URL(".", globalThis.location.href).href.replace(/\/$/, ""),
});
