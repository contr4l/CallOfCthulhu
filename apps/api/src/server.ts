import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildApp, projectRoot } from "./app.js";
const path =
  process.env.DATABASE_PATH ?? resolve(projectRoot, "data/game.sqlite");
mkdirSync(dirname(path), { recursive: true });
const app = await buildApp({
  databasePath: path,
  storyRoot: process.env.STORY_ROOT,
  serveStatic: true,
});
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
});
console.log(
  `余烬档案 API 已启动：${(app.server.address() && process.env.PORT) || 3001}`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close();
  });
