/**
 * Build frontend, start unified server (port 5000), open ngrok tunnel in parallel.
 * Laptop must stay on same Wi-Fi as ESP. Restore prior setup: git checkout local-stable
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const backend = path.join(__dirname, "..");
const PORT = process.env.PORT || "5000";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: true,
      ...opts,
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    child.on("error", reject);
  });
}

console.log("Building frontend...");
await run("npm", ["run", "build"], { cwd: path.join(root, "frontend") });

const serverEnv = {
  ...process.env,
  PORT,
  SERVE_FRONTEND: "1",
  POLL_MS: process.env.POLL_MS || "300",
};

console.log(`\nStarting SkyGuardX on port ${PORT}...`);
const server = spawn("node", ["server.js"], {
  cwd: backend,
  env: serverEnv,
  stdio: "inherit",
  shell: true,
});

let ngrokProc = null;

const shutdown = () => {
  if (ngrokProc) ngrokProc.kill();
  server.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

setTimeout(() => {
  console.log(`\nStarting ngrok http ${PORT} ...\n`);
  ngrokProc = spawn("ngrok", ["http", PORT], { stdio: "inherit", shell: true });
  ngrokProc.on("error", (err) => {
    console.error("\nngrok not found. Install: https://ngrok.com/download");
    console.error("Then run: ngrok http", PORT);
    console.error("Dashboard (LAN): http://localhost:" + PORT);
  });
}, 2500);

server.on("exit", (code) => {
  if (ngrokProc) ngrokProc.kill();
  process.exit(code ?? 0);
});
