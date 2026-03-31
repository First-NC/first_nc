import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("startup path avoids Promise.allSettled to preserve older WebKit compatibility", () => {
  const source = readFileSync(join(workspaceRoot, "src", "main.tsx"), "utf8");

  assert.equal(
    /Promise\.allSettled/.test(source),
    false,
    "main.tsx should not rely on Promise.allSettled during startup",
  );
});
