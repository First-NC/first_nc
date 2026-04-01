import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dirname, "..", "..");

test("App startup avoids unsafe direct matchMedia access during initial render", () => {
  const source = readFileSync(join(workspaceRoot, "src", "App.tsx"), "utf8");

  assert.equal(
    /useState\(\(\)\s*=>\s*window\.matchMedia\(/.test(source),
    false,
    "App.tsx should not call window.matchMedia directly in a render-time state initializer",
  );
});

test("App startup keeps legacy MediaQueryList listener fallback for older WebKitGTK", () => {
  const source = readFileSync(join(workspaceRoot, "src", "App.tsx"), "utf8");

  assert.match(source, /addListener/);
  assert.match(source, /removeListener/);
});
