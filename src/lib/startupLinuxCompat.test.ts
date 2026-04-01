import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("linux startup path bypasses the external splash handoff in Rust", () => {
  const source = readFileSync(join(workspaceRoot, "src-tauri", "src", "lib.rs"), "utf8");

  assert.match(source, /fn should_use_startup_splash\(\) -> bool/);
  assert.match(source, /!\s*cfg!\(target_os = "linux"\)/);
  assert.match(source, /reveal_main_window\(app\.handle\(\), &state\)\?/);
});
