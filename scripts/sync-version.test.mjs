import assert from "node:assert/strict";
import test from "node:test";

import { syncCargoTomlVersion, syncTauriConfigVersion } from "./sync-version.mjs";

test("syncTauriConfigVersion rewrites tauri config version", () => {
  const next = syncTauriConfigVersion('{\n  "version": "0.0.0",\n  "productName": "First NC"\n}\n', "1.2.0");
  assert.match(next, /"version": "1\.2\.0"/);
  assert.match(next, /"productName": "First NC"/);
});

test("syncCargoTomlVersion rewrites cargo package version", () => {
  const next = syncCargoTomlVersion(
    '[package]\nname = "first-nc"\nversion = "0.0.0"\nedition = "2021"\n',
    "1.2.0",
  );
  assert.match(next, /^version = "1\.2\.0"$/m);
  assert.match(next, /^name = "first-nc"$/m);
});
