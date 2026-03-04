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
      body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center}
      .wrap{max-width:480px;padding:2rem}
      h1{font-size:2rem;font-weight:700;margin-bottom:.5rem}
      p{color:#999;margin-bottom:2rem;line-height:1.6}
      pre{background:#161616;border:1px solid #262626;border-radius:8px;padding:1rem;font-size:.9rem;overflow-x:auto;line-height:1.7}
      code{font-family:'SF Mono',Menlo,monospace}
      .dim{color:#666}
      a{color:#60a5fa;text-decoration:none}
      a:hover{text-decoration:underline}
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>aai</h1>
      <p>Build voice agents with a single command.</p>
      <pre><code><span class="dim"># install</span>
brew tap alexkroman/aai
brew install aai

<span class="dim"># create an agent</span>
aai new my-agent --template simple
cd my-agent
aai dev

<span class="dim"># deploy an agent</span>
aai deploy

<span class="dim"># create an agent with claude code</span>
aai skill install
claude "/new-agent a voice agent that helps plan weekend trips"</code></pre>
      <p style="margin-top:1.5rem;font-size:.85rem">
        <a href="https://github.com/alexkroman/aai">GitHub</a>
      </p>
    </div>
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
