/**
 * Build frontend, start unified server (port 5000), open ngrok tunnel.
 * Laptop must stay on same Wi-Fi as ESP.
 * Restore prior setup: git checkout local-stable
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
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))
    );
    child.on("error", reject);
  });
}

async function startNgrokTunnel() {
  const opts = { addr: Number(PORT) };
  if (process.env.NGROK_AUTHTOKEN) {
    opts.authtoken = process.env.NGROK_AUTHTOKEN;
  }

  try {
    const ngrok = (await import("ngrok")).default;
    const url = await ngrok.connect(opts);
    console.log("\n========================================");
    console.log("Phone / remote URL:", url);
    console.log("========================================\n");
    return;
  } catch (err) {
    console.warn("ngrok npm:", err.message);
  }

  console.log(`Trying ngrok CLI: ngrok http ${PORT}\n`);
  const ngrokProc = spawn("ngrok", ["http", PORT], { stdio: "inherit", shell: true });
  ngrokProc.on("error", () => {
    console.error("\nngrok failed. Add NGROK_AUTHTOKEN to backend/.env");
    console.error("Get a free token: https://dashboard.ngrok.com/get-started/your-authtoken");
    console.error("LAN dashboard: http://localhost:" + PORT);
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

const shutdown = async () => {
  try {
    const ngrok = (await import("ngrok")).default;
    await ngrok.disconnect();
    await ngrok.kill();
  } catch {
    /* ignore */
  }
  server.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

setTimeout(() => startNgrokTunnel(), 2500);

server.on("exit", (code) => {
  process.exit(code ?? 0);
});
