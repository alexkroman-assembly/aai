import { escape } from "@std/html";

export const FAVICON_SVG: string =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#2196F3"/><path d="M50 25c-6 0-11 5-11 11v14c0 6 5 11 11 11s11-5 11-11V36c0-6-5-11-11-11z" fill="white"/><path d="M71 50c0 11-9 21-21 21s-21-10-21-21h-6c0 14 10 25 24 27v8h6v-8c14-2 24-13 24-27h-6z" fill="white"/></svg>`;

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
      .wrap{max-width:800px;padding:3rem;width:100%}
      h1{font-size:4rem;font-weight:700;margin-bottom:1rem}
      p{color:#999;margin-bottom:2rem;line-height:1.6;font-size:1.4rem}
      .cmd{position:relative;background:#161616;border:1px solid #262626;border-radius:10px;padding:1.25rem 4rem 1.25rem 1.5rem;font-size:1.2rem;line-height:1.7;margin-bottom:1.5rem}
      .cmd code{font-family:'SF Mono',Menlo,monospace;white-space:pre}
      .cmd-label{font-size:1rem;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem}
      .copy-btn{position:absolute;top:50%;right:1rem;transform:translateY(-50%);background:none;border:1px solid #333;border-radius:4px;color:#666;cursor:pointer;padding:6px 10px;font-size:.9rem;font-family:'SF Mono',Menlo,monospace;transition:color .15s,border-color .15s}
      .copy-btn:hover{color:#e5e5e5;border-color:#555}
      .copy-btn.copied{color:#4ade80;border-color:#4ade80}
      a{color:#60a5fa;text-decoration:none;font-size:1.1rem}
      a:hover{text-decoration:underline}
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>aai</h1>
      <p>Build and deploy a voice agent in 10 seconds.</p>
      <div class="cmd-label">Install</div>
      <div class="cmd">
        <code>curl -fsSL https://aai-agent.fly.dev/install | sh</code>
        <button class="copy-btn" onclick="copyCmd(this)">Copy</button>
      </div>
      <div class="cmd-label">Run</div>
      <div class="cmd">
        <code>aai</code>
        <button class="copy-btn" onclick="copyCmd(this)">Copy</button>
      </div>
      <p style="margin-top:2rem">
        <a href="https://github.com/alexkroman/aai">GitHub</a>
      </p>
    </div>
    <script>
      function copyCmd(btn){
        const text=btn.parentElement.querySelector('code').textContent;
        navigator.clipboard.writeText(text).then(()=>{
          btn.textContent='Copied!';btn.classList.add('copied');
          setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},1500);
        });
      }
    </script>
  </body>
</html>`;
}

export function renderAgentPage(name: string, basePath = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${escape(name)}</title>
    <meta name="description" content="${escape(name)} — AI voice agent">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  </head>
  <body>
    <main id="app"></main>
    <script>window.__AAI_BASE__="${escape(basePath)}";</script>
    <script type="module" src="${escape(basePath)}/client.js"></script>
  </body>
</html>`;
}
