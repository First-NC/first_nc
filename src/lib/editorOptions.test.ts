import test from "node:test";
import assert from "node:assert/strict";

import { resolveNcEditorOptions } from "./editorOptions.ts";

test("resolveNcEditorOptions disables scrolling beyond the last line", () => {
  const options = resolveNcEditorOptions();

  assert.equal(options.scrollBeyondLastLine, false);
});
