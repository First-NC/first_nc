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
  assert.equal(
    /import App from "\.\/App";/.test(mainSource),
    true,
    "main.tsx should eagerly import App so older Linux WebKit runtimes do not depend on startup chunk loading",
  );
  assert.equal(
    /import\("@tauri-apps\/api\/core"\)/.test(mainSource),
    false,
    "main.tsx should not rely on dynamically importing @tauri-apps/api/core before the hidden main window is revealed",
  );
  assert.match(
    mainSource,
    /__TAURI_INTERNALS__/,
    "main.tsx should use Tauri internals directly for the earliest startup handshake",
  );
  assert.equal(
    /import\("\.\/App"\)/.test(mainSource),
    false,
    "main.tsx should not lazy-load App during the startup handshake",
  );
  assert.equal(
    /notify_startup_ready/.test(mainSource),
    true,
    "main.tsx should reveal the hidden main window as soon as the startup shell is ready",
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
  assert.equal(
    /from "@tauri-apps\/api\/window"/.test(appSource),
    false,
    "App.tsx should not eagerly import @tauri-apps/api/window",
  );
  assert.equal(
    /from "@tauri-apps\/api\/core"/.test(appSource),
    false,
    "App.tsx should not eagerly import @tauri-apps/api/core",
  );
  assert.equal(
    /from "@tauri-apps\/api\/event"/.test(appSource),
    false,
    "App.tsx should not eagerly import @tauri-apps/api/event",
  );
  assert.equal(
    /from "@tauri-apps\/plugin-dialog"/.test(appSource),
    false,
    "App.tsx should not eagerly import @tauri-apps/plugin-dialog",
  );
});
