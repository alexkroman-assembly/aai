import { Hono } from "@hono/hono";
import { escape } from "@std/html";

export const FAVICON_SVG: string =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#2196F3"/><path d="M50 25c-6 0-11 5-11 11v14c0 6 5 11 11 11s11-5 11-11V36c0-6-5-11-11-11z" fill="white"/><path d="M71 50c0 11-9 21-21 21s-21-10-21-21h-6c0 14 10 25 24 27v8h6v-8c14-2 24-13 24-27h-6z" fill="white"/></svg>`;

const FAVICON_HEADERS = {
  "Content-Type": "image/svg+xml",
  "Cache-Control": "public, max-age=86400",
};

export function faviconRoutes(): Hono {
  const routes = new Hono();
  routes.get(
    "/favicon.ico",
    (c) => c.body(FAVICON_SVG, { headers: FAVICON_HEADERS }),
  );
  routes.get(
    "/favicon.svg",
    (c) => c.body(FAVICON_SVG, { headers: FAVICON_HEADERS }),
  );
  return routes;
}

export function renderLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>aai</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh}
      .hero{display:flex;align-items:center;justify-content:center;min-height:100vh}
      .wrap{max-width:800px;padding:2rem;width:100%}
      h1{font-size:2rem;font-weight:700;margin-bottom:.5rem}
      p{color:#999;margin-bottom:2rem;line-height:1.6}
      pre{background:#161616;border:1px solid #262626;border-radius:8px;padding:1rem;font-size:.9rem;overflow-x:auto;line-height:1.7;white-space:pre-wrap;word-wrap:break-word}
      code{font-family:'SF Mono',Menlo,monospace}
      .dim{color:#666}
      a{color:#60a5fa;text-decoration:none}
      a:hover{text-decoration:underline}
      .ref{max-width:800px;margin:0 auto;padding:0 2rem 4rem}
      .ref h2{font-size:1.25rem;font-weight:700;margin:2.5rem 0 .75rem;color:#e5e5e5}
      .ref h3{font-size:1rem;font-weight:600;margin:1.5rem 0 .5rem;color:#ccc}
      .ref p{font-size:.9rem;margin-bottom:1rem}
      .ref ul{list-style:none;padding:0;margin-bottom:1.5rem}
      .ref li{font-size:.9rem;color:#999;padding:.25rem 0}
      .ref li code{color:#e5e5e5}
      .ref pre{margin-bottom:1.5rem}
      .divider{max-width:800px;margin:0 auto;padding:0 2rem}
      .divider hr{border:none;border-top:1px solid #262626}
    </style>
  </head>
  <body>
    <div class="hero">
      <div class="wrap">
        <h1>aai</h1>
        <p>Build and deploy a voice agent in 5 seconds.</p>
        <pre><code><span class="dim"># install and run</span>
curl -fsSL https://aai-agent.fly.dev/install | sh
aai

<span class="dim"># then use claude code to modify your agent</span>
claude "add a weather lookup tool to my agent"</code></pre>
        <p style="margin-top:1.5rem;font-size:.85rem">
          <a href="https://github.com/alexkroman/aai">GitHub</a>
        </p>
      </div>
    </div>

    <div class="divider"><hr></div>

    <section class="ref">
      <h2>API Reference</h2>

      <h3>defineAgent</h3>
      <p>Every agent exports a default <code>defineAgent()</code> call. No imports needed &mdash; <code>defineAgent</code>, <code>z</code>, and <code>fetchJSON</code> are ambient globals.</p>
      <pre><code>export default defineAgent({
  name: "Agent Name",
  instructions: "...",        <span class="dim">// system prompt for the LLM</span>
  greeting: "...",            <span class="dim">// first message spoken to user</span>
  voice: "luna",              <span class="dim">// "luna", "arcana", or any Rime voice</span>
  prompt: "...",              <span class="dim">// optional ASR transcription prompt</span>
  builtinTools: [],           <span class="dim">// see built-in tools below</span>
  tools: {},                  <span class="dim">// custom tools defined inline</span>
  onConnect: (ctx) => {},     <span class="dim">// lifecycle hooks (see below)</span>
  onTurn: (ctx) => {},
  onDisconnect: (ctx) => {},
  onError: (error, ctx) => {},
});</code></pre>

      <h3>Built-in tools</h3>
      <p>Add to the <code>builtinTools</code> array by name:</p>
      <ul>
        <li><code>web_search</code> &mdash; search the web for current information</li>
        <li><code>visit_webpage</code> &mdash; load and read a webpage</li>
        <li><code>fetch_json</code> &mdash; fetch JSON from a REST API</li>
        <li><code>run_code</code> &mdash; execute JavaScript in a sandbox</li>
        <li><code>user_input</code> &mdash; ask the user a follow-up question</li>
        <li><code>final_answer</code> &mdash; deliver a spoken response</li>
      </ul>

      <h3>Custom tools</h3>
      <p>Define tools inline with a zod schema (or plain JSON Schema) and an <code>execute</code> function:</p>
      <pre><code>tools: {
  lookup_weather: {
    description: "Get current weather for a city",
    parameters: z.object({
      city: z.string().describe("City name"),
    }),
    execute: async ({ city }, ctx) => {
      <span class="dim">// ctx.fetch &mdash; use instead of global fetch</span>
      <span class="dim">// ctx.secrets &mdash; env vars from .env (e.g. ctx.secrets.API_KEY)</span>
      const data = await fetchJSON(
        \`https://api.example.com/weather?q=\${encodeURIComponent(city)}\`,
        { fetch: ctx.fetch }
      );
      return data;
    },
  },
}</code></pre>

      <h3>Lifecycle hooks</h3>
      <pre><code>onConnect: async (ctx) => {
  <span class="dim">// Called when a user connects</span>
  <span class="dim">// ctx.sessionId, ctx.secrets, ctx.fetch</span>
},
onTurn: async (ctx) => {
  <span class="dim">// Called after each conversation turn</span>
  <span class="dim">// ctx.sessionId, ctx.secrets, ctx.fetch</span>
  <span class="dim">// ctx.userText, ctx.assistantText, ctx.messages</span>
},
onDisconnect: async (ctx) => {
  <span class="dim">// Called when the user disconnects</span>
  <span class="dim">// ctx.sessionId, ctx.secrets, ctx.fetch</span>
},
onError: (error, ctx) => {
  <span class="dim">// Called on errors</span>
}</code></pre>

      <h3>agent.json</h3>
      <p>Declares your agent slug and required env vars. Values are read from <code>.env</code> or the process environment.</p>
      <pre><code>{
  "slug": "my-agent",
  "env": ["ASSEMBLYAI_API_KEY", "MY_API_KEY"]
}</code></pre>
      <p>For Twilio phone agents, add a transport array:</p>
      <pre><code>{
  "slug": "phone-agent",
  "transport": ["websocket", "twilio"],
  "env": ["ASSEMBLYAI_API_KEY"]
}</code></pre>

      <h3>Deploy</h3>
      <pre><code><span class="dim"># dev mode &mdash; builds, deploys, and watches for changes</span>
aai

<span class="dim"># one-shot deploy</span>
aai deploy</code></pre>

      <h3>Pitfalls</h3>
      <ul>
        <li>Use <code>ctx.secrets.VAR</code> not <code>Deno.env.get()</code> or <code>process.env</code></li>
        <li>Use <code>ctx.fetch</code> not global <code>fetch</code> inside tools</li>
        <li>Don't type-annotate <code>execute</code> args &mdash; types are inferred from the zod schema</li>
        <li>Every env var must be listed in <code>agent.json</code> <code>env</code> array</li>
        <li>Tools is a Record, not an array: <code>tools: { my_tool: { ... } }</code></li>
      </ul>
    </section>
  </body>
</html>`;
}

export function renderAgentPage(name: string, basePath = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escape(name)}</title>
    <meta name="description" content="${escape(name)} — AI voice agent">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="${escape(basePath)}/client.js"></script>
  </body>
</html>`;
}
