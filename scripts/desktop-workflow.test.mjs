import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/desktop-build.yml", import.meta.url), "utf8");

test("workflow opts JavaScript actions into Node 24 runtime", () => {
  assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*true/);
});

test("workflow builds Linux packages in a Jammy-compatible container", () => {
  assert.match(workflow, /package_script:\s*package:linux:docker/);
  assert.match(workflow, /artifact_path:\s*src-tauri\/target\/x86_64-unknown-linux-gnu\/release\/bundle\/deb/);
});

test("workflow no longer requests the unsupported macOS Intel runner", () => {
  assert.doesNotMatch(workflow, /macos-13/);
  assert.match(workflow, /macos-14/);
});

test("workflow allows macOS fallback packaging without mandatory Apple signing validation", () => {
  assert.doesNotMatch(workflow, /Validate Apple signing config/);
  assert.match(workflow, /Prepare Apple API key/);
  assert.match(workflow, /APPLE_API_KEY_PATH/);
  assert.doesNotMatch(workflow, /jobs:\s+build:\s+env:\s+APPLE_CERTIFICATE/s);
  assert.match(workflow, /RAW_APPLE_CERTIFICATE/);
});
