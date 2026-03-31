import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("vite build target includes a conservative WebKit target for Linux webviews", () => {
  const source = readFileSync(join(workspaceRoot, "vite.config.ts"), "utf8");

  assert.match(
    source,
    /target\s*:\s*.*safari13/i,
    "vite.config.ts should set build.target to include safari13 for WebKitGTK compatibility",
  );
});
