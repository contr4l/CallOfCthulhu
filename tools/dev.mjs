import { spawn } from "node:child_process";
const children = ["apps/api", "apps/web"].map((workspace) =>
  spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev", "-w", workspace],
    {
      stdio: "inherit",
      env: process.env,
    },
  ),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code ?? 0));
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop());
