// Runs the dev server behind a Cloudflare quick tunnel, so a phone gets the HTTPS it needs for motion sensors.
// The tunnel starts first so its URL can be handed to the Game (VITE_PUBLIC_URL): the QR code then points
// phones at the tunnel even if the Game itself was opened on localhost.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 5173;

function cloudflared() {
  try {
    return execFileSync("which", ["cloudflared"], { encoding: "utf8" }).trim();
  } catch {}
  // Fall back to the binary pocketwand's pycloudflared dependency downloads.
  const py = ".venv/bin/python";
  if (existsSync(py)) {
    return execFileSync(py, ["-c", [
      "from pathlib import Path",
      "from pycloudflared.util import download, get_info",
      "i = get_info()",
      "Path(i.executable).exists() or download(i)",
      "print(i.executable)",
    ].join("\n")], { encoding: "utf8" }).trim().split("\n").pop();
  }
  throw new Error("cloudflared not found. Install it (brew install cloudflared) or create .venv with pocketwand.");
}

/**
 * New quick-tunnel hostnames take a few seconds to exist. Ask Cloudflare's DNS directly: looking the
 * name up through the local resolver too early caches "no such host" for ~30 minutes (see pocketwand/tunnel.py).
 */
async function waitUntilResolvable(url, timeoutMs = 30000) {
  const host = new URL(url).host;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, { headers: { accept: "application/dns-json" } });
      if ((await r.json()).Answer) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

console.log("Opening a public tunnel (a few seconds)...");
const tunnel = spawn(cloudflared(), ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], {
  stdio: ["ignore", "ignore", "pipe"],
});
let vite = null;
const stop = () => { vite?.kill(); tunnel.kill(); process.exit(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
tunnel.on("exit", (code) => { console.error(`cloudflared exited (${code}).`); stop(); });

const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("cloudflared didn't report a URL; check your internet connection")), 30000);
  tunnel.stderr.setEncoding("utf8");
  tunnel.stderr.on("data", (chunk) => {
    const m = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) { clearTimeout(timer); resolve(m[0]); }
  });
}).catch((e) => { console.error(e.message); stop(); });

vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--logLevel", "warn"], {
  stdio: "inherit",
  env: { ...process.env, VITE_PUBLIC_URL: url },
});

if (!(await waitUntilResolvable(url))) console.log("The tunnel is slow to come up; the link may take a moment to work.");
console.log(`\n  PhoneFight: ${url}\n  Opening it in your browser. Phones scan the QR code on that page.\n`);
if (!process.argv.includes("--no-open")) try { execFileSync("open", [url]); } catch {}
