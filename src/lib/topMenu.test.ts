import assert from "node:assert/strict";
import test from "node:test";

import { HELP_MENU_ACTION_ORDER, UTILITY_MENU_CONTROL_ORDER } from "./topMenu.ts";

test("utility controls keep shortcuts followed by help after theme", () => {
  assert.deepEqual(UTILITY_MENU_CONTROL_ORDER, ["language", "theme", "shortcuts", "help"]);
});

test("help menu keeps check update before about", () => {
  assert.deepEqual(HELP_MENU_ACTION_ORDER, ["checkUpdate", "about"]);
});
