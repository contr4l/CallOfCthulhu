import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const helper = "tools/deploy/config.py";
test("deployment preserves the existing database and private environment without executing values", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-deploy-"));
  try {
    const legacy = join(root, "CallOfCthulhu", "data", "game.sqlite");
    mkdirSync(join(root, "CallOfCthulhu", "data"), { recursive: true });
    writeFileSync(legacy, "unchanged player data");
    const envFile = join(root, "service.env");
    const sentinel = join(root, "must-not-exist");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DEPLOY_PORT: "10086",
      REGISTRATION_INVITE_CODE: `$(touch ${sentinel})`,
    };
    delete env.DATABASE_PATH;
    assert.equal(
      spawnSync("python3", [helper, envFile, "--ensure", root], { env }).status,
      0,
    );
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    assert.equal(
      spawnSync("python3", [helper, envFile, "DATABASE_PATH"], {
        encoding: "utf8",
      }).stdout.trim(),
      legacy,
    );
    assert.equal(readFileSync(legacy, "utf8"), "unchanged player data");
    assert.equal(existsSync(sentinel), false);
    const saved = readFileSync(envFile, "utf8");
    assert.equal(
      spawnSync("python3", [helper, envFile, "--ensure", root], {
        env: { ...env, DEPLOY_PORT: "9999" },
      }).status,
      0,
    );
    assert.equal(readFileSync(envFile, "utf8"), saved);
    const privateRead = spawnSync(
      "python3",
      [helper, envFile, "REGISTRATION_INVITE_CODE"],
      { encoding: "utf8" },
    );
    assert.notEqual(privateRead.status, 0);
    assert.equal(privateRead.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("invalid initial deployment configuration does not create an environment file", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-deploy-"));
  try {
    const envFile = join(root, "service.env");
    for (const port of ["0", "65536", "invalid"]) {
      const result = spawnSync("python3", [helper, envFile, "--ensure", root], {
        env: { ...process.env, DEPLOY_PORT: port },
      });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(envFile), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("deployment dry run performs no filesystem or service changes", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-deploy-"));
  try {
    const deployRoot = join(root, "not-created");
    const result = spawnSync("bash", ["tools/deploy.sh", "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, DEPLOY_ROOT: deployRoot },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(deployRoot), false);
    assert.match(result.stdout, /database backup/);
    assert.equal(spawnSync("bash", ["-n", "tools/deploy.sh"]).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
