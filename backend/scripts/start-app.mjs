import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const backend = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = {
  ...process.env,
  PORT: process.env.PORT || "5000",
  SERVE_FRONTEND: "1",
  POLL_MS: process.env.POLL_MS || "300",
};

const child = spawn("node", ["server.js"], {
  cwd: backend,
  env,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
