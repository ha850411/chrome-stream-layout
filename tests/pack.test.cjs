"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "pack.py");

test("pack.py outputs zip to project dist directory with hash and YmdHis format", () => {
  const testOutDir = path.join(ROOT_DIR, "dist", "test-pack");
  fs.rmSync(testOutDir, { recursive: true, force: true });

  const stdout = execFileSync("python3", [SCRIPT_PATH, "--out-dir", testOutDir], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });

  assert.ok(stdout.includes("成功打包"), "stdout should indicate packaging success");
  assert.ok(fs.existsSync(testOutDir), "output directory should be created");

  const files = fs.readdirSync(testOutDir);
  assert.equal(files.length, 1, "should generate exactly one zip archive");

  const zipName = files[0];
  // Format: chrome-stream-layout-<hash>-<YmdHis>.zip
  // YmdHis is 14 digits (YYYYMMDDHHmmss)
  const pattern = /^chrome-stream-layout-(?:[a-f0-9]+|unknown)-\d{14}\.zip$/;
  assert.match(zipName, pattern, `filename "${zipName}" must contain hash and YmdHis timestamp`);

  fs.rmSync(testOutDir, { recursive: true, force: true });
});
