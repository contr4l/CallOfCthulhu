import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:15175",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tools/dev.mjs",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    url: "http://127.0.0.1:15175",
    reuseExistingServer: false,
    env: {
      PORT: "13001",
      REGISTRATION_INVITE_CODE: "fa6ian-test",
      WEB_PORT: "15175",
      APP_ORIGINS: "http://127.0.0.1:15175",
      DATABASE_PATH: join(tmpdir(), `coc-browser-${randomUUID()}.sqlite`),
    },
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
