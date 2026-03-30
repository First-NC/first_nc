import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("main startup path does not statically import monaco editor runtime", () => {
  const mainSource = readFileSync(join(workspaceRoot, "src", "main.tsx"), "utf8");

  assert.equal(
    /monaco-editor\/esm\/vs\/editor\/editor\.worker\?worker/.test(mainSource),
    false,
    "main.tsx should not eagerly import the Monaco worker on startup",
  );
});

test("App shell does not statically import Monaco runtime modules", () => {
  const appSource = readFileSync(join(workspaceRoot, "src", "App.tsx"), "utf8");

  assert.equal(
    /from "@monaco-editor\/react"/.test(appSource),
    false,
    "App.tsx should not eagerly import @monaco-editor/react",
  );
  assert.equal(
    /import \* as monacoApi from "monaco-editor"/.test(appSource),
    false,
    "App.tsx should not eagerly import monaco-editor runtime",
  );
  assert.equal(
    /loader\.config\(\{ monaco: monacoApi \}\);/.test(appSource),
    false,
    "App.tsx should not configure Monaco at module load time",
  );
  assert.equal(
    /from "\.\/components\/Viewer3D"/.test(appSource),
    false,
    "App.tsx should not eagerly import the 3D viewer runtime",
  );
});
