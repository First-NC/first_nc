import test from "node:test";
import assert from "node:assert/strict";

import { shouldShowStartupMaskOnPlatform } from "./startupPlatform.ts";

test("shouldShowStartupMaskOnPlatform disables the startup mask on Linux", () => {
  assert.equal(shouldShowStartupMaskOnPlatform("Linux x86_64"), false);
  assert.equal(shouldShowStartupMaskOnPlatform("linux"), false);
});

test("shouldShowStartupMaskOnPlatform keeps the startup mask on macOS and Windows", () => {
  assert.equal(shouldShowStartupMaskOnPlatform("MacIntel"), true);
  assert.equal(shouldShowStartupMaskOnPlatform("Win32"), true);
});
