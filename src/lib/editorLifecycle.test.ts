import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("App resets editor linkage state only when the editor pane is actually unavailable", () => {
  const editorSource = readFileSync(join(workspaceRoot, "src", "components", "NcEditor.tsx"), "utf8");
  const appSource = readFileSync(join(workspaceRoot, "src", "App.tsx"), "utf8");

  assert.doesNotMatch(editorSource, /onUnmount/);
  assert.match(appSource, /const handleEditorUnmount = useCallback/);
  assert.match(appSource, /setEditorReady\(false\)/);
  assert.match(appSource, /if \(showEditor && !fallbackEditor\) return/);
  assert.match(appSource, /handleEditorUnmount\(\)/);
});
