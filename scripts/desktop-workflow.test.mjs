import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/desktop-build.yml", import.meta.url), "utf8");

test("workflow opts JavaScript actions into Node 24 runtime", () => {
  assert.match(workflow, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*true/);
});

test("workflow only auto-builds desktop bundles for version tags", () => {
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*-\s*"v\*"/m);
  assert.doesNotMatch(workflow, /on:\s*[\s\S]*push:\s*[\s\S]*branches:/m);
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
  assert.doesNotMatch(workflow, /&& secrets\./);
  assert.doesNotMatch(workflow, /matrix\.[^\n]+&&\s*secrets\./);
  assert.match(workflow, /RAW_APPLE_API_KEY/);
  assert.match(workflow, /export APPLE_API_KEY_PATH=/);
  assert.doesNotMatch(workflow, /jobs:\s+build:\s+env:\s+APPLE_CERTIFICATE/s);
  assert.match(workflow, /RAW_APPLE_CERTIFICATE/);
});

test("workflow runs the bundle step with bash on every runner", () => {
  assert.match(
    workflow,
    /-\s+name:\s+Build bundles[\s\S]*?shell:\s+bash[\s\S]*?run:\s+\|/,
  );
});
