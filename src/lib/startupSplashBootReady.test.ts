import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("startup splash can reveal the hidden main window without waiting for main webview startup", () => {
  const source = readFileSync(join(workspaceRoot, "public", "startup-splash.html"), "utf8");

  assert.equal(
    /notify_startup_boot_ready/.test(source),
    true,
    "startup splash should invoke notify_startup_boot_ready for older hidden-window Linux webviews",
  );
});
