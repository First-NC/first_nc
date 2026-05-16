import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("NcEditor exposes an unmount callback so parent linkage state can be reset", () => {
  const editorSource = readFileSync(join(workspaceRoot, "src", "components", "NcEditor.tsx"), "utf8");
  const appSource = readFileSync(join(workspaceRoot, "src", "App.tsx"), "utf8");

  assert.match(editorSource, /onUnmount\?: \(\) => void/);
  assert.match(editorSource, /return \(\) => onUnmount\?\.\(\)/);
  assert.match(appSource, /const handleEditorUnmount = useCallback/);
  assert.match(appSource, /setEditorReady\(false\)/);
  assert.match(appSource, /onUnmount=\{handleEditorUnmount\}/);
});
